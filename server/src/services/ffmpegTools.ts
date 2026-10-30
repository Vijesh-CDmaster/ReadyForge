import { spawn } from 'node:child_process';
import { config } from '../config';
import { VideoProviderError } from './videoProvider';

export type VideoToolName = 'ffmpeg' | 'ffprobe';

export type ToolRunner = (
  command: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

export interface VideoToolStatus {
  name: VideoToolName;
  executable: string;
  source: 'environment' | 'path';
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface VideoRenderingToolsStatus {
  available: boolean;
  ffmpeg: VideoToolStatus;
  ffprobe: VideoToolStatus;
  missingCodecs: string[];
  message: string | null;
}

export interface ToolCheckOptions {
  runner?: ToolRunner;
  ffmpegPath?: string;
  ffprobePath?: string;
  ffmpegConfigured?: boolean;
  ffprobeConfigured?: boolean;
  refresh?: boolean;
}

const CHECK_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;
const REQUIRED_ENCODERS = ['libx264', 'aac'] as const;

let cached: { checkedAt: number; value: VideoRenderingToolsStatus } | null = null;

const envName = (name: VideoToolName) => `${name.toUpperCase()}_PATH`;

function cleanDetail(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

const defaultRunner: ToolRunner = (command, args) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout>;
    const child = spawn(command, args, {
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
      killTimer = setTimeout(() => finish(() => reject(new Error('tool check timed out'))), 2_000);
    }, CHECK_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      finish(() => {
        if (timedOut) reject(new Error('tool check timed out'));
        else if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`executable exited with code ${code}`));
      });
    });
  });

function startupError(
  name: VideoToolName,
  executable: string,
  source: VideoToolStatus['source'],
  error: unknown
): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  const configuredWith = envName(name);
  const detail = error instanceof Error ? cleanDetail(error.message) : '';
  if (code === 'ENOENT') {
    return source === 'environment'
      ? `${configuredWith} is set to "${executable}", but no executable could be started at that path. Check that the file exists and points to ${name}. Rendering is unavailable; other features still work.`
      : `${name} was not found on PATH. Install FFmpeg locally, add its bin directory to PATH, or set ${configuredWith} to the full path of the ${name} executable. Rendering is unavailable; other features still work. See docs/VIDEO_RENDERING.md.`;
  }
  if (code === 'EACCES' || code === 'EPERM') {
    const label = source === 'environment' ? configuredWith : name;
    return `${label} points at "${executable}", but the file is not executable. On Windows use the full path to ${name}.exe; on macOS/Linux check the file permissions. Rendering is unavailable.`;
  }
  const suffix = detail && detail !== 'tool check timed out' ? ` (${detail})` : '';
  return `${name} could not be started from "${executable}"${suffix}. Verify the executable and ${configuredWith}. Rendering is unavailable; other features still work.`;
}

async function checkTool(
  name: VideoToolName,
  executable: string,
  source: VideoToolStatus['source'],
  runner: ToolRunner
): Promise<VideoToolStatus> {
  const base = { name, executable, source };
  try {
    const { stdout, stderr } = await runner(executable, ['-version']);
    const output = `${stdout}\n${stderr}`;
    const match = output.match(new RegExp(`^${name} version (\\S+)`, 'im'));
    if (!match) {
      const other = output.match(/^(ffmpeg|ffprobe) version (\S+)/im);
      const error = other
        ? `${envName(name)} points to an executable that reports "${other[1]} version ${other[2]}" instead of ${name}. Set ${envName(name)} to the ${name} executable.`
        : `${name} did not report a recognizable version. Verify that "${executable}" is a working FFmpeg ${name} executable, not a placeholder or wrapper.`;
      return { ...base, available: false, version: null, error };
    }
    return { ...base, available: true, version: match[1], error: null };
  } catch (error) {
    return {
      ...base,
      available: false,
      version: null,
      error: startupError(name, executable, source, error),
    };
  }
}

async function missingEncoders(executable: string, runner: ToolRunner): Promise<string[]> {
  const { stdout, stderr } = await runner(executable, ['-hide_banner', '-encoders']);
  const output = `${stdout}\n${stderr}`;
  return REQUIRED_ENCODERS.filter(
    (encoder) => !new RegExp(`^\\s*[A-Z.]{6}\\s+${encoder}\\b`, 'm').test(output)
  );
}

