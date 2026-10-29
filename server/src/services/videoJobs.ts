import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { GenerationTask, IGenerationTask } from '../models/GenerationTask';
import { IProject, Project } from '../models/Project';
import { IProductionContract, ProductionContract } from '../models/ProductionContract';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Conflict } from '../models/Conflict';
import { Asset } from '../models/Asset';
import { authorizationMessage, evaluateProductionAuthorization } from './productionAuthorization';
import type { ProductionAuthorization } from './productionAuthorization';
import { ApiError } from '../http';
import { audit } from '../audit';
import { generateMockVideo, MockProviderError } from './mockVideoProvider';
import { getVideoProvider } from './videoProviderFactory';
import { config } from '../config';
import { recoverVideoBudgetReservations, reserveVideoBudget } from './videoBudget';
import { refundVideoBudget, settleVideoBudget } from './videoBudget';
import { downloadAndStoreVideoOutput, removeStoredVideoAsset } from './videoOutput';
import { VideoProvider, VideoProviderError } from './videoProvider';

const LEASE_MS = 30_000;
const POLL_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_PROVIDER_POLLS = 120;

export function fingerprintJob(input: { stage: string; mode: string; contractVersion: number }): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function serializeVideoJob(task: IGenerationTask) {
  const status =
    task.status === 'requires_approval' || task.status === 'completed' ? 'succeeded' : task.status;
  return {
    id: task._id.toString(),
    projectId: task.projectId.toString(),
    workspaceId: task.workspaceId?.toString() ?? null,
    status,
    legacyStatus: task.status,
    progress: task.progress ?? 0,
    currentStage: task.currentStage ?? '',
    retryCount: task.retryCount ?? 0,
    maxAttempts: task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    contractVersion: task.contractVersion ?? null,
    correlationId: task.correlationId ?? null,
    providerId: task.providerId ?? null,
    providerStatus: task.providerStatus ?? null,
    outputAssetId: task.outputAssetId?.toString() ?? null,
    estimatedCost: task.estimatedCost ?? 0,
    actualCost: task.actualCost ?? 0,
    costCurrency: task.costCurrency ?? null,
    ambiguousSubmission: task.ambiguousSubmission === true,
    mockOutput: task.mockOutput === true,
    outputText: task.outputText || null,
    errorCode: task.errorCode ?? null,
    errorMessage: task.errorMessage ?? null,
    reviewStatus: task.reviewStatus,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
  };
}

export async function revalidateVideoJobAuthorization(
  task: Pick<IGenerationTask, 'projectId' | 'workspaceId'>,
  project: IProject,
  contract: IProductionContract
): Promise<ProductionAuthorization> {
  const [inputs, conflicts, assets] = await Promise.all([
    KnowledgeInput.find({ projectId: project._id }),
    Conflict.find({ projectId: project._id }),
    Asset.find({ projectId: project._id, workspaceId: task.workspaceId }),
  ]);
  return evaluateProductionAuthorization({
    project,
    inputs,
    conflicts,
    assets,
    contract,
    stage: 'final',
  });
}

