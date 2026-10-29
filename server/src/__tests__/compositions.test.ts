import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { createApp } from '../index';
import { Asset } from '../models/Asset';
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
