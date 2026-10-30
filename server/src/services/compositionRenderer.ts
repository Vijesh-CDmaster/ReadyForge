import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IAsset } from '../models/Asset';
import {
  ANIMATION_EASINGS,
  ICompositionClip,
  ICompositionText,
  ICompositionTrack,
  IEditComposition,
  TEXT_ENTRANCE_ANIMATIONS,
  TEXT_EXIT_ANIMATIONS,
  TRANSITION_TYPES,
  TransitionType,
  resolveCompositionTracks,
} from '../models/EditComposition';
import { config } from '../config';
import { VideoProviderError } from './videoProvider';
import { isApprovedFontFamily, resolveApprovedFont, wrapOverlayText } from './textOverlay';
import {
  ZOOM_LAYER_DRAW_SCALE,
  ZOOM_LAYER_HEIGHT,
  ZOOM_LAYER_WIDTH,
  opacityFactorExpression,
  slideOffsetExpression,
  toAnimationWindow,
  zoomRangeFor,
  zoomScaleExpression,
} from './animations';

type ProcessResult = { stdout: string; stderr: string };
export type ProcessRunner = (command: string, args: string[], cwd: string) => Promise<ProcessResult>;

export class ProcessTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`process timed out after ${timeoutMs} ms`);
    this.name = 'ProcessTimeoutError';
  }
}

/**
 * Spawns an executable with an argument array (never a shell), captures output,
 * and terminates the process if it exceeds the configured render timeout.
 */
export const runProcess: ProcessRunner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout>;
    const timeoutMs = config.video.renderTimeoutMs;
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // Do not wait forever for a stuck executable to acknowledge the kill.
      killTimer = setTimeout(
        () => finish(() => reject(new ProcessTimeoutError(timeoutMs))),
        2_000
      );
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      finish(() => {
        if (timedOut) reject(new ProcessTimeoutError(timeoutMs));
        else if (code === 0) resolve({ stdout, stderr });
        else
          reject(
            new Error(
              `process exited with code ${code}: ${stderr.slice(-500)}`
            )
          );
      });
    });
  });

export interface RenderMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface RenderResult extends RenderMetadata {
  outputPath: string;
}

export type FontResolver = (family: string, bold: boolean, italic: boolean) => string | null;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function assertTextStyle(text: ICompositionText): void {
  if (!text.content || !text.content.trim()) {
    throw new VideoProviderError('A text clip has no content.', 'validation', false);
  }
  const finite = (value: number) => Number.isFinite(value);
  if (!finite(text.x) || text.x < 0 || text.x > 1 || !finite(text.y) || text.y < 0 || text.y > 1) {
    throw new VideoProviderError('A text clip has an invalid position.', 'validation', false);
  }
  if (!finite(text.width) || text.width < 0.05 || text.width > 1) {
    throw new VideoProviderError('A text clip has an invalid width.', 'validation', false);
  }
  if (!finite(text.fontSize) || text.fontSize < 8 || text.fontSize > 200) {
    throw new VideoProviderError('A text clip has an invalid font size.', 'validation', false);
  }
  if (!finite(text.textOpacity) || text.textOpacity < 0 || text.textOpacity > 1) {
    throw new VideoProviderError('A text clip has an invalid text opacity.', 'validation', false);
  }
  if (!finite(text.backgroundOpacity) || text.backgroundOpacity < 0 || text.backgroundOpacity > 1) {
    throw new VideoProviderError('A text clip has an invalid background opacity.', 'validation', false);
  }
  if (
    !HEX_COLOR.test(text.fontColor) ||
    !HEX_COLOR.test(text.backgroundColor) ||
    !HEX_COLOR.test(text.outlineColor)
  ) {
    throw new VideoProviderError('A text clip has an invalid colour value.', 'validation', false);
  }
  if (!['left', 'center', 'right'].includes(text.alignment)) {
    throw new VideoProviderError('A text clip has an invalid alignment.', 'validation', false);
  }
  if (!isApprovedFontFamily(text.fontFamily)) {
    throw new VideoProviderError(
      `Font family "${text.fontFamily}" is not in the approved font registry.`,
      'validation',
      false
    );
  }
  if (!finite(text.outlineWidth) || text.outlineWidth < 0 || text.outlineWidth > 10) {
    throw new VideoProviderError('A text clip has an invalid outline width.', 'validation', false);
  }
  if (!Number.isInteger(text.zIndex) || text.zIndex < 0 || text.zIndex > 1000) {
    throw new VideoProviderError('A text clip has an invalid z-index.', 'validation', false);
  }
}

const TRANSITION_EXTENDS_OUTGOING: readonly TransitionType[] = [
  'crossfade',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'slide-right',
];

