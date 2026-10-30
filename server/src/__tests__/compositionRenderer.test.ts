import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { config } from '../config';
import { Asset } from '../models/Asset';
import { EditComposition, ICompositionClip } from '../models/EditComposition';
import { renderComposition, runProcess } from '../services/compositionRenderer';

const id = () => new Types.ObjectId();

async function fixture(withAudio = false) {
  const projectId = id();
  const workspaceId = id();
  const videoId = id();
  const audioId = id();
  await fs.mkdir(config.upload.dir, { recursive: true });
  await fs.writeFile(path.join(config.upload.dir, `render-test-${videoId}.mp4`), 'video-source');
  const video = {
    _id: videoId,
    projectId,
    workspaceId,
    fileUrl: `/uploads/render-test-${videoId}.mp4`,
    name: 'video.mp4',
    type: 'video',
    sourceDurationSeconds: 4,
  } as unknown as InstanceType<typeof Asset>;
  const assets = [video];
  const clips: ICompositionClip[] = [
    {
      _id: id(),
      assetId: videoId,
      trackId: 'video-1',
      trackType: 'video' as const,
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 4,
      durationSeconds: 4,
    },
  ];
  if (withAudio) {
    await fs.writeFile(path.join(config.upload.dir, `render-test-${audioId}.wav`), 'audio-source');
    assets.push({
      _id: audioId,
      projectId,
      workspaceId,
      fileUrl: `/uploads/render-test-${audioId}.wav`,
      name: 'audio.wav',
      type: 'audio',
      sourceDurationSeconds: 4,
    } as unknown as InstanceType<typeof Asset>);
    clips.push({
      _id: id(),
      assetId: audioId,
      trackId: 'audio-1',
      trackType: 'audio',
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 4,
      durationSeconds: 4,
    });
  }
  const composition = {
    _id: id(),
    projectId,
    workspaceId,
    ownerId: id(),
    schemaVersion: 1,
    clips,
  } as unknown as InstanceType<typeof EditComposition>;
  return { composition, assets, files: assets.map((asset) => path.basename(asset.fileUrl)) };
}

function probePayload(options: {
  audio?: boolean;
  videoCodec?: string;
  audioCodec?: string;
} = {}) {
  return JSON.stringify({
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '4' },
    streams: [
      { codec_type: 'video', codec_name: options.videoCodec ?? 'h264', width: 1280, height: 720 },
      ...(options.audio ? [{ codec_type: 'audio', codec_name: options.audioCodec ?? 'aac' }] : []),
    ],
  });
}

function fakeRunner(audio: boolean, fail = false, options: { videoCodec?: string; audioCodec?: string } = {}) {
  return async (command: string, args: string[]) => {
    if (fail) throw new Error('spawn failed');
    if (command === config.video.ffmpegPath) {
      await fs.writeFile(args[args.length - 1], 'not-a-real-mp4');
      return { stdout: '', stderr: '' };
    }
    return {
      stdout: probePayload({ audio, ...options }),
      stderr: '',
    };
  };
}

async function cleanup(files: string[]) {
  await Promise.all(files.map((file) => fs.rm(path.join(config.upload.dir, file), { force: true })));
}

beforeEach(async () => {
  await fs.mkdir(config.dataDir, { recursive: true });
});

