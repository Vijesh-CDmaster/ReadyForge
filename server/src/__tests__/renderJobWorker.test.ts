import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { config } from '../config';
import { Asset } from '../models/Asset';
import { BudgetReservation } from '../models/BudgetReservation';
import { EditComposition } from '../models/EditComposition';
import { GenerationTask } from '../models/GenerationTask';
import { ProductionContract } from '../models/ProductionContract';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { VideoJobWorker } from '../services/videoJobs';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

const renderState = vi.hoisted(() => ({ calls: 0, outputPath: '' }));

vi.mock('../services/compositionRenderer', () => ({
  renderComposition: vi.fn(async () => {
    renderState.calls += 1;
    return {
      outputPath: renderState.outputPath,
      durationSeconds: 4,
      width: 1280,
      height: 720,
      hasAudio: false,
    };
  }),
}));

vi.mock('../services/ffmpegTools', () => ({
  assertVideoRenderingAvailable: vi.fn(async () => ({ available: true })),
  getVideoRenderingTools: vi.fn(async () => ({
    available: true,
    ffmpeg: {},
    ffprobe: {},
    missingCodecs: [],
    message: null,
  })),
}));

async function waitForTask(
  id: Types.ObjectId,
  predicate: (task: InstanceType<typeof GenerationTask>) => boolean,
  timeout = 3_000
) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const task = await GenerationTask.findById(id);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for render task');
}

beforeAll(async () => {
  await connectTestDb();
  await fs.mkdir(config.upload.dir, { recursive: true });
});

afterEach(async () => {
  await clearDb();
});

afterAll(async () => disconnectTestDb());

describe('local render worker publication', () => {
  it('publishes one protected output asset, settles once, and does not duplicate output', async () => {
    const user = await User.create({
      name: 'Render Worker Owner',
      email: `render-worker-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const workspace = await Workspace.create({
      name: 'Render Worker Workspace',
      ownerId: user._id,
      members: [{ userId: user._id, role: 'owner', status: 'active' }],
    });
    const project = await Project.create({
      workspaceId: workspace._id,
      createdById: user._id,
      title: 'Render Worker Project',
      description: 'Authorized render project',
      projectType: 'video',
      status: 'draft',
      mode: 'solo',
      objective: 'Demonstrate the project',
      audience: 'Test viewers',
      tone: 'Clear',
      callToAction: 'Watch now',
      deadline: new Date(Date.now() + 86400_000),
      currentStage: 'final',
      budget: { amount: 100, currency: 'INR', spent: 0, remaining: 100 },
    });
    const contract = await ProductionContract.create({
      projectId: project._id,
      workspaceId: workspace._id,
      createdById: user._id,
      status: 'locked',
      version: 1,
      objective: 'Test',
      audience: 'Test viewers',
      tone: 'Clear',
      keyMessage: 'A valid production contract',
      callToAction: 'Watch now',
      contentPlan: {
        outline: ['Opening'],
        script: 'A complete production script.',
        storyboard: [{ sceneNumber: 1, title: 'Opening', description: 'Opening shot', durationSeconds: 5, status: 'approved' }],
      },
    });
    const sourceAsset = await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'source.mp4',
      type: 'video',
      fileUrl: '/uploads/render-worker-source.mp4',
      mimeType: 'video/mp4',
      sourceDurationSeconds: 4,
      licenseStatus: 'owned',
    });
    const composition = await EditComposition.create({
      projectId: project._id,
      workspaceId: workspace._id,
      ownerId: user._id,
      schemaVersion: 1,
      clips: [
        {
          assetId: sourceAsset._id,
          trackId: 'video-1',
          trackType: 'video',
          timelineStartSeconds: 0,
          sourceInSeconds: 0,
          sourceOutSeconds: 4,
          durationSeconds: 4,
        },
      ],
    });
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'render',
      stage: 'final',
      status: 'queued',
      attempt: 1,
      estimatedCost: 0,
      actualCost: 0,
      idempotencyKey: 'render-worker-output',
      requestFingerprint: 'render-worker-fingerprint',
      correlationId: 'render-worker-correlation',
      providerId: 'ffmpeg',
      costCurrency: 'INR',
      compositionId: composition._id,
      compositionRevision: composition.__v,
      maxAttempts: 3,
    });
    const reservation = await BudgetReservation.create({
      projectId: project._id,
      generationTaskId: task._id,
      key: `render:${task._id.toString()}`,
      estimatedAmount: 0,
      actualAmount: 0,
      currency: 'INR',
      status: 'reserved',
    });
    task.budgetReservationId = reservation._id;
    await task.save();

    await fs.mkdir(config.dataDir, { recursive: true });
    renderState.outputPath = path.join(config.dataDir, `render-worker-${task._id}.mp4`);
    renderState.calls = 0;
    await fs.writeFile(renderState.outputPath, 'rendered-mp4-bytes');

    const worker = new VideoJobWorker();
    try {
      worker.start();
      const completed = await waitForTask(task._id, (current) => current.status === 'requires_approval');
      expect(completed.outputAssetId).toBeTruthy();
      expect(completed.progress).toBe(100);
      expect(completed.outputDurationSeconds).toBe(4);
      expect(completed.outputWidth).toBe(1280);
      expect(completed.outputHeight).toBe(720);
      expect(await Asset.countDocuments({ projectId: project._id, aiGenerated: true })).toBe(1);
      expect((await BudgetReservation.findById(reservation._id))?.status).toBe('settled');
      expect(renderState.calls).toBe(1);
    } finally {
      await worker.stop();
    }

    const workerAgain = new VideoJobWorker();
    try {
      workerAgain.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await workerAgain.stop();
    }
    expect(renderState.calls).toBe(1);
    expect(await Asset.countDocuments({ projectId: project._id, aiGenerated: true })).toBe(1);

    const outputAsset = await Asset.findOne({ projectId: project._id, aiGenerated: true });
    if (outputAsset) {
      await fs.rm(path.join(config.upload.dir, path.basename(outputAsset.fileUrl)), { force: true });
    }
    await fs.rm(renderState.outputPath, { force: true });
  });
});
