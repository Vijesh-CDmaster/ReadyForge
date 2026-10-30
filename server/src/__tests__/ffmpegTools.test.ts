import { describe, expect, it } from 'vitest';
import { getVideoRenderingTools, probeMediaFile, ToolRunner } from '../services/ffmpegTools';

const ENCODERS = [
  'Encoders:',
  ' V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
  ' A..... aac                  AAC (Advanced Audio Coding)',
].join('\n');

function runner(options: {
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  encoders?: string;
  onFfmpeg?: () => void;
  onFfprobe?: () => void;
} = {}): ToolRunner {
  return async (command, args) => {
    const isProbe = command.includes('ffprobe');
    if (args[0] === '-version') {
      if (isProbe && options.onFfprobe) options.onFfprobe();
      if (!isProbe && options.onFfmpeg) options.onFfmpeg();
      return {
        stdout: `${isProbe ? options.ffprobeVersion ?? 'ffprobe version 7.1.1 Copyright' : options.ffmpegVersion ?? 'ffmpeg version 7.1.1 Copyright'}\n`,
        stderr: '',
      };
    }
    if (args.includes('-encoders')) return { stdout: options.encoders ?? ENCODERS, stderr: '' };
    throw new Error('unexpected command');
  };
}

describe('local video tool detection', () => {
  it('reports configured executables, versions, and required encoders as available', async () => {
    const status = await getVideoRenderingTools({
      ffmpegPath: 'C:/tools/ffmpeg.exe',
      ffprobePath: 'C:/tools/ffprobe.exe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: runner(),
    });
    expect(status.available).toBe(true);
    expect(status.missingCodecs).toEqual([]);
    expect(status.message).toBeNull();
    expect(status.ffmpeg).toMatchObject({
      executable: 'C:/tools/ffmpeg.exe',
      source: 'environment',
      available: true,
      version: '7.1.1',
    });
    expect(status.ffprobe).toMatchObject({ version: '7.1.1', available: true });
  });

  it('reports missing PATH tools with actionable installation guidance', async () => {
    const status = await getVideoRenderingTools({
      ffmpegConfigured: false,
      ffprobeConfigured: false,
      runner: async () => {
        throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(status.available).toBe(false);
    expect(status.ffmpeg.error).toContain('was not found on PATH');
    expect(status.ffmpeg.error).toContain('FFMPEG_PATH');
    expect(status.message).toContain('not found on PATH');
  });

  it('reports an invalid configured path instead of a generic failure', async () => {
    const status = await getVideoRenderingTools({
      ffmpegPath: 'C:/missing/ffmpeg.exe',
      ffprobePath: 'C:/missing/ffprobe.exe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: async () => {
        throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(status.available).toBe(false);
    expect(status.ffmpeg.error).toContain('FFMPEG_PATH is set to "C:/missing/ffmpeg.exe"');
    expect(status.message).toContain('Rendering is unavailable');
  });

  it('rejects an executable that reports the wrong tool or no recognizable version', async () => {
    const wrongTool = await getVideoRenderingTools({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: runner({ ffmpegVersion: 'ffprobe version 7.1.1 Copyright' }),
    });
    expect(wrongTool.available).toBe(false);
    expect(wrongTool.ffmpeg.error).toContain('reports "ffprobe version 7.1.1"');

    const noVersion = await getVideoRenderingTools({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: runner({ ffmpegVersion: 'this is not ffmpeg', ffprobeVersion: 'nor this' }),
    });
    expect(noVersion.available).toBe(false);
    expect(noVersion.ffmpeg.error).toContain('did not report a recognizable version');
  });

  it('reports a build that lacks the libx264 encoder required for H.264 MP4 output', async () => {
    const status = await getVideoRenderingTools({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: runner({ encoders: 'Encoders:\n A..... aac                  AAC' }),
    });
    expect(status.available).toBe(false);
    expect(status.missingCodecs).toEqual(['libx264']);
    expect(status.message).toContain('libx264');
    expect(status.message).toContain('GPL builds');
  });

  it('reads trusted uploaded-media duration and dimensions with FFprobe', async () => {
    const result = await probeMediaFile('fixture.mp4', {
      ffprobePath: 'ffprobe',
      runner: async () => ({
        stdout: JSON.stringify({
          format: { duration: '2.048000' },
          streams: [
            { codec_type: 'video', width: 640, height: 360 },
            { codec_type: 'audio' },
          ],
        }),
        stderr: '',
      }),
    });
    expect(result).toMatchObject({
      durationSeconds: 2.048,
      width: 640,
      height: 360,
      hasVideo: true,
      hasAudio: true,
    });
  });

  it('returns null for malformed or unprobeable uploaded media', async () => {
    await expect(
      probeMediaFile('broken.mp4', {
        runner: async () => ({ stdout: 'not-json', stderr: '' }),
      })
    ).resolves.toBeNull();
    await expect(
      probeMediaFile('missing.mp4', {
        runner: async () => {
          throw new Error('spawn ffprobe ENOENT');
        },
      })
    ).resolves.toBeNull();
  });

  it('reports an encoder inspection failure without claiming rendering works', async () => {
    const status = await getVideoRenderingTools({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      ffmpegConfigured: true,
      ffprobeConfigured: true,
      runner: async (command, args) => {
        if (args.includes('-encoders')) throw new Error('executable exited with code 1');
        return {
          stdout: `${command.includes('ffprobe') ? 'ffprobe' : 'ffmpeg'} version 7.1.1 Copyright`,
          stderr: '',
        };
      },
    });
    expect(status.available).toBe(false);
    expect(status.message).toContain('encoders could not be inspected');
  });
});
