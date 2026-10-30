import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IAsset } from '../models/Asset';
import {
  ICompositionClip,
  ICompositionTrack,
  IEditComposition,
  resolveCompositionTracks,
} from '../models/EditComposition';
import { config } from '../config';
import { VideoProviderError } from './videoProvider';

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
 * contribute to the render. Hidden video tracks and muted audio tracks are
 * explicit user choices, not unsupported content. Text/overlay tracks are
 * modelled but cannot be rendered yet, so any text clip is rejected.
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
    if (track.type === 'text') {
      throw new VideoProviderError(
        'Text and overlay tracks are saved but not renderable yet. Remove text clips before rendering.',
        'validation',
        false
      );
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
  const visibleVideoTrackIds = new Set(visibleVideoTracks.map((track) => track.trackId));
  const unmutedAudioTrackIds = new Set(unmutedAudioTracks.map((track) => track.trackId));

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

  for (const track of tracks) {
    if (track.type === 'text') continue;
    const active =
      track.type === 'video' ? visibleVideoTrackIds.has(track.trackId) : unmutedAudioTrackIds.has(track.trackId);
    if (!active) continue;
    const clips = byTrack(track);
    let previousEnd = -1;
    for (const clip of clips) {
      const asset = assetsById.get(clip.assetId.toString());
      if (!asset) {
        throw new VideoProviderError(
          'A composition source asset is unavailable.',
          'validation',
          false
        );
      }
      assertClipSupported(clip, track.type, asset);
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

  const duration = [...videoClips, ...audioClips].reduce(
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
  return { videoClips, audioClips, duration };
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
}): Promise<RenderResult> {
  const runner = params.runner || runProcess;
  const assetsById = new Map(params.assets.map((asset) => [asset._id.toString(), asset]));
  const { videoClips, audioClips, duration } = validateTimeline(params.composition, assetsById);

  await fs.mkdir(params.workDir, { recursive: true });
  const inputs = [...videoClips.map((entry) => entry.clip), ...audioClips.map((entry) => entry.clip)];
  const stagedPaths: string[] = [];
  const outputPath = path.join(params.workDir, 'render.mp4');
  let completed = false;
  try {
    for (let index = 0; index < inputs.length; index += 1) {
      const asset = assetsById.get(inputs[index].assetId.toString())!;
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
      stagedPaths.push(stagedPath);
    }

    const filterParts: string[] = [];
    filterParts.push(`color=c=black:s=1280x720:r=30:d=${seconds(duration)},setsar=1[base]`);
    let videoLabel = 'base';
    videoClips.forEach(({ clip }, index) => {
      const { inPoint, outPoint } = clipRange(clip);
      const start = clip.timelineStartSeconds;
      const end = start + (clip.durationSeconds ?? 0);
      filterParts.push(
        `[${index}:v]trim=start=${seconds(inPoint)}:end=${seconds(outPoint)},setpts=PTS-STARTPTS+${seconds(start)}/TB,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`
      );
      const nextLabel = `vo${index}`;
      filterParts.push(
        `[${videoLabel}][v${index}]overlay=0:0:eof_action=pass:enable='between(t,${seconds(start)},${seconds(end)})'[${nextLabel}]`
      );
      videoLabel = nextLabel;
    });
    filterParts.push(`[${videoLabel}]format=yuv420p[vout]`);

    const audioLabels: string[] = [];
    audioClips.forEach(({ clip }, index) => {
      const inputIndex = videoClips.length + index;
      const { inPoint, outPoint } = clipRange(clip);
      const delayMs = Math.round(clip.timelineStartSeconds * 1000);
      filterParts.push(
        `[${inputIndex}:a]atrim=start=${seconds(inPoint)}:end=${seconds(outPoint)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=delays=${delayMs}:all=1,apad=whole_dur=${seconds(duration)},atrim=start=0:end=${seconds(duration)}[a${index}]`
      );
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
    for (const stagedPath of stagedPaths) args.push('-i', stagedPath);
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
    await Promise.all(stagedPaths.map((file) => fs.rm(file, { force: true })));
    if (!completed) await fs.rm(outputPath, { force: true });
  }
}