function assertAnimationSettings(
  label: string,
  settings: { type: string; durationSeconds: number; delaySeconds?: number; easing?: string } | undefined,
  allowed: readonly string[],
  clipDuration: number
): void {
  if (!settings) return;
  if (!allowed.includes(settings.type)) {
    throw new VideoProviderError(`A text clip has an unsupported ${label} animation "${settings.type}".`, 'validation', false);
  }
  if (!Number.isFinite(settings.durationSeconds) || settings.durationSeconds < 0.05 || settings.durationSeconds > 10) {
    throw new VideoProviderError(`A text clip has an invalid ${label} animation duration.`, 'validation', false);
  }
  const delay = settings.delaySeconds ?? 0;
  if (!Number.isFinite(delay) || delay < 0 || delay > 10) {
    throw new VideoProviderError(`A text clip has an invalid ${label} animation delay.`, 'validation', false);
  }
  if (settings.easing && !(ANIMATION_EASINGS as readonly string[]).includes(settings.easing)) {
    throw new VideoProviderError(`A text clip has an unsupported ${label} easing curve.`, 'validation', false);
  }
  if (settings.durationSeconds + delay > clipDuration + 0.011) {
    throw new VideoProviderError(
      `A text clip's ${label} animation does not fit inside the clip duration.`,
      'validation',
      false
    );
  }
}

function assertTextAnimation(text: ICompositionText, clipDuration: number): void {
  if (!text.animation) return;
  if (text.animation.version !== 1) {
    throw new VideoProviderError('A text clip uses an unsupported animation model version.', 'validation', false);
  }
  assertAnimationSettings('entrance', text.animation.entrance, TEXT_ENTRANCE_ANIMATIONS, clipDuration);
  assertAnimationSettings('exit', text.animation.exit, TEXT_EXIT_ANIMATIONS, clipDuration);
}

function assertClipAudio(clip: ICompositionClip): void {
  if (!clip.audio) return;
  const { volume, fadeInSeconds, fadeOutSeconds } = clip.audio;
  if (!Number.isFinite(volume) || volume < 0 || volume > 2) {
    throw new VideoProviderError('An audio clip has an invalid volume.', 'validation', false);
  }
  if (
    !Number.isFinite(fadeInSeconds) ||
    !Number.isFinite(fadeOutSeconds) ||
    fadeInSeconds < 0 ||
    fadeOutSeconds < 0 ||
    fadeInSeconds > 30 ||
    fadeOutSeconds > 30
  ) {
    throw new VideoProviderError('An audio clip has invalid fade durations.', 'validation', false);
  }
  if (fadeInSeconds + fadeOutSeconds > (clip.durationSeconds ?? 0) + 0.011) {
    throw new VideoProviderError('An audio clip\'s fades do not fit inside the clip duration.', 'validation', false);
  }
}

