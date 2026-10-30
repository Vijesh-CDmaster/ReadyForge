import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { config } from '../config';
import { Asset } from '../models/Asset';
import { EditComposition, ICompositionClip } from '../models/EditComposition';
import { renderComposition, runProcess } from '../services/compositionRenderer';

const id = () => new Types.ObjectId();

function textStyle(overrides: Record<string, unknown> = {}) {
  return {
    content: 'Title',
    x: 0.5,
    y: 0.8,
    width: 0.8,
    alignment: 'center',
    fontFamily: 'sans',
    fontSize: 48,
    fontColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.4,
    textOpacity: 1,
    bold: false,
    italic: false,
    shadow: false,
    outline: false,
    outlineColor: '#000000',
    outlineWidth: 2,
    zIndex: 0,
    ...overrides,
  } as unknown as import('../models/EditComposition').ICompositionText;
}

function textClip(overrides: (Omit<Partial<ICompositionClip>, 'text'> & { text?: Record<string, unknown> }) = {}): ICompositionClip {
  const { text, ...clipOverrides } = overrides;
  return {
    _id: id(),
    trackId: 'text-1',
    trackType: 'text',
    timelineStartSeconds: 0,
    sourceInSeconds: 0,
    sourceOutSeconds: 0,
    durationSeconds: 1,
    order: 0,
    text: textStyle(text),
    ...clipOverrides,
  } as ICompositionClip;
}

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

  it('rejects unknown duration, missing assets, invalid text styles, overlaps, invalid ranges, and mismatched metadata', async () => {
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
    const badText = textClip({ text: { content: '   ' } });
    fixtureData.composition.clips.push(badText);
    await expect(run()).rejects.toThrow('no content');
    badText.text = textStyle({ fontColor: 'red' });
    await expect(run()).rejects.toThrow('invalid colour');
    badText.text = textStyle({ fontFamily: '../../etc/passwd' });
    await expect(run()).rejects.toThrow('approved font registry');
    badText.text = textStyle({ fontSize: 400 });
    await expect(run()).rejects.toThrow('invalid font size');
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
    // Delayed clips must not be trimmed back to [0, duration] after adelay, or
    // every sample after the offset is dropped and the clip renders silent.
    expect(graph).not.toMatch(/adelay=delays=\d+:all=1,apad=whole_dur=[\d.]+,atrim/);
    expect(captured).toContain('-t');
    await fs.rm(workDir, { recursive: true, force: true });
    await cleanup(fixtureData.files);
  });

  it('renders multiple text overlays with interval filters and keeps content out of the filter string', async () => {
    const fixtureData = await fixture(true);
    const fontPath = path.join(config.dataDir, `test-font-${id()}.ttf`);
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(fontPath, 'test-font');
    fixtureData.composition.clips.push(
      textClip({
        text: { content: `He said "hello": 100% [safe] & done`, zIndex: 1 },
        timelineStartSeconds: 0,
        durationSeconds: 1,
      }),
      textClip({
        text: {
          content: 'Second title',
          alignment: 'left',
          fontFamily: 'serif',
          bold: true,
          italic: true,
          shadow: true,
          outline: true,
          zIndex: 2,
        },
        timelineStartSeconds: 2,
        durationSeconds: 2,
      })
    );
    let captured: string[] = [];
    let stagedText = '';
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const result = await renderComposition({
      composition: fixtureData.composition,
      assets: fixtureData.assets,
      workDir,
      fontResolver: () => fontPath,
      runner: async (command, args) => {
        if (command === config.video.ffmpegPath) {
          captured = args;
          stagedText = await fs.readFile(path.join(workDir, 'overlay-text-0.txt'), 'utf8');
          await fs.writeFile(args[args.length - 1], 'rendered');
          return { stdout: '', stderr: '' };
        }
        return { stdout: probePayload({ audio: true }), stderr: '' };
      },
    });
    const graph = captured[captured.indexOf('-filter_complex') + 1];
    expect(result.durationSeconds).toBe(4);
    expect(graph).toContain('drawtext=');
    expect(graph).toContain('expansion=none');
    expect(graph).toContain('text_align=center');
    expect(graph).toContain("enable='between(t,0.000,1.000)'");
    expect(graph).toContain("enable='between(t,2.000,4.000)'");
    expect(graph).toContain('fontfile=overlay-font-0.ttf');
    expect(graph).toContain('shadowcolor=#000000');
    expect(graph).toContain('borderw=2');
    expect(graph).not.toContain('He said');
    expect(stagedText).toContain('He said');
    await expect(fs.access(path.join(workDir, 'overlay-text-0.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(workDir, 'overlay-font-0.ttf'))).rejects.toThrow();
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(fontPath, { force: true });
    await cleanup(fixtureData.files);
  });

  it('fails clearly when no approved font is available', async () => {
    const fixtureData = await fixture();
    fixtureData.composition.clips.push(textClip({ text: { content: 'Title' } }));
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    await expect(
      renderComposition({
        composition: fixtureData.composition,
        assets: fixtureData.assets,
        workDir,
        fontResolver: () => null,
        runner: fakeRunner(false),
      })
    ).rejects.toThrow('No approved local font');
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

  it('builds alpha, wipe and slide transition graphs that keep the timeline intact', async () => {
    const cases: Array<{ type: string; needles: string[] }> = [
      {
        type: 'crossfade',
        needles: ["fade=t=in:st=4.000:d=1.000:alpha=1", "enable='between(t,0.000,5.000)'"],
      },
      {
        type: 'fade-black',
        needles: ["fade=t=out:st=3.500:d=0.500:alpha=1", "fade=t=in:st=4.000:d=0.500:alpha=1"],
      },
      {
        type: 'fade-white',
        needles: ['color=c=white', "fade=t=out:st=4.000:d=0.500:alpha=1"],
      },
      { type: 'wipe-left', needles: ['geq=', 'blend=all_expr=', 'alphamerge'] },
      { type: 'wipe-right', needles: ['255*(1-X/1279)', 'alphamerge'] },
      { type: 'slide-left', needles: ["overlay=0:0:x='if(lt(t,4.000),W"] },
      { type: 'slide-right', needles: ["overlay=0:0:x='if(lt(t,4.000),-W"] },
    ];
    for (const testCase of cases) {
      const fixtureData = await fixture();
      const videoId = fixtureData.assets[0]._id;
      fixtureData.composition.clips.push({
        _id: id(),
        assetId: videoId,
        trackId: 'video-1',
        trackType: 'video',
        timelineStartSeconds: 4,
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        durationSeconds: 4,
        transitionIn: { type: testCase.type as never, durationSeconds: 1 },
      });
      let captured: string[] = [];
      const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
      const result = await renderComposition({
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
      expect(result.hasAudio).toBe(false);
      expect(captured[captured.indexOf('-t') + 1]).toBe('8.000');
      for (const needle of testCase.needles) {
        expect(graph, `${testCase.type} graph should contain ${needle}`).toContain(needle);
      }
      await fs.rm(workDir, { recursive: true, force: true });
      await cleanup(fixtureData.files);
    }
  });

  it('rejects transitions that do not sit between touching clips', async () => {
    const fixtureData = await fixture();
    const videoId = fixtureData.assets[0]._id;
    fixtureData.composition.clips.push({
      _id: id(),
      assetId: videoId,
      trackId: 'video-1',
      trackType: 'video',
      timelineStartSeconds: 5,
      sourceInSeconds: 0,
      sourceOutSeconds: 2,
      durationSeconds: 2,
      transitionIn: { type: 'crossfade', durationSeconds: 1 },
    });
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    await expect(
      renderComposition({ composition: fixtureData.composition, assets: fixtureData.assets, workDir, runner: fakeRunner(false) })
    ).rejects.toThrow('needs two clips that touch');
    await cleanup(fixtureData.files);
  });

  it('adds volume and audio fades to the mix and rejects oversized fades', async () => {
    const fixtureData = await fixture(true);
    const audioClip = fixtureData.composition.clips.find((clip) => clip.trackType === 'audio')!;
    audioClip.audio = { volume: 0.5, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 };
    fixtureData.composition.tracks = [
      { trackId: 'video-1', name: 'Video', type: 'video', order: 0, muted: false, hidden: false, locked: false },
      { trackId: 'audio-1', name: 'Audio', type: 'audio', order: 1, muted: false, hidden: false, locked: false, volume: 0.8 },
    ];
    let captured: string[] = [];
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    const result = await renderComposition({
      composition: fixtureData.composition,
      assets: fixtureData.assets,
      workDir,
      runner: async (command, args) => {
        if (command === config.video.ffmpegPath) {
          captured = args;
          await fs.writeFile(args[args.length - 1], 'rendered');
          return { stdout: '', stderr: '' };
        }
        return { stdout: probePayload({ audio: true }), stderr: '' };
      },
    });
    const graph = captured[captured.indexOf('-filter_complex') + 1];
    expect(result.hasAudio).toBe(true);
    expect(graph).toContain('volume=0.400');
    expect(graph).toContain('afade=t=in:st=0:d=0.500');
    expect(graph).toContain('afade=t=out:st=3.500:d=0.500');
    await fs.rm(workDir, { recursive: true, force: true });

    audioClip.audio = { volume: 1, fadeInSeconds: 3, fadeOutSeconds: 3 };
    await expect(
      renderComposition({ composition: fixtureData.composition, assets: fixtureData.assets, workDir, runner: fakeRunner(true) })
    ).rejects.toThrow('fades do not fit');
    await cleanup(fixtureData.files);
  });

  it('renders faded and sliding text with expressions and zooms through a text layer', async () => {
    const fixtureData = await fixture(true);
    const fontPath = path.join(config.dataDir, `test-font-${id()}.ttf`);
    await fs.writeFile(fontPath, 'test-font');
    fixtureData.composition.clips.push(
      textClip({
        text: {
          content: 'Fade',
          animation: {
            version: 1,
            entrance: { type: 'fade', durationSeconds: 0.4, delaySeconds: 0, easing: 'ease-out' },
          },
        },
        durationSeconds: 1,
      }),
      textClip({
        text: {
          content: 'Slide',
          animation: {
            version: 1,
            exit: { type: 'slide-left', durationSeconds: 0.4, delaySeconds: 0, easing: 'linear' },
          },
        },
        timelineStartSeconds: 1,
        durationSeconds: 1,
      }),
      textClip({
        text: {
          content: 'Zoom',
          animation: {
            version: 1,
            exit: { type: 'zoom', durationSeconds: 0.5, delaySeconds: 0, easing: 'ease-in' },
          },
        },
        timelineStartSeconds: 2,
        durationSeconds: 1,
      })
    );
    let captured: string[] = [];
    const workDir = path.join(config.dataDir, `renderer-test-${id()}`);
    await renderComposition({
      composition: fixtureData.composition,
      assets: fixtureData.assets,
      workDir,
      fontResolver: () => fontPath,
      runner: async (command, args) => {
        if (command === config.video.ffmpegPath) {
          captured = args;
          await fs.writeFile(args[args.length - 1], 'rendered');
          return { stdout: '', stderr: '' };
        }
        return { stdout: probePayload({ audio: true }), stderr: '' };
      },
    });
    const graph = captured[captured.indexOf('-filter_complex') + 1];
    expect(graph).toContain("alpha='(");
    expect(graph).toContain("x='(w*0.5000-text_w/2)+(");
    expect(graph).toContain('zoompan=z=');
    expect(graph).toContain('s=2560x1440');
    expect(graph).toContain('fps=30');
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(fontPath, { force: true });

    fixtureData.composition.clips[fixtureData.composition.clips.length - 1].text!.animation = {
      version: 1,
      entrance: { type: 'fade', durationSeconds: 5, delaySeconds: 0, easing: 'linear' },
    };
    await expect(
      renderComposition({
        composition: fixtureData.composition,
        assets: fixtureData.assets,
        workDir,
        fontResolver: () => fontPath,
        runner: fakeRunner(false),
      })
    ).rejects.toThrow('does not fit inside the clip duration');
    await cleanup(fixtureData.files);
  });
});
