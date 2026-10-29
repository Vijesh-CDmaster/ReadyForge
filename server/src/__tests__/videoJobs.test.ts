import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { Types } from 'mongoose';
import { createApp } from '../index';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { ProductionContract } from '../models/ProductionContract';
import { GenerationTask } from '../models/GenerationTask';
import { signAccessToken } from '../middleware/auth';
import { submitVideoJob, VideoJobWorker } from '../services/videoJobs';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

let server: http.Server;
let baseUrl: string;

async function setup() {
  const user = await User.create({
    name: 'Video Owner',
    email: `video-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await bcrypt.hash('test-password', 4),
  });
  const workspace = await Workspace.create({
    name: 'Video Workspace',
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner', status: 'active' }],
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: 'Mock Video Project',
    projectType: 'video',
    budget: { amount: 100, currency: 'INR', spent: 0, remaining: 100 },
  });
  const contract = await ProductionContract.create({
    projectId: project._id,
    workspaceId: workspace._id,
    createdById: user._id,
    status: 'locked',
    version: 3,
    objective: 'Test',
  });
  return { user, workspace, project, contract };
}

async function waitForStatus(id: Types.ObjectId, status: string, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const task = await GenerationTask.findById(id);
    if (task?.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${status}`);
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

describe('durable mock video jobs', () => {
  it('creates an idempotent queued job and rejects conflicting key reuse', async () => {
    const { user, workspace, project } = await setup();
    const first = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'same-key',
    });
    const duplicate = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'same-key',
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.task._id.toString()).toBe(first.task._id.toString());
    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'permanent_failure',
        idempotencyKey: 'same-key',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('processes a success once and preserves review compatibility without charging budget', async () => {
    const { user, workspace, project } = await setup();
    const { task } = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'success-key',
    });
    const workerA = new VideoJobWorker();
    const workerB = new VideoJobWorker();
    workerA.start();
    workerB.start();
    const completed = await waitForStatus(task._id, 'requires_approval');
    await workerA.stop();
    await workerB.stop();
    expect(completed.progress).toBe(100);
    expect(completed.reviewStatus).toBe('pending');
    expect(completed.mockOutput).toBe(true);
    expect(completed.outputText).toContain('NOT A PLAYABLE MP4');
    const freshProject = await Project.findById(project._id);
    expect(freshProject?.budget.spent).toBe(0);
  });

  it('does not let an expired lease overwrite a newer worker result', async () => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'old-worker',
      leaseExpiresAt: new Date(Date.now() - 1000),
      heartbeatAt: new Date(Date.now() - 1000),
      mockOutput: true,
      providerMode: 'success',
    });
    const worker = new VideoJobWorker();
    worker.start();
    const recovered = await waitForStatus(task._id, 'requires_approval');
    await worker.stop();
    expect(recovered.outputText).toContain('NOT A PLAYABLE MP4');
    expect(recovered.leaseId).toBeUndefined();
  });

  it('requires authentication and prevents cross-workspace job access', async () => {
    const { user, workspace, project } = await setup();
    const created = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'auth-key',
    });
    const unauthenticated = await fetch(`${baseUrl}/api/video-jobs/${created.task._id}`);
    expect(unauthenticated.status).toBe(401);

    const outsider = await User.create({
      name: 'Outsider',
      email: `outsider-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const denied = await fetch(`${baseUrl}/api/video-jobs/${created.task._id}`, {
      headers: { Authorization: `Bearer ${signAccessToken(outsider)}` },
    });
    expect(denied.status).toBe(403);
  });
});