export async function submitVideoJob(params: {
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  stage: 'final';
  mode: IGenerationTask['providerMode'];
  idempotencyKey: string;
}): Promise<{ task: IGenerationTask; duplicate: boolean }> {
  const project = await Project.findById(params.projectId);
  if (!project) throw new ApiError(404, 'Project not found');
  if (project.workspaceId.toString() !== params.workspaceId.toString()) {
    throw new ApiError(404, 'Project not found');
  }
  const contract = await ProductionContract.findOne({
    projectId: project._id,
    status: { $in: ['approved', 'locked'] },
  }).sort('-version');
  if (!contract) throw new ApiError(409, 'An approved or locked Production Contract is required.');

  const provider = getVideoProvider();
  const providerEstimate = await provider.estimateCost({
    prompt: `Generate video for "${project.title}"`,
    model: config.video.runwayModel,
    durationSeconds: 5,
    aspectRatio: '1280:720',
    correlationId: 'estimate',
    idempotencyKey: params.idempotencyKey,
  });
  if (providerEstimate.amount > 0 && (!config.video.maxCost || providerEstimate.amount > config.video.maxCost)) {
    throw new ApiError(402, 'The estimated video cost exceeds the configured per-job ceiling.');
  }

  const [inputs, conflicts, assets] = await Promise.all([
    KnowledgeInput.find({ projectId: project._id }),
    Conflict.find({ projectId: project._id }),
    Asset.find({ projectId: project._id, workspaceId: params.workspaceId }),
  ]);
  const authorization = evaluateProductionAuthorization({
    project,
    inputs,
    conflicts,
    assets,
    contract,
    stage: 'final',
    estimatedCost: providerEstimate.amount,
  });
  if (!authorization.authorized) {
    throw new ApiError(409, authorizationMessage(authorization));
  }

  const requestFingerprint = fingerprintJob({
    stage: params.stage,
    mode: params.mode || 'success',
    contractVersion: contract.version,
  });
  if (provider.id !== 'mock') {
    const availableAssetIds = new Set(assets.map((asset) => asset._id.toString()));
    if (contract.approvedAssetIds.some((id) => !availableAssetIds.has(id.toString()))) {
      throw new ApiError(409, 'Approved Production Contract assets are no longer available.');
    }
    throw new ApiError(503, 'The selected real video provider is not enabled until output storage and billing reconciliation are configured.');
  }
  const correlationId = crypto.randomUUID();
  const existing = await GenerationTask.findOne({
    projectId: project._id,
    idempotencyKey: params.idempotencyKey,
  });
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError(409, 'Idempotency key was already used for a different request.');
    }
    return { task: existing, duplicate: true };
  }

  try {
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: params.workspaceId,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: params.userId,
      taskType: 'final',
      stage: 'final',
      status: 'queued',
      attempt: 1,
      inputPrompt: `Generate mock video for "${project.title}"`,
      estimatedCost: 0,
      actualCost: 0,
      idempotencyKey: params.idempotencyKey,
      requestFingerprint,
      correlationId,
      providerMode: params.mode || 'success',
      mockOutput: provider.id === 'mock',
      providerId: provider.id,
      costCurrency: providerEstimate.currency,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    });
    if (providerEstimate.amount > 0) {
      const reservation = await reserveVideoBudget({
        projectId: project._id,
        generationTaskId: task._id,
        key: `video:${task._id.toString()}`,
        amount: providerEstimate.amount,
        currency: providerEstimate.currency,
      });
      task.budgetReservationId = reservation._id;
      task.estimatedCost = providerEstimate.amount;
      await task.save();
    }
    audit({
      workspaceId: params.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: params.userId.toString(),
      action: 'video_job.create',
      entityType: 'generation_task',
      entityId: task._id.toString(),
      after: { status: task.status, contractVersion: contract.version, mock: true },
    });
    return { task, duplicate: false };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const existing = await GenerationTask.findOne({
      projectId: project._id,
      idempotencyKey: params.idempotencyKey,
    });
    if (!existing) throw error;
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError(409, 'Idempotency key was already used for a different request.');
    }
    return { task: existing, duplicate: true };
  }
}

async function recoverStaleJobs(now = new Date()): Promise<number> {
  const retryable = await GenerationTask.updateMany(
    {
      status: 'running',
      leaseExpiresAt: { $lt: now },
      retryCount: { $lt: DEFAULT_MAX_ATTEMPTS },
      ambiguousSubmission: { $ne: true },
    },
    {
      $set: { status: 'queued', currentStage: 'recovered after worker lease expiry', nextAttemptAt: now },
      $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
      $inc: { retryCount: 1 },
    }
  );
  const terminal = await GenerationTask.updateMany(
    { status: 'running', leaseExpiresAt: { $lt: now }, retryCount: { $gte: DEFAULT_MAX_ATTEMPTS } },
    {
      $set: {
        status: 'failed',
        currentStage: 'worker lease expired',
        errorCode: 'WORKER_LEASE_EXPIRED',
        errorMessage: 'The worker lease expired after the retry limit was reached.',
        completedAt: now,
      },
      $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
    }
  );
  return retryable.modifiedCount + terminal.modifiedCount;
}