function renderProcessError(error: unknown, workDir: string): VideoProviderError {
  if (error instanceof ProcessTimeoutError) {
    return new VideoProviderError(
      `Video rendering timed out after ${error.timeoutMs} ms and the FFmpeg process was terminated. Increase VIDEO_RENDER_TIMEOUT_MS for longer timelines.`,
      'timeout',
      true
    );
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('ENOENT')) {
    return new VideoProviderError(
      'Video rendering failed because FFmpeg is unavailable. Install FFmpeg or set FFMPEG_PATH to a working ffmpeg executable. See docs/VIDEO_RENDERING.md.',
      'provider',
      false
    );
  }
  if (/unknown encoder\s+['"]?libx264/i.test(message) || /encoder\s+libx264\s+not\s+found/i.test(message)) {
    return new VideoProviderError(
      'This FFmpeg build does not include the libx264 encoder required for H.264 MP4 output. Use a build compiled with libx264 (GPL builds include it). See docs/VIDEO_RENDERING.md.',
      'provider',
      false
    );
  }
  if (/No such filter:\s*['"]?drawtext/i.test(message) || /filter\s+drawtext\s+not\s+found/i.test(message)) {
    return new VideoProviderError(
      'This FFmpeg build does not include the drawtext filter required for text overlays. Use a build compiled with libfreetype (the bundled GPL build does). See docs/VIDEO_RENDERING.md.',
      'provider',
      false
    );
  }
  const detail = message
    .replaceAll(workDir, '<render-temp>')
    .replaceAll(workDir.replaceAll('\\', '/'), '<render-temp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-400);
  return new VideoProviderError(
    `Video rendering failed.${detail ? ` ${detail}` : ''}`,
    'provider',
    false
  );
}

function clipRange(clip: ICompositionClip): { inPoint: number; outPoint: number } {
  const inPoint = clip.sourceInSeconds;
  const outPoint =
    clip.sourceOutSeconds > 0
      ? clip.sourceOutSeconds
      : clip.sourceInSeconds + (clip.durationSeconds ?? 0);
  return { inPoint, outPoint };
}

function assertClipSupported(
  clip: ICompositionClip,
  type: 'video' | 'audio',
  asset: IAsset
): void {
  if (
    !Number.isFinite(clip.timelineStartSeconds) ||
    clip.timelineStartSeconds < 0 ||
    !Number.isFinite(clip.sourceInSeconds) ||
    clip.sourceInSeconds < 0 ||
    !Number.isFinite(clip.sourceOutSeconds) ||
    clip.sourceOutSeconds < 0
  ) {
    throw new VideoProviderError(
      'Every render clip must have valid, non-negative timeline and source values.',
      'validation',
      false
    );
  }
  if (clip.durationSeconds === undefined || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
    throw new VideoProviderError(
      'Every render clip must have trusted positive duration metadata.',
      'validation',
      false
    );
  }
  const { inPoint, outPoint } = clipRange(clip);
  const range = outPoint - inPoint;
  if (!Number.isFinite(range) || range <= 0) {
    throw new VideoProviderError(
      'Every render clip must have a source out-point after its in-point.',
      'validation',
      false
    );
  }
  if (Math.abs(range - clip.durationSeconds) > 0.01) {
    throw new VideoProviderError(
      'Render clip duration metadata does not match its source range.',
      'validation',
      false
    );
  }
  if (asset.type !== type) {
    throw new VideoProviderError(
      `A ${type} clip references an asset that is not ${type} media.`,
      'validation',
      false
    );
  }
  if (asset.sourceDurationSeconds !== undefined) {
    if (!Number.isFinite(asset.sourceDurationSeconds) || asset.sourceDurationSeconds <= 0) {
      throw new VideoProviderError(
        'A composition source asset has invalid duration metadata.',
        'validation',
        false
      );
    }
    if (outPoint > asset.sourceDurationSeconds + 0.01) {
      throw new VideoProviderError(
        'A composition clip extends past the end of its source asset.',
        'validation',
        false
      );
    }
  }
}

/**
 * Validates a multi-track timeline and returns the clips that actually
 * contribute to the render. Hidden tracks and muted audio tracks are explicit
 * user choices, not unsupported content. Text clips are rendered later with
 * FFmpeg drawtext and may overlap in time.
 */
function validateTimeline(composition: IEditComposition, assetsById: Map<string, IAsset>) {
  const tracks = resolveCompositionTracks(composition);
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));

  for (const clip of composition.clips) {
    const track = trackById.get(clip.trackId);
    if (!track) {
      throw new VideoProviderError(
        'A composition clip references a track that is not declared.',
        'validation',
        false
      );
    }
    if (track.type === 'text' && !clip.text) {
      throw new VideoProviderError('A text clip is missing its text properties.', 'validation', false);
    }
    if (track.type !== clip.trackType) {
      throw new VideoProviderError(
        'A composition clip type does not match its track type.',
        'validation',
        false
      );
    }
  }

  const visibleVideoTracks = tracks.filter((track) => track.type === 'video' && !track.hidden);
  const unmutedAudioTracks = tracks.filter((track) => track.type === 'audio' && !track.muted);
  const visibleTextTracks = tracks.filter((track) => track.type === 'text' && !track.hidden);
  const visibleVideoTrackIds = new Set(visibleVideoTracks.map((track) => track.trackId));
  const unmutedAudioTrackIds = new Set(unmutedAudioTracks.map((track) => track.trackId));
  const visibleTextTrackIds = new Set(visibleTextTracks.map((track) => track.trackId));

  const byTrack = (track: ICompositionTrack) =>
    composition.clips
      .filter((clip) => clip.trackId === track.trackId)
      .sort(
        (a, b) =>
          a.timelineStartSeconds - b.timelineStartSeconds ||
          (a.order ?? 0) - (b.order ?? 0)
      );

  const videoClips: Array<{ clip: ICompositionClip; track: ICompositionTrack }> = [];
  const audioClips: Array<{ clip: ICompositionClip; track: ICompositionTrack }> = [];
  const textClips: Array<{
    clip: ICompositionClip;
    track: ICompositionTrack;
    text: ICompositionText;
  }> = [];

  for (const track of tracks) {
    const active =
      track.type === 'video'
        ? visibleVideoTrackIds.has(track.trackId)
        : track.type === 'audio'
          ? unmutedAudioTrackIds.has(track.trackId)
          : visibleTextTrackIds.has(track.trackId);
    if (!active) continue;
    const clips = byTrack(track);
    let previousEnd = -1;
    for (const clip of clips) {
      if (track.type === 'text') {
        if (!clip.text) {
          throw new VideoProviderError('A text clip is missing its text properties.', 'validation', false);
        }
        assertTextStyle(clip.text);
        if (!clip.durationSeconds || clip.durationSeconds <= 0) {
          throw new VideoProviderError('A text clip needs a positive timeline duration.', 'validation', false);
        }
        assertTextAnimation(clip.text, clip.durationSeconds);
        textClips.push({ clip, track, text: clip.text });
        continue;
      }
      if (!clip.assetId) {
        throw new VideoProviderError('A media clip is missing its source asset.', 'validation', false);
      }
      const asset = assetsById.get(clip.assetId.toString());
      if (!asset) {
        throw new VideoProviderError(
          'A composition source asset is unavailable.',
          'validation',
          false
        );
      }
      assertClipSupported(clip, track.type, asset);
      assertClipAudio(clip);
      if (clip.transitionIn && track.type !== 'video') {
        throw new VideoProviderError('Transitions are only supported between video clips.', 'validation', false);
      }
      if (clip.timelineStartSeconds < previousEnd - 0.001) {
        throw new VideoProviderError(
          `Clips on track "${track.name}" overlap. Move or trim them before rendering.`,
          'validation',
          false
        );
      }
      previousEnd = clip.timelineStartSeconds + (clip.durationSeconds ?? 0);
      (track.type === 'video' ? videoClips : audioClips).push({ clip, track });
    }
  }

  if (videoClips.length === 0) {
    throw new VideoProviderError(
      'The composition must contain at least one clip on a visible video track.',
      'validation',
      false
    );
  }

  const duration = [...videoClips, ...audioClips, ...textClips].reduce(
    (end, entry) => Math.max(end, entry.clip.timelineStartSeconds + (entry.clip.durationSeconds ?? 0)),
    0
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoProviderError('The rendered timeline has no positive duration.', 'validation', false);
  }

  videoClips.sort(
    (a, b) =>
      a.track.order - b.track.order ||
      a.clip.timelineStartSeconds - b.clip.timelineStartSeconds ||
      (a.clip.order ?? 0) - (b.clip.order ?? 0)
  );
  audioClips.sort(
    (a, b) =>
      a.track.order - b.track.order ||
      a.clip.timelineStartSeconds - b.clip.timelineStartSeconds ||
      (a.clip.order ?? 0) - (b.clip.order ?? 0)
  );
  textClips.sort(
    (a, b) =>
      a.track.order - b.track.order ||
      (a.text.zIndex ?? 0) - (b.text.zIndex ?? 0) ||
      a.clip.timelineStartSeconds - b.clip.timelineStartSeconds ||
      (a.clip.order ?? 0) - (b.clip.order ?? 0)
  );
  return {
    videoClips: linkTransitions(videoClips),
    audioClips,
    textClips,
    duration,
  };
}

export interface VideoEntry {
  clip: ICompositionClip;
  track: ICompositionTrack;
  /** Transition declared on this clip that brings it in from the previous clip. */
  incoming: { type: TransitionType; durationSeconds: number } | null;
  /** Extra seconds of picture this clip must provide under the next transition. */
  extendSeconds: number;
  /** Fade this clip out into the next clip's fade-black/fade-white transition. */
  fadeOut: { type: TransitionType; durationSeconds: number } | null;
}

/**
 * Resolves every declared transition against the clip it refers to. Nothing is
 * guessed: an unresolvable or oversized transition fails the render.
 */
function linkTransitions(
  videoClips: Array<{ clip: ICompositionClip; track: ICompositionTrack }>
): VideoEntry[] {
  const info = new Map<
    ICompositionClip,
    { incoming: VideoEntry['incoming']; extendSeconds: number; fadeOut: VideoEntry['fadeOut'] }
  >();
  for (const entry of videoClips) {
    info.set(entry.clip, { incoming: null, extendSeconds: 0, fadeOut: null });
  }

  const byTrack = new Map<string, typeof videoClips>();
  for (const entry of videoClips) {
    const list = byTrack.get(entry.clip.trackId) ?? [];
    list.push(entry);
    byTrack.set(entry.clip.trackId, list);
  }

  for (const list of byTrack.values()) {
    list.sort(
      (a, b) =>
        a.clip.timelineStartSeconds - b.clip.timelineStartSeconds ||
        (a.clip.order ?? 0) - (b.clip.order ?? 0)
    );
    for (let index = 1; index < list.length; index += 1) {
      const current = list[index];
      const previous = list[index - 1];
      const transition = current.clip.transitionIn;
      if (!transition) continue;
      if (!TRANSITION_TYPES.includes(transition.type)) {
        throw new VideoProviderError(
          `Unsupported video transition "${transition.type}".`,
          'validation',
          false
        );
      }
      if (
        !Number.isFinite(transition.durationSeconds) ||
        transition.durationSeconds < 0.1 ||
        transition.durationSeconds > 5
      ) {
        throw new VideoProviderError('A video transition has an invalid duration.', 'validation', false);
      }
      const previousEnd = previous.clip.timelineStartSeconds + (previous.clip.durationSeconds ?? 0);
      if (Math.abs(previousEnd - current.clip.timelineStartSeconds) > 0.011) {
        throw new VideoProviderError(
          `The "${transition.type}" transition needs two clips that touch on the same track.`,
          'validation',
          false
        );
      }
      const limit = Math.min(previous.clip.durationSeconds ?? 0, current.clip.durationSeconds ?? 0);
      if (transition.durationSeconds > limit + 0.001) {
        throw new VideoProviderError(
          `A ${transition.durationSeconds.toFixed(2)}s transition does not fit between the adjacent clips.`,
          'validation',
          false
        );
      }
      info.get(current.clip)!.incoming = {
        type: transition.type,
        durationSeconds: transition.durationSeconds,
      };
      const previousInfo = info.get(previous.clip)!;
      if (TRANSITION_EXTENDS_OUTGOING.includes(transition.type)) {
        previousInfo.extendSeconds = transition.durationSeconds;
      } else {
        previousInfo.fadeOut = { type: transition.type, durationSeconds: transition.durationSeconds };
      }
    }
  }

  return videoClips.map((entry) => ({ ...entry, ...info.get(entry.clip)! }));
}

function probe(outputPath: string, runner: ProcessRunner, cwd: string): Promise<RenderMetadata> {
  return (async () => {
    let result: ProcessResult;
    try {
      result = await runner(
        config.video.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration:stream=index,codec_type,codec_name,width,height',
          '-of',
          'json',
          outputPath,
        ],
        cwd
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new VideoProviderError(
        message.includes('ENOENT')
          ? 'Rendered output inspection failed because FFprobe is unavailable. Install FFmpeg or set FFPROBE_PATH to a working ffprobe executable.'
          : 'Rendered output inspection failed.',
        'validation',
        false
      );
    }

    let parsed: {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
      }>;
    };
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      throw new VideoProviderError(
        'Rendered output inspection returned malformed metadata.',
        'validation',
        false
      );
    }

    const invalid = () =>
      new VideoProviderError(
        'Rendered output is not a valid H.264/AAC MP4 with a usable video stream.',
        'validation',
        false
      );
    const duration = Number(parsed.format?.duration);
    const formatNames =
      parsed.format?.format_name?.split(',').map((name) => name.trim().toLowerCase()) || [];
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (!formatNames.includes('mov') && !formatNames.includes('mp4')) throw invalid();
    if (!Number.isFinite(duration) || duration <= 0) throw invalid();
    if (
      !video ||
      video.codec_name !== 'h264' ||
      typeof video.width !== 'number' ||
      !Number.isInteger(video.width) ||
      video.width < 1 ||
      typeof video.height !== 'number' ||
      !Number.isInteger(video.height) ||
      video.height < 1
    ) {
      throw invalid();
    }
    if (audio && audio.codec_name !== 'aac') throw invalid();
    return {
      durationSeconds: duration,
      width: video.width,
      height: video.height,
      hasAudio: Boolean(audio),
    };
  })();
}