describe('composition renderer', () => {
  it('renders video-only and video-plus-audio compositions through an injectable process runner', async () => {
    for (const withAudio of [false, true]) {
      const fixtureData = await fixture(withAudio);
      const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
      const result = await renderComposition({
        composition: fixtureData.composition,
        assets: fixtureData.assets,
        workDir,
        runner: fakeRunner(withAudio),
      });
      expect(result.durationSeconds).toBe(4);
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.hasAudio).toBe(withAudio);
      expect(result.outputPath).toBe(path.join(workDir, 'render.mp4'));
      await fs.rm(workDir, { recursive: true, force: true });
      await cleanup(fixtureData.files);
    }
  });

  it('rejects unknown duration, missing assets, text clips, overlaps, invalid ranges, and mismatched metadata', async () => {
    const fixtureData = await fixture(true);
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const run = () =>
      renderComposition({
        composition: fixtureData.composition,
        assets: fixtureData.assets,
        workDir,
        runner: fakeRunner(true),
      });

    const clip = fixtureData.composition.clips[0];
    clip.durationSeconds = undefined;
    await expect(run()).rejects.toThrow('trusted positive duration');

    clip.durationSeconds = 4;
    clip.assetId = id();
    await expect(run()).rejects.toThrow('source asset');

    clip.assetId = fixtureData.assets[0]._id;
    fixtureData.composition.clips.push({
      _id: id(),
      assetId: fixtureData.assets[0]._id,
      trackId: 'text-1',
      trackType: 'text',
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 1,
      durationSeconds: 1,
    });
    await expect(run()).rejects.toThrow('not renderable yet');
    fixtureData.composition.clips.pop();

    fixtureData.composition.clips.push({
      _id: id(),
      assetId: fixtureData.assets[0]._id,
      trackId: 'video-1',
      trackType: 'video',
      timelineStartSeconds: 2,
      sourceInSeconds: 0,
      sourceOutSeconds: 4,
      durationSeconds: 4,
    });
    await expect(run()).rejects.toThrow('overlap');
    fixtureData.composition.clips.pop();

    clip.sourceInSeconds = 3;
    clip.sourceOutSeconds = 2;
    await expect(run()).rejects.toThrow('out-point after its in-point');

    clip.sourceInSeconds = 0;
    clip.sourceOutSeconds = 4;
    clip.durationSeconds = 3;
    await expect(run()).rejects.toThrow('does not match its source range');

    clip.durationSeconds = 6;
    clip.sourceInSeconds = 2;
    clip.sourceOutSeconds = 8;
    await expect(run()).rejects.toThrow('past the end');

    await cleanup(fixtureData.files);
  });

  it('renders multiple video and audio tracks with timeline offsets and audio mixing', async () => {
    const fixtureData = await fixture(true);
    const [video, audio] = fixtureData.assets;
    fixtureData.composition.clips.push(
      {
        _id: id(),
        assetId: video._id,
        trackId: 'video-2',
        trackType: 'video',
        timelineStartSeconds: 2,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
        durationSeconds: 2,
        order: 0,
      },
      {
        _id: id(),
        assetId: audio._id,
        trackId: 'audio-2',
        trackType: 'audio',
        timelineStartSeconds: 1,
        sourceInSeconds: 1,
        sourceOutSeconds: 3,
        durationSeconds: 2,
        order: 0,
      }
    );
    let captured: string[] = [];
    const runner = async (command: string, args: string[]) => {
      if (command === config.video.ffmpegPath) {
        captured = args;
        await fs.writeFile(args[args.length - 1], 'rendered');
        return { stdout: '', stderr: '' };
      }
      return { stdout: probePayload({ audio: true }), stderr: '' };
    };
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const result = await renderComposition({
      composition: fixtureData.composition,
      assets: fixtureData.assets,
      workDir,
      runner,
    });
    const graph = captured[captured.indexOf('-filter_complex') + 1];
    expect(result.durationSeconds).toBe(4);
    expect(graph).toContain('color=c=black:s=1280x720:r=30:d=4.000');
    expect(graph).toContain("enable='between(t,2.000,4.000)'");
    expect(graph).toContain('adelay=delays=1000:all=1');
    expect(graph).toContain('amix=inputs=2:normalize=0');
    expect(captured).toContain('-t');
    await fs.rm(workDir, { recursive: true, force: true });
    await cleanup(fixtureData.files);
  });

  it('does not render hidden video tracks or muted audio tracks', async () => {
    const fixtureData = await fixture(true);
    fixtureData.composition.tracks = [
      { trackId: 'video-1', name: 'Video 1', type: 'video', order: 0, muted: false, hidden: true, locked: false },
      { trackId: 'video-2', name: 'Video 2', type: 'video', order: 1, muted: false, hidden: false, locked: false },
      { trackId: 'audio-1', name: 'Audio 1', type: 'audio', order: 2, muted: true, hidden: false, locked: false },
    ];
    fixtureData.composition.clips.push({
      _id: id(),
      assetId: fixtureData.assets[0]._id,
      trackId: 'video-2',
      trackType: 'video',
      timelineStartSeconds: 2,
      sourceInSeconds: 0,
      sourceOutSeconds: 2,
      durationSeconds: 2,
      order: 0,
    });
    let captured: string[] = [];
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    await renderComposition({
      composition: fixtureData.composition,
      assets: fixtureData.assets,
      workDir,
      runner: async (command, args) => {
        if (command === config.video.ffmpegPath) {
          captured = args;
          await fs.writeFile(args[args.length - 1], 'rendered');
          return { stdout: '', stderr: '' };
        }
        return { stdout: probePayload(), stderr: '' };
      },
    });
    const graph = captured[captured.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain("between(t,0.000,4.000)'[vo");
    expect(captured).not.toContain('[aout]');
    await fs.rm(workDir, { recursive: true, force: true });
    await cleanup(fixtureData.files);
  });

  it('rejects malformed probe metadata, non-MP4 containers, wrong codecs, missing video, invalid dimensions, and missing audio', async () => {
    const fixtureData = await fixture(true);
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const probeCases = [
      { stdout: 'not-json', expected: 'malformed metadata' },
      {
        stdout: JSON.stringify({ format: { format_name: 'matroska', duration: '4' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }] }),
        expected: 'not a valid H.264/AAC MP4',
      },
      {
        stdout: JSON.stringify({ format: { format_name: 'mp4', duration: '4' }, streams: [{ codec_type: 'audio', codec_name: 'aac' }] }),
        expected: 'not a valid H.264/AAC MP4',
      },
      {
        stdout: JSON.stringify({ format: { format_name: 'mp4', duration: '4' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 0, height: 720 }] }),
        expected: 'not a valid H.264/AAC MP4',
      },
      { stdout: probePayload({ audio: true, videoCodec: 'vp9' }), expected: 'not a valid H.264/AAC MP4' },
      { stdout: probePayload({ audio: true, audioCodec: 'mp3' }), expected: 'not a valid H.264/AAC MP4' },
      { stdout: probePayload({ audio: false }), expected: 'missing the required AAC audio stream' },
    ];
    for (const probeCase of probeCases) {
      const runner = async (command: string, args: string[]) => {
        if (command === config.video.ffmpegPath) {
          await fs.writeFile(args[args.length - 1], 'output');
          return { stdout: '', stderr: '' };
        }
        return { stdout: probeCase.stdout, stderr: '' };
      };
      await expect(
        renderComposition({ composition: fixtureData.composition, assets: fixtureData.assets, workDir, runner })
      ).rejects.toThrow(probeCase.expected);
    }
    await cleanup(fixtureData.files);
  });

  it('reports process failures, missing FFmpeg, malformed probe failures, and timeout clearly', async () => {
    const fixtureData = await fixture();
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const composition = fixtureData.composition;
    const assets = fixtureData.assets;

    await expect(
      renderComposition({
        composition,
        assets,
        workDir,
        runner: async (command, args) => {
          if (command === config.video.ffmpegPath) {
            await fs.writeFile(args[args.length - 1], 'output');
            throw new Error('failed');
          }
          return { stdout: probePayload(), stderr: '' };
        },
      })
    ).rejects.toThrow('Video rendering failed.');

    await expect(
      renderComposition({
        composition,
        assets,
        workDir,
        runner: async () => {
          throw new Error('spawn ffmpeg ENOENT');
        },
      })
    ).rejects.toThrow('FFmpeg is unavailable');

    await expect(
      renderComposition({
        composition,
        assets,
        workDir,
        runner: async (command, args) => {
          if (command === config.video.ffmpegPath) {
            await fs.writeFile(args[args.length - 1], 'output');
            return { stdout: '', stderr: '' };
          }
          throw new Error('spawn ffprobe ENOENT');
        },
      })
    ).rejects.toThrow('FFprobe is unavailable');

    const originalTimeout = config.video.renderTimeoutMs;
    config.video.renderTimeoutMs = 25;
    try {
      const started = Date.now();
      await expect(
        runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], workDir)
      ).rejects.toThrow('timed out');
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      config.video.renderTimeoutMs = originalTimeout;
    }

    await cleanup(fixtureData.files);
  });

  it('cleans staged files and failed output after a render failure', async () => {
    const fixtureData = await fixture();
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    await expect(
      renderComposition({
        composition: fixtureData.composition,
        assets: fixtureData.assets,
        workDir,
        runner: async (command, args) => {
          if (command === config.video.ffmpegPath) {
            await fs.writeFile(args[args.length - 1], 'output');
            throw new Error('failed');
          }
          return { stdout: probePayload(), stderr: '' };
        },
      })
    ).rejects.toThrow('Video rendering failed.');

    await expect(fs.access(path.join(workDir, `0-${fixtureData.files[0]}`))).rejects.toThrow();
    await expect(fs.access(path.join(workDir, 'render.mp4'))).rejects.toThrow();
    await cleanup(fixtureData.files);
  });
});