async function claimJob(workerId: string): Promise<IGenerationTask | null> {
  const now = new Date();
  const leaseId = crypto.randomUUID();
  return GenerationTask.findOneAndUpdate(
    {
      status: 'queued',
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    {
      $set: {
        status: 'running',
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        heartbeatAt: now,
        startedAt: now,
        currentStage: `claimed by ${workerId}`,
      },
    },
    { sort: { createdAt: 1 }, new: true }
  ).lean();
}

async function heartbeat(taskId: Types.ObjectId, leaseId: string, progress: number, stage: string): Promise<boolean> {
  const now = new Date();
  const updated = await GenerationTask.updateOne(
    { _id: taskId, status: 'running', leaseId, leaseExpiresAt: { $gt: now } },
    {
      $set: {
        progress,
        currentStage: stage,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    }
  );
  return updated.modifiedCount === 1;
}

export async function processRealProviderJob(
  task: IGenerationTask,
  project: IProject,
  contract: IProductionContract,
  leaseId: string,
  providerOverride?: VideoProvider
): Promise<void> {
  const provider = providerOverride ?? getVideoProvider(task.providerId);
  const authorization = await revalidateVideoJobAuthorization(task, project, contract);
  if (!authorization.authorized || contract.status === 'superseded') {
    throw new VideoProviderError(
      authorizationMessage(authorization) || 'Production readiness no longer permits video generation.',
      'validation',
      false
    );
  }
  const assets = await Asset.find({ projectId: project._id, workspaceId: task.workspaceId! });

  const availableAssetIds = new Set(assets.map((asset) => asset._id.toString()));
  if (contract.approvedAssetIds.some((id) => !availableAssetIds.has(id.toString()))) {
    throw new VideoProviderError('An approved input asset is no longer available.', 'validation', false);
  }

  let providerJobId = task.providerJobId;
  if (!providerJobId) {
    const submission = await provider.submit({
      prompt: task.inputPrompt,
      model: config.video.runwayModel,
      durationSeconds: 5,
      aspectRatio: '1280:720',
      correlationId: task.correlationId || task._id.toString(),
      idempotencyKey: task.idempotencyKey || task._id.toString(),
    });
    providerJobId = submission.providerJobId;
    const persisted = await GenerationTask.updateOne(
      { _id: task._id, status: 'running', leaseId, leaseExpiresAt: { $gt: new Date() } },
      {
        $set: {
          providerJobId,
          providerStatus: submission.status,
          modelProvider: provider.id,
          modelName: config.video.runwayModel,
          costCurrency: submission.currency,
          currentStage: 'provider job submitted',
        },
      }
    );
    if (persisted.modifiedCount !== 1) return;
  }

  let delay = config.video.pollInitialMs;
  for (let poll = 0; poll < MAX_PROVIDER_POLLS; poll += 1) {
    if (!(await heartbeat(task._id, leaseId, task.progress ?? 0, 'polling provider job'))) return;
    const status = await provider.getStatus(providerJobId);
    const saved = await GenerationTask.updateOne(
      { _id: task._id, status: 'running', leaseId, leaseExpiresAt: { $gt: new Date() } },
      { $set: { providerStatus: status.status, progress: status.progress ?? task.progress ?? 0, currentStage: `provider ${status.status}` } }
    );
    if (saved.modifiedCount !== 1) return;
    if (status.status === 'running' || status.status === 'submitted') {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(config.video.pollMaxMs, delay * 2);
      continue;
    }
    if (status.status === 'cancelled') {
      throw new VideoProviderError('The provider cancelled the video job.', 'provider', false);
    }
    if (status.status === 'failed') {
      throw status.error || new VideoProviderError('The provider failed the video job.', 'provider', false);
    }
    if (!status.outputUrl) {
      throw new VideoProviderError('The provider completed without an output URL.', 'validation', false);
    }

    const latestContract = await ProductionContract.findOne({
      _id: task.contractId,
      projectId: task.projectId,
      version: task.contractVersion,
      status: { $in: ['approved', 'locked'] },
    });
    if (!latestContract) {
      throw new VideoProviderError('The captured Production Contract was superseded before completion.', 'validation', false);
    }
    const outputAssetId = await downloadAndStoreVideoOutput({
      taskId: task._id,
      projectId: task.projectId,
      workspaceId: task.workspaceId!,
      uploadedById: task.createdById,
      outputUrl: status.outputUrl,
    });
    try {
      if (task.budgetReservationId) {
        await settleVideoBudget({
          reservationId: task.budgetReservationId,
          actualAmount: status.actualCost ?? task.estimatedCost ?? 0,
        });
      }
      const completed = await GenerationTask.updateOne(
        { _id: task._id, status: 'running', leaseId, leaseExpiresAt: { $gt: new Date() } },
        {
          $set: {
            status: 'requires_approval',
            providerStatus: 'succeeded',
            outputAssetId,
            actualCost: status.actualCost ?? task.estimatedCost ?? 0,
            costCurrency: status.currency || task.costCurrency,
            progress: 100,
            currentStage: 'video output ready for review',
            completedAt: new Date(),
          },
          $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
        }
      );
      if (completed.modifiedCount !== 1) {
        await removeStoredVideoAsset(outputAssetId);
        return;
      }
    } catch (error) {
      await removeStoredVideoAsset(outputAssetId).catch(() => undefined);
      throw error;
    }
    audit({
      workspaceId: task.workspaceId!.toString(),
      projectId: task.projectId.toString(),
      actorType: 'system',
      action: 'video_job.completed',
      entityType: 'generation_task',
      entityId: task._id.toString(),
      after: { provider: provider.id, providerJobId, outputAssetId: outputAssetId.toString(), reviewStatus: 'pending' },
    });
    return;
  }
  throw new VideoProviderError('Provider polling timed out.', 'timeout', true);
}

async function processJob(task: IGenerationTask): Promise<void> {
  const leaseId = task.leaseId;
  if (!leaseId || !task.workspaceId || !task.contractVersion) {
    await GenerationTask.updateOne(
      { _id: task._id, status: 'running', leaseId },
      { $set: { status: 'failed', errorCode: 'INVALID_JOB', errorMessage: 'Video job metadata is incomplete.' }, $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 } }
    );
    return;
  }
  try {
    const project = await Project.findById(task.projectId);
    if (!project) throw new MockProviderError('Project no longer exists.', 'MOCK_PERMANENT', false);
    const contract = await ProductionContract.findOne({
      _id: task.contractId,
      projectId: task.projectId,
      version: task.contractVersion,
      status: { $in: ['approved', 'locked'] },
    });
    if (!contract) throw new MockProviderError('The captured Production Contract is no longer approved.', 'MOCK_PERMANENT', false);
    if (task.providerId && task.providerId !== 'mock') {
      await processRealProviderJob(task, project, contract, leaseId);
      return;
    }
    const authorization = await revalidateVideoJobAuthorization(task, project, contract);
    if (!authorization.authorized) {
      throw new MockProviderError(authorizationMessage(authorization), 'MOCK_PERMANENT', false);
    }
    const result = await generateMockVideo(
      { projectTitle: project.title, contractVersion: task.contractVersion, mode: task.providerMode || 'success' },
      async (progress, stage) => {
        if (!(await heartbeat(task._id, leaseId, progress, stage))) {
          throw new MockProviderError('Worker lease was lost.', 'MOCK_RETRYABLE', true);
        }

      }
    );
    const now = new Date();
    const completed = await GenerationTask.updateOne(
      { _id: task._id, status: 'running', leaseId, leaseExpiresAt: { $gt: now } },
      {
        $set: {
          status: 'requires_approval',
          progress: 100,
          currentStage: 'mock output ready for review',
          outputText: result.outputText,
          modelName: result.model,
          modelProvider: 'mock',
          actualCost: 0,
          mockOutput: true,
          completedAt: now,
          errorCode: undefined,
          errorMessage: undefined,
        },
        $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
      }
    );
    if (completed.modifiedCount !== 1) return;
    audit({
      workspaceId: task.workspaceId!.toString(),
      projectId: task.projectId.toString(),
      actorType: 'system',
      action: 'video_job.completed',
      entityType: 'generation_task',
      entityId: task._id.toString(),
      after: { mock: true, reviewStatus: 'pending' },
    });
  } catch (error) {
    const providerError = error instanceof MockProviderError
      ? error
      : error instanceof VideoProviderError
        ? error
        : new MockProviderError('Mock job failed.', 'MOCK_RETRYABLE', true);
    const errorCode = providerError instanceof MockProviderError
      ? providerError.code
      : `VIDEO_${providerError.kind.toUpperCase()}`;
    const ambiguousSubmission = providerError instanceof VideoProviderError && providerError.ambiguousSubmission;
    const retryable = providerError.retryable
      && !ambiguousSubmission
      && (task.retryCount ?? 0) + 1 < (task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const now = new Date();
    if (!retryable && task.budgetReservationId && !ambiguousSubmission) {
      await refundVideoBudget(task.budgetReservationId).catch(() => undefined);
    }
    await GenerationTask.updateOne(
      { _id: task._id, status: 'running', leaseId },
      retryable
        ? {
            $set: {
              status: 'queued',
              currentStage: 'retry scheduled',
              nextAttemptAt: new Date(now.getTime() + Math.min(5_000, 250 * 2 ** (task.retryCount ?? 0))),
              errorCode,
              errorMessage: providerError.message,
            },
            $inc: { retryCount: 1 },
            $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
          }
        : {
            $set: {
              status: 'failed',
              errorCode,
              errorMessage: providerError.message,
              ambiguousSubmission,
              currentStage: ambiguousSubmission ? 'manual billing/provider reconciliation required' : 'provider job failed',
              completedAt: now,
            },
            $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
          }
    );
  }
}

export class VideoJobWorker {
  private stopping = false;
  private timer?: ReturnType<typeof setTimeout>;
  private activeTick?: Promise<void>;
  private readonly workerId = `worker-${crypto.randomUUID()}`;

  start(): void {
    this.stopping = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.activeTick) await this.activeTick;
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    this.activeTick = (async () => {
      await recoverStaleJobs();
      await recoverVideoBudgetReservations();
      const task = await claimJob(this.workerId);
      if (task) await processJob(task);
      if (!this.stopping) this.timer = setTimeout(() => void this.tick(), POLL_MS);
    })();
    try {
      await this.activeTick;
    } finally {
      this.activeTick = undefined;
    }
  }
}
