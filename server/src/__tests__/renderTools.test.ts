import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { Types } from 'mongoose';
import { createApp } from '../index';
import { EditComposition } from '../models/EditComposition';
import { GenerationTask } from '../models/GenerationTask';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { signAccessToken } from '../middleware/auth';
import { submitRenderJob } from '../services/videoJobs';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

const toolsState = vi.hoisted(() => ({
  available: false,
  message: 'ffmpeg was not found on PATH. Set FFMPEG_PATH to a working ffmpeg executable.',
}));

vi.mock('../services/ffmpegTools', () => ({
  getVideoRenderingTools: vi.fn(async () => ({
    available: toolsState.available,
    ffmpeg: {
      name: 'ffmpeg',
      executable: 'ffmpeg',
      source: 'path',
      available: toolsState.available,
      version: toolsState.available ? '7.1.1' : null,
      error: toolsState.available ? null : toolsState.message,
    },
    ffprobe: {
      name: 'ffprobe',
      executable: 'ffprobe',
      source: 'path',
      available: toolsState.available,
      version: toolsState.available ? '7.1.1' : null,
      error: toolsState.available ? null : toolsState.message,
    },
    missingCodecs: [],
    message: toolsState.available ? null : toolsState.message,
  })),
  assertVideoRenderingAvailable: vi.fn(async () => {
    if (!toolsState.available) throw new Error('Video rendering is unavailable.');
  }),
}));

let server: http.Server;
let baseUrl: string;

async function request(path: string, token?: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function fixture() {
  const user = await User.create({
    name: 'Render Owner',
    email: `render-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await bcrypt.hash('test-password', 4),
  });
  const workspace = await Workspace.create({
    name: 'Render Workspace',
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner', status: 'active' }],
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: 'Render Project',
    projectType: 'video',
  });
  const composition = await EditComposition.create({
    projectId: project._id,
    workspaceId: workspace._id,
    ownerId: user._id,
    schemaVersion: 1,
    clips: [],
  });
  return { user, workspace, project, composition, token: signAccessToken(user) };
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

beforeEach(async () => {
  await clearDb();
  toolsState.available = false;
  toolsState.message = 'ffmpeg was not found on PATH. Set FFMPEG_PATH to a working ffmpeg executable.';
});

describe('local render availability', () => {
  it('requires authentication for renderer status', async () => {
    const response = await request('/api/video-render/tools');
    expect(response.status).toBe(401);
  });

  it('reports unavailable tools without exposing them as a working renderer', async () => {
    const { token } = await fixture();
    const response = await request('/api/video-render/tools', token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as { available: boolean; message: string };
    expect(body.available).toBe(false);
    expect(body.message).toContain('FFMPEG_PATH');
  });

  it('rejects render submission when FFmpeg is unavailable and creates no job', async () => {
    const { project, token } = await fixture();
    const response = await request(`/api/projects/${project._id}/renders`, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'unavailable-render' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Video rendering is unavailable');
    expect(body.error).toContain('FFMPEG_PATH');
    expect(await GenerationTask.countDocuments({ projectId: project._id })).toBe(0);
  });

  it('still requires an approved or locked contract when tools are available', async () => {
    toolsState.available = true;
    const { project, token } = await fixture();
    const response = await request(`/api/projects/${project._id}/renders`, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'no-contract-render' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain(
      'approved or locked Production Contract'
    );
    expect(await GenerationTask.countDocuments({ projectId: project._id })).toBe(0);
  });

  it('rejects a stale composition revision at the render boundary', async () => {
    toolsState.available = true;
    const { user, workspace, project, composition } = await fixture();
    await expect(
      submitRenderJob({
        projectId: project._id as Types.ObjectId,
        workspaceId: workspace._id as Types.ObjectId,
        userId: user._id as Types.ObjectId,
        compositionId: composition._id as Types.ObjectId,
        compositionRevision: 99,
        idempotencyKey: 'stale-revision',
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Save the current composition') });
    expect(await GenerationTask.countDocuments({ projectId: project._id })).toBe(0);
  });
});