function seconds(value: number): string {
  return value.toFixed(3);
}

export async function renderComposition(params: {
  composition: IEditComposition;
  assets: IAsset[];
  workDir: string;
  runner?: ProcessRunner;
  /** Injectable only for tests; production always uses the approved registry. */
  fontResolver?: FontResolver;
}): Promise<RenderResult> {
  const runner = params.runner || runProcess;
  const assetsById = new Map(params.assets.map((asset) => [asset._id.toString(), asset]));
  const { videoClips, audioClips, textClips, duration } = validateTimeline(params.composition, assetsById);

  await fs.mkdir(params.workDir, { recursive: true });
  const inputs = [...videoClips.map((entry) => entry.clip), ...audioClips.map((entry) => entry.clip)];
  /** Only real media is passed to FFmpeg with -i. */
  const inputPaths: string[] = [];
  /** Every file this render created, removed on success and failure. */
  const temporaryFiles: string[] = [];
  const outputPath = path.join(params.workDir, 'render.mp4');
  let completed = false;
  try {
    for (let index = 0; index < inputs.length; index += 1) {
      const asset = assetsById.get(inputs[index].assetId!.toString())!;
      if (!asset.fileUrl.startsWith('/uploads/')) {
        throw new VideoProviderError(
          'A composition source asset has an invalid storage path.',
          'validation',
          false
        );
      }
      const fileName = path.basename(asset.fileUrl);
      if (!fileName || fileName !== asset.fileUrl.slice('/uploads/'.length) || fileName.includes('..')) {
        throw new VideoProviderError(
          'A composition source asset has an invalid storage path.',
          'validation',
          false
        );
      }
      const sourcePath = path.resolve(config.upload.dir, fileName);
      const stagedPath = path.join(params.workDir, `${index}-${fileName}`);
      await fs.copyFile(sourcePath, stagedPath);
      inputPaths.push(stagedPath);
      temporaryFiles.push(stagedPath);
    }

    const fontResolver = params.fontResolver || resolveApprovedFont;
    const textArtifacts: Array<{ fontFile: string; textFile: string; entry: (typeof textClips)[number] }> = [];
    for (let index = 0; index < textClips.length; index += 1) {
      const entry = textClips[index];
      const fontPath = fontResolver(entry.text.fontFamily, Boolean(entry.text.bold), Boolean(entry.text.italic));
      if (!fontPath) {
        throw new VideoProviderError(
          `No approved local font is installed for "${entry.text.fontFamily}". Install one of the registry fonts or choose another family.`,
          'validation',
          false
        );
      }
      const extension = path.extname(fontPath).toLowerCase();
      const safeExtension = ['.ttf', '.otf', '.ttc'].includes(extension) ? extension : '.ttf';
      const fontFile = `overlay-font-${index}${safeExtension}`;
      const textFile = `overlay-text-${index}.txt`;
      const fontDestination = path.join(params.workDir, fontFile);
      const textDestination = path.join(params.workDir, textFile);
      await fs.copyFile(fontPath, fontDestination);
      const wrapped = wrapOverlayText(entry.text.content, entry.text.width * 1280, entry.text.fontSize);
      await fs.writeFile(textDestination, wrapped, 'utf8');
      // Fonts and text files are read by drawtext, never opened as inputs.
      temporaryFiles.push(fontDestination, textDestination);
      textArtifacts.push({ fontFile, textFile, entry });
    }

    const filterParts: string[] = [];
    filterParts.push(`color=c=black:s=1280x720:r=30:d=${seconds(duration)},setsar=1[base]`);
    let videoLabel = 'base';
    videoClips.forEach((entry, index) => {
      const { clip, incoming, extendSeconds, fadeOut } = entry;
      const { inPoint, outPoint } = clipRange(clip);
      const start = clip.timelineStartSeconds;
      const clipDuration = clip.durationSeconds ?? 0;
      const end = start + clipDuration;
      const asset = assetsById.get(clip.assetId!.toString())!;
      // A transition that shows the outgoing picture under the incoming one
      // needs extra material. Use the source handle when it exists, otherwise
      // hold the final frame so the timeline never shifts.
      const availableAfterOut =
        asset.sourceDurationSeconds === undefined
          ? 0
          : Math.max(0, asset.sourceDurationSeconds - outPoint);
      const handle = Math.min(extendSeconds, Math.max(0, availableAfterOut - 0.001));
      const holdSeconds = Math.max(0, extendSeconds - handle);
      const chain = [`trim=start=${seconds(inPoint)}:end=${seconds(outPoint + handle)}`];
      if (holdSeconds > 0.001) {
        chain.push(`tpad=stop_mode=clone:stop_duration=${seconds(holdSeconds)}`);
      }
      chain.push(
        `setpts=PTS-STARTPTS+${seconds(start)}/TB`,
        'fps=30',
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        'setsar=1'
      );
      const alphaFades: string[] = [];
      if (incoming?.type === 'crossfade') {
        alphaFades.push(
          `fade=t=in:st=${seconds(start)}:d=${seconds(incoming.durationSeconds)}:alpha=1`
        );
      }
      if (incoming?.type === 'fade-black' || incoming?.type === 'fade-white') {
        alphaFades.push(
          `fade=t=in:st=${seconds(start)}:d=${seconds(incoming.durationSeconds / 2)}:alpha=1`
        );
      }
      if (fadeOut) {
        const half = fadeOut.durationSeconds / 2;
        alphaFades.push(`fade=t=out:st=${seconds(end - half)}:d=${seconds(half)}:alpha=1`);
      }
      if (alphaFades.length > 0) chain.push('format=rgba', ...alphaFades);
      filterParts.push(`[${index}:v]${chain.join(',')}[v${index}]`);

      let layerLabel = `v${index}`;
      if (incoming?.type === 'wipe-left' || incoming?.type === 'wipe-right') {
        const d = incoming.durationSeconds;
        // A wipe is a moving edge, which no single FFmpeg filter draws directly.
        // Build it from a static horizontal gradient compared against a white
        // source that fades up over the transition window: the comparison point
        // travels across the frame, revealing the incoming clip.
        const gradient =
          incoming.type === 'wipe-left' ? "255*X/1279" : "255*(1-X/1279)";
        filterParts.push(
          `color=c=black:s=1280x2:r=30:d=${seconds(duration)},geq=lum='${gradient}':cb=128:cr=128,scale=1280:720,format=gray[wgrad${index}]`
        );
        filterParts.push(
          `color=c=white:s=1280x720:r=30:d=${seconds(duration)},format=gray,fade=t=in:st=${seconds(start)}:d=${seconds(d)}[wramp${index}]`
        );
        filterParts.push(
          `[wgrad${index}][wramp${index}]blend=all_expr='if(lte(A,B),255,0)'[wm${index}]`
        );
        filterParts.push(`[${layerLabel}][wm${index}]alphamerge[va${index}]`);
        layerLabel = `va${index}`;
      }

      const overlayEnd = end + extendSeconds;
      let xOption = '';
      if (incoming?.type === 'slide-left') {
        const d = incoming.durationSeconds;
        xOption = `:x='if(lt(t,${seconds(start)}),W,if(lt(t,${seconds(start + d)}),W*(1-(t-${seconds(start)})/${seconds(d)}),0))'`;
      } else if (incoming?.type === 'slide-right') {
        const d = incoming.durationSeconds;
        xOption = `:x='if(lt(t,${seconds(start)}),-W,if(lt(t,${seconds(start + d)}),-W+W*(t-${seconds(start)})/${seconds(d)},0))'`;
      }
      const overlayLabel = `vo${index}`;
      filterParts.push(
        `[${videoLabel}][${layerLabel}]overlay=0:0${xOption}:eof_action=pass:enable='between(t,${seconds(start)},${seconds(overlayEnd)})'[${overlayLabel}]`
      );
      videoLabel = overlayLabel;

      if (incoming?.type === 'fade-white') {
        const half = incoming.durationSeconds / 2;
        filterParts.push(
          `color=c=white:s=1280x720:r=30:d=${seconds(duration)},format=rgba,fade=t=in:st=${seconds(start - half)}:d=${seconds(half)}:alpha=1,fade=t=out:st=${seconds(start)}:d=${seconds(half)}:alpha=1[wf${index}]`
        );
        filterParts.push(`[${videoLabel}][wf${index}]overlay=0:0[vo${index}f]`);
        videoLabel = `vo${index}f`;
      }
    });
    textArtifacts.forEach(({ fontFile, textFile, entry }, index) => {
      const { text, clip } = entry;
      const start = clip.timelineStartSeconds;
      const end = start + (clip.durationSeconds ?? 0);
      const entrance = toAnimationWindow(text.animation?.entrance);
      const exit = toAnimationWindow(text.animation?.exit);
      const baseX =
        text.alignment === 'left'
          ? `w*${text.x.toFixed(4)}`
          : text.alignment === 'right'
            ? `w*${text.x.toFixed(4)}-text_w`
            : `w*${text.x.toFixed(4)}-text_w/2`;
      const baseY = `h*${text.y.toFixed(4)}`;
      const boxOption =
        text.backgroundOpacity > 0
          ? `box=1:boxcolor=${text.backgroundColor}@${text.backgroundOpacity.toFixed(3)}:boxborderw=10`
          : 'box=0';
      const extras = [
        text.shadow ? 'shadowcolor=#000000@0.650:shadowx=2:shadowy=2' : '',
        text.outline
          ? `borderw=${Math.round(text.outlineWidth)}:bordercolor=${text.outlineColor}@0.900`
          : '',
      ].filter(Boolean);

      if (zoomRangeFor(entrance, exit)) {
        // Zoom/pop scale glyphs, which drawtext cannot express. Render the text
        // onto a transparent 2x layer and animate it with zoompan.
        const drawFontSize = Math.max(8, Math.round(text.fontSize * ZOOM_LAYER_DRAW_SCALE));
        const layerX =
          text.alignment === 'left'
            ? `${(ZOOM_LAYER_WIDTH * text.x).toFixed(1)}`
            : text.alignment === 'right'
              ? `${(ZOOM_LAYER_WIDTH * text.x).toFixed(1)}-text_w`
              : `${(ZOOM_LAYER_WIDTH * text.x).toFixed(1)}-text_w/2`;
        const layerY = `${(ZOOM_LAYER_HEIGHT * text.y).toFixed(1)}`;
        const anchorX =
          text.alignment === 'left'
            ? ZOOM_LAYER_WIDTH * text.x + (text.width * ZOOM_LAYER_WIDTH) / 2
            : text.alignment === 'right'
              ? ZOOM_LAYER_WIDTH * text.x - (text.width * ZOOM_LAYER_WIDTH) / 2
              : ZOOM_LAYER_WIDTH * text.x;
        const anchorY = ZOOM_LAYER_HEIGHT * text.y + drawFontSize * 0.6;
        const zoomExpression = zoomScaleExpression({
          timeVar: '(in/30)',
          clipStart: start,
          clipEnd: end,
          entrance,
          exit,
        });
        const layerOptions = [
          `fontfile=${fontFile}`,
          `textfile=${textFile}`,
          'expansion=none',
          `fontsize=${drawFontSize}`,
          `fontcolor=${text.fontColor}@${text.textOpacity.toFixed(3)}`,
          `text_align=${text.alignment}`,
          'line_spacing=12',
          `x=${layerX}`,
          `y=${layerY}`,
          text.backgroundOpacity > 0
            ? `box=1:boxcolor=${text.backgroundColor}@${text.backgroundOpacity.toFixed(3)}:boxborderw=20`
            : 'box=0',
          text.shadow ? 'shadowcolor=#000000@0.650:shadowx=4:shadowy=4' : '',
          text.outline
            ? `borderw=${Math.round(text.outlineWidth * 2)}:bordercolor=${text.outlineColor}@0.900`
            : '',
        ].filter(Boolean);
        filterParts.push(
          `color=c=black@0.0:s=${ZOOM_LAYER_WIDTH}x${ZOOM_LAYER_HEIGHT}:r=30:d=${seconds(duration)},format=rgba,drawtext=${layerOptions.join(':')},zoompan=z='${zoomExpression}':x='${anchorX.toFixed(1)}-iw/zoom/2':y='${anchorY.toFixed(1)}-ih/zoom/2':d=1:s=1280x720:fps=30[tx${index}]`
        );
        const nextLabel = `vt${index}`;
        filterParts.push(
          `[${videoLabel}][tx${index}]overlay=0:0:format=auto:enable='between(t,${seconds(start)},${seconds(end)})'[${nextLabel}]`
        );
        videoLabel = nextLabel;
        return;
      }

      const dx = slideOffsetExpression({
        axis: 'x',
        size: 1280,
        timeVar: 't',
        clipStart: start,
        clipEnd: end,
        entrance,
        exit,
      });
      const dy = slideOffsetExpression({
        axis: 'y',
        size: 720,
        timeVar: 't',
        clipStart: start,
        clipEnd: end,
        entrance,
        exit,
      });
      const opacityFactor = opacityFactorExpression({
        timeVar: 't',
        clipStart: start,
        clipEnd: end,
        entrance: entrance?.type === 'fade' ? entrance : null,
        exit: exit?.type === 'fade' ? exit : null,
      });
      const xOption = dx ? `x='(${baseX})+(${dx})'` : `x=${baseX}`;
      const yOption = dy ? `y='(${baseY})+(${dy})'` : `y=${baseY}`;
      const colourOption = opacityFactor
        ? [`fontcolor=${text.fontColor}@1.000`, `alpha='(${opacityFactor})*${text.textOpacity.toFixed(3)}'`]
        : [`fontcolor=${text.fontColor}@${text.textOpacity.toFixed(3)}`];
      const options = [
        `fontfile=${fontFile}`,
        `textfile=${textFile}`,
        'expansion=none',
        `fontsize=${Math.round(text.fontSize)}`,
        ...colourOption,
        `text_align=${text.alignment}`,
        'line_spacing=6',
        xOption,
        yOption,
        boxOption,
        ...extras,
        `enable='between(t,${seconds(start)},${seconds(end)})'`,
      ].filter(Boolean);
      const nextLabel = `vt${index}`;
      filterParts.push(`[${videoLabel}]drawtext=${options.join(':')}[${nextLabel}]`);
      videoLabel = nextLabel;
    });
    filterParts.push(`[${videoLabel}]format=yuv420p[vout]`);

    const audioLabels: string[] = [];
    audioClips.forEach(({ clip, track }, index) => {
      const inputIndex = videoClips.length + index;
      const { inPoint, outPoint } = clipRange(clip);
      const delayMs = Math.round(clip.timelineStartSeconds * 1000);
      const clipDuration = clip.durationSeconds ?? 0;
      const gain = (clip.audio?.volume ?? 1) * (track.volume ?? 1);
      const chain = [
        `atrim=start=${seconds(inPoint)}:end=${seconds(outPoint)}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
      ];
      if (Math.abs(gain - 1) > 0.0001) chain.push(`volume=${gain.toFixed(3)}`);
      const fadeIn = clip.audio?.fadeInSeconds ?? 0;
      const fadeOut = clip.audio?.fadeOutSeconds ?? 0;
      if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`);
      if (fadeOut > 0) {
        chain.push(`afade=t=out:st=${seconds(Math.max(0, clipDuration - fadeOut))}:d=${seconds(fadeOut)}`);
      }
      // `adelay` shifts the clip onto the timeline, so the padded stream is not
      // trimmed back to [0, duration]: a trailing atrim would drop every sample
      // after the delay offset and silence clips that start later than 0.
      chain.push(`adelay=delays=${delayMs}:all=1`, `apad=whole_dur=${seconds(duration)}`);
      filterParts.push(`[${inputIndex}:a]${chain.join(',')}[a${index}]`);
      audioLabels.push(`[a${index}]`);
    });
    if (audioLabels.length === 1) {
      filterParts.push(`${audioLabels[0]}anull[aout]`);
    } else if (audioLabels.length > 1) {
      filterParts.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest:dropout_transition=0,alimiter=limit=0.95[aout]`
      );
    }

    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
    for (const inputPath of inputPaths) args.push('-i', inputPath);
    args.push('-filter_complex', filterParts.join(';'), '-map', '[vout]');
    if (audioClips.length > 0) {
      args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    } else {
      args.push('-an');
    }
    args.push(
      '-t',
      seconds(duration),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      '-y',
      outputPath
    );

    try {
      await runner(config.video.ffmpegPath, args, params.workDir);
    } catch (error) {
      throw renderProcessError(error, params.workDir);
    }

    const outputStat = await fs.stat(outputPath).catch(() => null);
    if (!outputStat?.isFile() || outputStat.size === 0) {
      throw new VideoProviderError(
        'Rendered output is empty or missing.',
        'validation',
        false
      );
    }
    const metadata = await probe(outputPath, runner, params.workDir);
    if (audioClips.length > 0 && !metadata.hasAudio) {
      throw new VideoProviderError(
        'Rendered output is missing the required AAC audio stream.',
        'validation',
        false
      );
    }
    completed = true;
    return { outputPath, ...metadata };
  } finally {
    await Promise.all(temporaryFiles.map((file) => fs.rm(file, { force: true })));
    if (!completed) await fs.rm(outputPath, { force: true });
  }
}
