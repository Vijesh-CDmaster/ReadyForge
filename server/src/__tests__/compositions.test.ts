import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { createApp } from '../index';
import { Asset } from '../models/Asset';
import { EditComposition } from '../models/EditComposition';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { signAccessToken } from '../middleware/auth';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

let server: http.Server;
let baseUrl: string;

async function request(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

async function fixture() {
  const user = await User.create({
    name: 'Editor Owner',
    email: `editor-${Date.now()}@example.com`,
    passwordHash: await bcrypt.hash('test-password', 4),
  });
  const workspace = await Workspace.create({
    name: 'Editor Workspace',
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner', status: 'active' }],
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: 'Timeline Project',
    projectType: 'video',
  });
  const asset = await Asset.create({
    workspaceId: workspace._id,
    projectId: project._id,
    uploadedById: user._id,
    name: 'clip.mp4',
    type: 'video',
    fileUrl: '/uploads/clip.mp4',
    mimeType: 'video/mp4',
    sourceDurationSeconds: 20,
  });
  return { user, workspace, project, asset, token: signAccessToken(user) };
}

beforeAll(async () => {
  await connectTestDb();
  server = createApp().listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await disconnectTestDb();
});

beforeEach(async () => clearDb());

describe('project compositions', () => {
  it('creates, retrieves, trims, reorders, removes, and rejects stale revisions', async () => {
    const { project, asset, token } = await fixture();
    const secondAsset = await Asset.create({
      workspaceId: asset.workspaceId,
      projectId: project._id,
      uploadedById: asset.uploadedById,
      name: 'second.mp4',
      type: 'video',
      fileUrl: '/uploads/second.mp4',
      mimeType: 'video/mp4',
      sourceDurationSeconds: 10,
    });
    const path = `/api/projects/${project._id}/composition`;
    const create = await request(path, token, {
      method: 'PUT',
      body: JSON.stringify({
        schemaVersion: 1,
        clips: [{ assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 2, sourceOutSeconds: 8 }],
      }),
    });
    expect(create.status).toBe(200);
    const first = (await create.json()) as { composition: { revision: number; clips: Array<{ durationSeconds: number }> } };
    expect(first.composition.clips[0].durationSeconds).toBe(6);

    const read = await request(path, token);
    expect(read.status).toBe(200);
    const reopened = (await read.json()) as { composition: { clips: unknown[] } };
    expect(reopened.composition.clips).toHaveLength(1);

    const update = await request(path, token, {
      method: 'PUT',
      headers: { 'If-Match': String(first.composition.revision) },
      body: JSON.stringify({
        schemaVersion: 1,
        clips: [
          { assetId: secondAsset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 3 },
          { assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 8, sourceInSeconds: 0, sourceOutSeconds: 5 },
        ],
      }),
    });
    expect(update.status).toBe(200);
    const reordered = (await update.json()) as { composition: { clips: Array<{ assetId: string }> } };
    expect(reordered.composition.clips.map((clip) => clip.assetId)).toEqual([secondAsset._id.toString(), asset._id.toString()]);

    const stale = await request(path, token, {
      method: 'PUT',
      headers: { 'If-Match': String(first.composition.revision) },
      body: JSON.stringify({ schemaVersion: 1, clips: [] }),
    });
    expect(stale.status).toBe(409);

    const remove = await request(path, token, {
      method: 'PUT',
      body: JSON.stringify({ schemaVersion: 1, clips: [] }),
    });
    expect(remove.status).toBe(200);
    const removed = (await remove.json()) as { composition: { clips: unknown[] } };
    expect(removed.composition.clips).toHaveLength(0);
  });

  it('rejects unauthorized projects and cross-project assets', async () => {
    const first = await fixture();
    const outsider = await User.create({
      name: 'Outsider',
      email: `outsider-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const denied = await request(`/api/projects/${first.project._id}/composition`, signAccessToken(outsider));
    expect(denied.status).toBe(403);

    const otherProject = await Project.create({
      workspaceId: first.workspace._id,
      createdById: first.user._id,
      title: 'Other project',
      projectType: 'video',
    });
    const otherAsset = await Asset.create({
      workspaceId: first.workspace._id,
      projectId: otherProject._id,
      uploadedById: first.user._id,
      name: 'other.mp4',
      type: 'video',
      fileUrl: '/uploads/other.mp4',
      mimeType: 'video/mp4',
      sourceDurationSeconds: 10,
    });
    const crossProject = await request(`/api/projects/${first.project._id}/composition`, first.token, {
      method: 'PUT',
      body: JSON.stringify({
        schemaVersion: 1,
        clips: [{ assetId: otherAsset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 5 }],
      }),
    });
    expect(crossProject.status).toBe(400);
  });

  it('persists multiple video, audio, and organizational text tracks in stable order', async () => {
    const { project, asset, token } = await fixture();
    const audio = await Asset.create({
      workspaceId: asset.workspaceId,
      projectId: project._id,
      uploadedById: asset.uploadedById,
      name: 'music.wav',
      type: 'audio',
      fileUrl: '/uploads/music.wav',
      mimeType: 'audio/wav',
      sourceDurationSeconds: 8,
    });
    const path = `/api/projects/${project._id}/composition`;
    const tracks = [
      { trackId: 'v2', name: 'Overlay', type: 'video', order: 1, hidden: false, muted: false, locked: false },
      { trackId: 'v1', name: 'Main', type: 'video', order: 0, hidden: false, muted: false, locked: false },
      { trackId: 'a1', name: 'Music', type: 'audio', order: 2, hidden: false, muted: true, locked: false },
      { trackId: 't1', name: 'Titles', type: 'text', order: 3, hidden: false, muted: false, locked: true },
    ];
    const save = await request(path, token, {
      method: 'PUT',
      body: JSON.stringify({
        schemaVersion: 2,
        tracks,
        clips: [
          { assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 4, order: 0 },
          { assetId: asset._id, trackId: 'v2', trackType: 'video', timelineStartSeconds: 2, sourceInSeconds: 4, sourceOutSeconds: 6, order: 0 },
          { assetId: audio._id, trackId: 'a1', trackType: 'audio', timelineStartSeconds: 1, sourceInSeconds: 0, sourceOutSeconds: 3, order: 0 },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const saved = (await save.json()) as {
      composition: {
        schemaVersion: number;
        tracks: Array<{ trackId: string; order: number; locked: boolean }>;
        clips: Array<{ trackId: string; durationSeconds: number; order: number }>;
      };
    };
    expect(saved.composition.schemaVersion).toBe(2);
    expect(saved.composition.tracks.map((track) => track.trackId)).toEqual(['v1', 'v2', 'a1', 't1']);
    expect(saved.composition.tracks.find((track) => track.trackId === 't1')?.locked).toBe(true);
    expect(saved.composition.clips.map((clip) => [clip.trackId, clip.durationSeconds])).toEqual([
      ['v1', 4],
      ['v2', 2],
      ['a1', 3],
    ]);

    const reopen = await request(path, token);
    expect(reopen.status).toBe(200);
    const reopened = (await reopen.json()) as { composition: { tracks: unknown[]; clips: unknown[] } };
    expect(reopened.composition.tracks).toHaveLength(4);
    expect(reopened.composition.clips).toHaveLength(3);
  });

  it('derives tracks for a legacy v1 composition without losing clips', async () => {
    const { project, asset, token } = await fixture();
    await EditComposition.create({
      projectId: project._id,
      workspaceId: asset.workspaceId,
      ownerId: asset.uploadedById,
      schemaVersion: 1,
      clips: [
        { assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 5, durationSeconds: 5 },
      ],
    });
    const read = await request(`/api/projects/${project._id}/composition`, token);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      composition: { schemaVersion: number; tracks: Array<{ trackId: string; name: string }>; clips: unknown[] };
    };
    expect(body.composition.schemaVersion).toBe(1);
    expect(body.composition.clips).toHaveLength(1);
    expect(body.composition.tracks).toEqual([
      {
        trackId: 'video-1',
        name: 'Video 1',
        type: 'video',
        order: 0,
        muted: false,
        hidden: false,
        locked: false,
        volume: 1,
      },
    ]);
  });

  it('validates and persists text overlay clips with safe defaults', async () => {
    const { project, asset, token } = await fixture();
    const path = `/api/projects/${project._id}/composition`;
    const textTrack = { trackId: 't1', name: 'Titles', type: 'text', order: 1, hidden: false, muted: false, locked: false };
    const videoTrack = { trackId: 'v1', name: 'Main', type: 'video', order: 0, hidden: false, muted: false, locked: false };
    const style = {
      content: 'Launch day',
      x: 0.5,
      y: 0.8,
      width: 0.7,
      alignment: 'center',
      fontFamily: 'sans',
      fontSize: 54,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.45,
      textOpacity: 1,
      bold: true,
      italic: false,
      shadow: true,
      outline: true,
      outlineColor: '#000000',
      outlineWidth: 2,
      zIndex: 5,
    };
    const save = (text: object | null, duration = 2) =>
      request(path, token, {
        method: 'PUT',
        body: JSON.stringify({
          schemaVersion: 2,
          tracks: [videoTrack, textTrack],
          clips: [
            { assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 4 },
            ...(text
              ? [{ trackId: 't1', trackType: 'text', timelineStartSeconds: 1, durationSeconds: duration, text }]
              : []),
          ],
        }),
      });

    const created = await save(style);
    expect(created.status).toBe(200);
    const saved = (await created.json()) as {
      composition: { clips: Array<{ trackType: string; assetId: string | null; text: { content: string; zIndex: number } | null }> };
    };
    const textClip = saved.composition.clips.find((clip) => clip.trackType === 'text');
    expect(textClip?.assetId).toBeNull();
    expect(textClip?.text).toMatchObject({ content: 'Launch day', zIndex: 5 });

    expect((await save({ ...style, fontColor: 'red' })).status).toBe(400);
    expect((await save({ ...style, fontFamily: 'C:\\Windows\\Fonts\\arial.ttf' })).status).toBe(400);
    expect((await save({ ...style, textOpacity: 1.5 })).status).toBe(400);
    expect((await save({ ...style, fontSize: 4 })).status).toBe(400);
    expect((await save({ ...style, content: '   ' })).status).toBe(400);
    expect((await save({ ...style, width: 2 })).status).toBe(400);
    expect((await save(style, 0)).status).toBe(400);
  });

  it('persists text animations, clip transitions, and audio gain, and rejects invalid combinations', async () => {
    const { user, workspace, project, asset, token } = await fixture();
    const audioAsset = await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'tone.wav',
      type: 'audio',
      fileUrl: '/uploads/tone.wav',
      mimeType: 'audio/wav',
      sourceDurationSeconds: 20,
    });
    const endpoint = `/api/projects/${project._id}/composition`;
    const send = (body: object) => request(endpoint, token, { method: 'PUT', body: JSON.stringify(body) });
    const tracks = [
      { trackId: 'v1', name: 'Main', type: 'video', order: 0, hidden: false, muted: false, locked: false, volume: 1 },
      { trackId: 't1', name: 'Titles', type: 'text', order: 1, hidden: false, muted: false, locked: false, volume: 1 },
      { trackId: 'a1', name: 'Music', type: 'audio', order: 2, hidden: false, muted: false, locked: false, volume: 0.5 },
    ];
    const style = {
      content: 'Animated',
      x: 0.5,
      y: 0.3,
      width: 0.8,
      alignment: 'center',
      fontFamily: 'sans',
      fontSize: 54,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      textOpacity: 1,
      bold: true,
      italic: false,
      shadow: false,
      outline: false,
      outlineColor: '#000000',
      outlineWidth: 2,
      zIndex: 3,
      animation: {
        version: 1,
        entrance: { type: 'zoom', durationSeconds: 0.6, delaySeconds: 0, easing: 'ease-out' },
        exit: { type: 'fade', durationSeconds: 0.4, delaySeconds: 0, easing: 'linear' },
      },
    };
    const videoClips = [
      { assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 2 },
      {
        assetId: asset._id,
        trackId: 'v1',
        trackType: 'video',
        timelineStartSeconds: 2,
        sourceInSeconds: 2,
        sourceOutSeconds: 4,
        transitionIn: { type: 'crossfade', durationSeconds: 0.6 },
      },
    ];
    const textClip = { trackId: 't1', trackType: 'text', timelineStartSeconds: 0, durationSeconds: 2, text: style };
    const audioClip = {
      assetId: audioAsset._id,
      trackId: 'a1',
      trackType: 'audio',
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 2,
      audio: { volume: 0.5, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 },
    };

    const created = await send({ schemaVersion: 2, tracks, clips: [...videoClips, textClip, audioClip] });
    expect(created.status).toBe(200);
    const saved = (await created.json()) as {
      composition: {
        tracks: Array<{ trackId: string; volume: number }>;
        clips: Array<{
          trackType: string;
          transitionIn: { type: string; durationSeconds: number } | null;
          audio: { volume: number; fadeInSeconds: number } | null;
          text: { animation: { entrance: { type: string } | null; exit: { type: string } | null } | null } | null;
        }>;
      };
    };
    expect(saved.composition.tracks.find((track) => track.trackId === 'a1')?.volume).toBe(0.5);
    expect(saved.composition.clips.find((clip) => clip.trackType === 'video' && clip.transitionIn)?.transitionIn).toEqual({
      type: 'crossfade',
      durationSeconds: 0.6,
    });
    expect(saved.composition.clips.find((clip) => clip.trackType === 'text')?.text?.animation?.entrance).toMatchObject({
      type: 'zoom',
      easing: 'ease-out',
    });
    expect(saved.composition.clips.find((clip) => clip.trackType === 'audio')?.audio).toMatchObject({
      volume: 0.5,
      fadeInSeconds: 0.5,
    });

    expect((await send({ schemaVersion: 2, tracks, clips: [videoClips[0], { ...videoClips[1], timelineStartSeconds: 3 }] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks, clips: [videoClips[0], { ...videoClips[1], transitionIn: { type: 'crossfade', durationSeconds: 3 } }] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks, clips: [videoClips[0], { ...videoClips[1], transitionIn: { type: 'spin', durationSeconds: 0.5 } }] })).status).toBe(400);
    expect(
      (await send({
        schemaVersion: 2,
        tracks,
        clips: [
          videoClips[0],
          { ...textClip, text: { ...style, animation: { version: 1, entrance: { type: 'fade', durationSeconds: 5, delaySeconds: 0, easing: 'linear' } } } },
        ],
      })).status
    ).toBe(400);
    expect(
      (await send({
        schemaVersion: 2,
        tracks,
        clips: [videoClips[0], { ...audioClip, audio: { volume: 1, fadeInSeconds: 1.5, fadeOutSeconds: 1.5 } }],
      })).status
    ).toBe(400);
    expect((await send({ schemaVersion: 2, tracks, clips: [videoClips[0], { ...videoClips[1], audio: { volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 } }] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks: [{ ...tracks[0], volume: 0.5 }], clips: [videoClips[0]] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks, clips: [{ ...audioClip, transitionIn: { type: 'crossfade', durationSeconds: 0.5 } }] })).status).toBe(400);
  });

  it('parses SRT subtitles through the authenticated endpoint', async () => {
    const { token } = await fixture();
    const result = await request('/api/subtitles/parse', token, {
      method: 'POST',
      body: JSON.stringify({ srt: '1\n00:00:01,000 --> 00:00:02,500\nFirst line\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond' }),
    });
    expect(result.status).toBe(200);
    const body = (await result.json()) as { cues: Array<{ startSeconds: number; endSeconds: number; text: string }>; count: number };
    expect(body.count).toBe(2);
    expect(body.cues[1]).toEqual({ index: 2, startSeconds: 3, endSeconds: 4, text: 'Second' });

    const invalid = await request('/api/subtitles/parse', token, {
      method: 'POST',
      body: JSON.stringify({ srt: 'not a subtitle' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects undeclared tracks, track-type mismatches, text clips with assets, and edits to locked tracks', async () => {
    const { project, asset, token } = await fixture();
    const path = `/api/projects/${project._id}/composition`;
    const baseTrack = { trackId: 'v1', name: 'Main', type: 'video', order: 0, hidden: false, muted: false, locked: false };
    const send = (body: object) => request(path, token, { method: 'PUT', body: JSON.stringify(body) });

    expect((await send({ schemaVersion: 2, tracks: [baseTrack], clips: [{ assetId: asset._id, trackId: 'missing', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 2 }] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks: [{ ...baseTrack, type: 'audio' }], clips: [{ assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 2 }] })).status).toBe(400);
    expect((await send({ schemaVersion: 2, tracks: [{ ...baseTrack, trackId: 't1', type: 'text' }], clips: [{ assetId: asset._id, trackId: 't1', trackType: 'text', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 2 }] })).status).toBe(400);

    const lockedTrack = { ...baseTrack, locked: true };
    const created = await send({ schemaVersion: 2, tracks: [lockedTrack], clips: [{ assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 4 }] });
    expect(created.status).toBe(200);
    const revision = ((await created.json()) as { composition: { revision: number } }).composition.revision;
    const editLocked = await request(path, token, {
      method: 'PUT',
      headers: { 'If-Match': String(revision) },
      body: JSON.stringify({ schemaVersion: 2, tracks: [lockedTrack], clips: [{ assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 1, sourceInSeconds: 0, sourceOutSeconds: 4 }] }),
    });
    expect(editLocked.status).toBe(409);

    const unlock = await request(path, token, {
      method: 'PUT',
      headers: { 'If-Match': String(revision) },
      body: JSON.stringify({ schemaVersion: 2, tracks: [{ ...lockedTrack, locked: false }], clips: [{ assetId: asset._id, trackId: 'v1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 4 }] }),
    });
    expect(unlock.status).toBe(200);
  });

  it('rejects invalid positions, ranges, overlaps, and unknown-duration trims', async () => {
    const { project, asset, token } = await fixture();
    const path = `/api/projects/${project._id}/composition`;
    const invalid = (clip: object) =>
      request(path, token, {
        method: 'PUT',
        body: JSON.stringify({ schemaVersion: 1, clips: [clip] }),
      });

    expect((await invalid({ assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: -1, sourceInSeconds: 0, sourceOutSeconds: 2 })).status).toBe(400);
    expect((await invalid({ assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 3, sourceOutSeconds: 2 })).status).toBe(400);
    expect((await invalid({ assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 30 })).status).toBe(400);

    const overlap = await request(path, token, {
      method: 'PUT',
      body: JSON.stringify({
        schemaVersion: 1,
        clips: [
          { assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 5 },
          { assetId: asset._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 4, sourceInSeconds: 5, sourceOutSeconds: 10 },
        ],
      }),
    });
    expect(overlap.status).toBe(400);

    const unknown = await Asset.create({
      workspaceId: (await Project.findById(project._id))!.workspaceId,
      projectId: project._id,
      uploadedById: (await User.findOne({ email: /editor-/ }))!._id,
      name: 'unknown.mp4',
      type: 'video',
      fileUrl: '/uploads/unknown.mp4',
      mimeType: 'video/mp4',
    });
    const unknownTrim = await invalid({ assetId: unknown._id, trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 2 });
    expect((await unknownTrim).status).toBe(409);
  });
});