/**
 * Detects the configured (or PATH-resolved) FFmpeg/FFprobe executables and
 * verifies that they run, report a version, and expose the encoders this
 * renderer needs. Never downloads or installs anything.
 */
export async function getVideoRenderingTools(
  options: ToolCheckOptions = {}
): Promise<VideoRenderingToolsStatus> {
  const useCache =
    !options.refresh &&
    !options.runner &&
    options.ffmpegPath === undefined &&
    options.ffprobePath === undefined;
  if (useCache && cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const runner = options.runner || defaultRunner;
  const ffmpegPath = options.ffmpegPath ?? config.video.ffmpegPath;
  const ffprobePath = options.ffprobePath ?? config.video.ffprobePath;
  const ffmpegConfigured =
    options.ffmpegConfigured ?? Boolean(process.env.FFMPEG_PATH?.trim());
  const ffprobeConfigured =
    options.ffprobeConfigured ?? Boolean(process.env.FFPROBE_PATH?.trim());

  const [ffmpeg, ffprobe] = await Promise.all([
    checkTool('ffmpeg', ffmpegPath, ffmpegConfigured ? 'environment' : 'path', runner),
    checkTool('ffprobe', ffprobePath, ffprobeConfigured ? 'environment' : 'path', runner),
  ]);

  const missingCodecs: string[] = [];
  const messages: string[] = [];
  if (ffmpeg.error) messages.push(ffmpeg.error);
  if (ffprobe.error) messages.push(ffprobe.error);

  if (ffmpeg.available) {
    try {
      missingCodecs.push(...(await missingEncoders(ffmpeg.executable, runner)));
      if (missingCodecs.length > 0) {
        messages.push(
          `The installed FFmpeg build is missing the ${missingCodecs.join(
            ' and '
          )} encoder${missingCodecs.length === 1 ? '' : 's'} required for H.264/AAC MP4 output. Use a build that includes libx264 (GPL builds) and FFmpeg's native AAC encoder. See docs/VIDEO_RENDERING.md.`
        );
      }
    } catch (error) {
      messages.push(
        `FFmpeg is installed, but its available encoders could not be inspected${
          error instanceof Error ? ` (${cleanDetail(error.message)})` : ''
        }. Verify that the executable is a complete FFmpeg build.`
      );
    }
  }

  const available =
    ffmpeg.available && ffprobe.available && missingCodecs.length === 0 && messages.length === 0;
  const value: VideoRenderingToolsStatus = {
    available,
    ffmpeg,
    ffprobe,
    missingCodecs,
    message: available ? null : messages.filter(Boolean).join(' '),
  };

  if (useCache) cached = { checkedAt: Date.now(), value };
  return value;
}

export interface MediaProbeResult {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Reads trusted media duration and dimensions from an uploaded file. Returns
 * null rather than failing the upload when FFprobe is unavailable or the file
 * is not valid media; callers can then treat the asset as having unknown
 * duration and block trimming/rendering that depends on it.
 */
export async function probeMediaFile(
  filePath: string,
  options: { runner?: ToolRunner; ffprobePath?: string } = {}
): Promise<MediaProbeResult | null> {
  const runner = options.runner || defaultRunner;
  try {
    const result = await runner(options.ffprobePath ?? config.video.ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      filePath,
    ]);
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const duration = Number(parsed.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    return {
      durationSeconds: duration,
      width: typeof video?.width === 'number' && video.width > 0 ? video.width : null,
      height: typeof video?.height === 'number' && video.height > 0 ? video.height : null,
      hasVideo: Boolean(video),
      hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    };
  } catch {
    return null;
  }
}

export function resetVideoRenderingToolsCache(): void {
  cached = null;
}

export async function assertVideoRenderingAvailable(): Promise<VideoRenderingToolsStatus> {
  const status = await getVideoRenderingTools();
  if (!status.available) {
    throw new VideoProviderError(
      `Video rendering is unavailable. ${status.message || 'FFmpeg and FFprobe must be configured.'}`,
      'validation',
      false
    );
  }
  return status;
}
