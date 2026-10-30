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
import { downloadAndStoreVideoOutput, removeStoredVideoAsset, storeRenderedVideoOutput } from './videoOutput';
import { VideoProvider, VideoProviderError } from './videoProvider';
import { BudgetReservation } from '../models/BudgetReservation';
import { EditComposition } from '../models/EditComposition';
import { renderComposition } from './compositionRenderer';
import { assertVideoRenderingAvailable } from './ffmpegTools';
import fs from 'node:fs/promises';
import path from 'node:path';

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
    compositionId: task.compositionId?.toString() ?? null,
    compositionRevision: task.compositionRevision ?? null,
    outputDurationSeconds: task.outputDurationSeconds ?? null,
    outputWidth: task.outputWidth ?? null,
    outputHeight: task.outputHeight ?? null,
    outputText: task.outputText || null,
    errorCode: task.errorCode ?? null,
    errorMessage: task.errorMessage ?? null,
    reviewStatus: task.reviewStatus,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
  };
}

export async function submitRenderJob(params: {
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  compositionId: Types.ObjectId;
  compositionRevision: number;
  idempotencyKey: string;
}): Promise<{ task: IGenerationTask; duplicate: boolean }> {
  const project = await Project.findById(params.projectId);
  if (!project || project.workspaceId.toString() !== params.workspaceId.toString()) throw new ApiError(404, 'Project not found');
  const composition = await EditComposition.findOne({
    _id: params.compositionId,
    projectId: project._id,
    workspaceId: params.workspaceId,
  });
  if (!composition || composition.__v !== params.compositionRevision) {
    throw new ApiError(409, 'Save the current composition before rendering.');
  }
  const contract = await ProductionContract.findOne({
    projectId: project._id,
    status: { $in: ['approved', 'locked'] },
  }).sort('-version');
  if (!contract) throw new ApiError(409, 'An approved or locked Production Contract is required.');
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
    estimatedCost: 0,
  });
  if (!authorization.authorized) throw new ApiError(409, authorizationMessage(authorization));

  const requestFingerprint = fingerprintJob({
    stage: 'render',
    mode: 'render',
    contractVersion: contract.version,
  });
  const existing = await GenerationTask.findOne({ projectId: project._id, idempotencyKey: params.idempotencyKey });
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) throw new ApiError(409, 'Idempotency key was already used for a different request.');
    return { task: existing, duplicate: true };
  }
  try {
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: params.workspaceId,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: params.userId,
      taskType: 'render',
      stage: 'final',
      status: 'queued',
      attempt: 1,
      inputPrompt: `Render saved composition revision ${params.compositionRevision}`,
      estimatedCost: 0,
      actualCost: 0,
      idempotencyKey: params.idempotencyKey,
      requestFingerprint,
      correlationId: crypto.randomUUID(),
      providerId: 'ffmpeg',
      costCurrency: project.budget.currency,
      compositionId: composition._id,
      compositionRevision: params.compositionRevision,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      // Keep the task unclaimable until its budget reservation is attached.
      nextAttemptAt: new Date(Date.now() + 30_000),
    });
    const reservation = await reserveVideoBudget({
      projectId: project._id,
      generationTaskId: task._id,
      key: `render:${task._id.toString()}`,
      amount: 0,
      currency: project.budget.currency,
    });
    task.budgetReservationId = reservation._id;
    task.nextAttemptAt = new Date();
    await task.save();
    return { task, duplicate: false };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const existingTask = await GenerationTask.findOne({ projectId: project._id, idempotencyKey: params.idempotencyKey });
    if (!existingTask) throw error;
    if (existingTask.requestFingerprint !== requestFingerprint) throw new ApiError(409, 'Idempotency key was already used for a different request.');
    return { task: existingTask, duplicate: true };
  }
}

const MONEY_SCALE = 100;

function moneyInMinorUnits(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.round(value * MONEY_SCALE) : null;
}

function normalizedCurrency(value: string | undefined): string {
  return (value || '').trim().toUpperCase();
}

async function validateVideoJobReservation(
  task: Pick<IGenerationTask, '_id' | 'projectId' | 'estimatedCost'> & {
    budgetReservationId?: IGenerationTask['budgetReservationId'];
    costCurrency?: IGenerationTask['costCurrency'];
  },
  project: IProject
) {
  const estimate = moneyInMinorUnits(task.estimatedCost);
  if (estimate === null) {
    throw new VideoProviderError(
      'invalid_budget_estimate: The queued generation has an invalid estimated cost.',
      'validation',
      false
    );
  }
  if (!task.budgetReservationId) {
    throw new VideoProviderError(
      'invalid_budget_reservation: The queued generation has no budget reservation.',
      'validation',
      false
    );
  }
  if (!Types.ObjectId.isValid(task.budgetReservationId.toString())) {
    throw new VideoProviderError(
      'invalid_budget_reservation: The queued generation reservation ID is invalid.',
      'validation',
      false
    );
  }

  const reservation = await BudgetReservation.findOne({
    _id: task.budgetReservationId,
    generationTaskId: task._id,
    projectId: project._id,
  });
  if (!reservation || reservation.status !== 'reserved') {
    throw new VideoProviderError(
      `invalid_budget_reservation: The queued generation reservation is ${reservation?.status || 'missing'} and cannot be executed.`,
      'validation',
      false
    );
  }

  const reservedAmount = moneyInMinorUnits(reservation.estimatedAmount);
  if (reservedAmount === null || reservedAmount !== estimate) {
    throw new VideoProviderError(
      'invalid_budget_reservation: The reservation amount does not match the queued generation estimate.',
      'validation',
      false
    );
  }

  const projectCurrency = normalizedCurrency(project.budget.currency);
  const reservationCurrency = normalizedCurrency(reservation.currency);
  const taskCurrency = normalizedCurrency(task.costCurrency);
  if (!projectCurrency || !reservationCurrency || !taskCurrency || projectCurrency !== reservationCurrency || taskCurrency !== projectCurrency) {
    throw new VideoProviderError(
      'budget_currency_mismatch: The queued generation budget currencies do not match.',
      'validation',
      false
    );
  }

  const budgetAmount = moneyInMinorUnits(project.budget.amount);
  const budgetSpent = moneyInMinorUnits(project.budget.spent);
  if (budgetAmount === null || budgetSpent === null) {
    throw new VideoProviderError(
      'invalid_budget_reservation: The project budget is invalid.',
      'validation',
      false
    );
  }

  // Reservation spending is already included in budget.spent. Remove only this
  // reservation for the authorization calculation; other spending remains counted.
  const availableForJob = Math.max(0, budgetAmount - Math.max(0, budgetSpent - reservedAmount)) / MONEY_SCALE;
  return { reservation, availableForJob };
}

export async function revalidateVideoJobAuthorization(
  task: Pick<IGenerationTask, '_id' | 'projectId' | 'workspaceId' | 'estimatedCost'> & {
    budgetReservationId?: IGenerationTask['budgetReservationId'];
    costCurrency?: IGenerationTask['costCurrency'];
  },
  project: IProject,
  contract: IProductionContract
): Promise<ProductionAuthorization> {
  const { reservation, availableForJob } = await validateVideoJobReservation(task, project);
  const [inputs, conflicts, assets] = await Promise.all([
    KnowledgeInput.find({ projectId: project._id }),
    Conflict.find({ projectId: project._id }),
    Asset.find({ projectId: project._id, workspaceId: task.workspaceId }),
  ]);
  const estimatedCost = task.estimatedCost;
  return evaluateProductionAuthorization({
    project: {
      ...project,
      budget: { ...project.budget, remaining: availableForJob },
    } as IProject,
    inputs,
    conflicts,
    assets,
    contract,
    stage: 'final',
    estimatedCost: reservation.estimatedAmount,
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
  providerOverride?: VideoProvider,
  beforeSubmit?: () => Promise<void>
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
    if (beforeSubmit) await beforeSubmit();
    const currentTask = await GenerationTask.findOne({
      _id: task._id,
      status: 'running',
      leaseId,
      leaseExpiresAt: { $gt: new Date() },
      providerJobId: { $exists: false },
    }).lean();
    if (!currentTask) {
      throw new VideoProviderError(
        'provider_submission_authorization: The worker lease is no longer valid for provider submission.',
        'validation',
        false
      );
    }
    const currentProject = await Project.findById(task.projectId);
    const currentContract = await ProductionContract.findOne({
      _id: task.contractId,
      projectId: task.projectId,
      version: task.contractVersion,
      status: { $in: ['approved', 'locked'] },
    });
    if (!currentProject || !currentContract) {
      throw new VideoProviderError(
        'provider_submission_authorization: The captured project or Production Contract is no longer valid.',
        'validation',
        false
      );
    }
    const currentAuthorization = await revalidateVideoJobAuthorization(currentTask, currentProject, currentContract);
    if (!currentAuthorization.authorized) {
      throw new VideoProviderError(
        `provider_submission_authorization: ${authorizationMessage(currentAuthorization)}`,
        'validation',
        false
      );
    }
    const currentAssets = await Asset.find({ projectId: currentProject._id, workspaceId: currentTask.workspaceId! });
    const currentAssetIds = new Set(currentAssets.map((asset) => asset._id.toString()));
    if (currentContract.approvedAssetIds.some((id) => !currentAssetIds.has(id.toString()))) {
      throw new VideoProviderError(
        'provider_submission_authorization: An approved input asset is no longer available.',
        'validation',
        false
      );
    }
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

async function processRenderJob(
  task: IGenerationTask,
  project: IProject,
  contract: IProductionContract,
  leaseId: string
): Promise<void> {
  if (!task.compositionId || task.compositionRevision === undefined) {
    throw new VideoProviderError('Render task composition metadata is incomplete.', 'validation', false);
  }
  // Local rendering is only permitted when verified FFmpeg/FFprobe binaries exist.
  // A missing toolchain fails the job; it never produces a placeholder MP4.
  await assertVideoRenderingAvailable();
  const composition = await EditComposition.findOne({
    _id: task.compositionId,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
  });
  if (!composition || composition.__v !== task.compositionRevision) {
    throw new VideoProviderError('The saved composition changed before rendering.', 'validation', false);
  }
  const authorization = await revalidateVideoJobAuthorization(task, project, contract);
  if (!authorization.authorized) {
    throw new VideoProviderError(authorizationMessage(authorization), 'validation', false);
  }
  const sourceAssetIds = [
    ...new Set(
      composition.clips
        .map((clip) => clip.assetId?.toString())
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const assets = await Asset.find({
    _id: { $in: sourceAssetIds },
    projectId: project._id,
    workspaceId: task.workspaceId,
    type: { $in: ['video', 'audio'] },
  });
  if (assets.length !== sourceAssetIds.length) {
    throw new VideoProviderError('A composition source asset is unavailable.', 'validation', false);
  }
  if (!(await heartbeat(task._id, leaseId, 5, 'preparing render'))) {
    throw new VideoProviderError('The render worker lease was lost.', 'validation', false);
  }

  const workDir = path.resolve(config.dataDir, 'renders', task._id.toString());
  // FFmpeg renders can outlive the 30s worker lease, so renew it while the
  // child process runs. Publishing still re-checks the lease afterwards.
  let leaseLost = false;
  const leaseTimer = setInterval(() => {
    void heartbeat(task._id, leaseId, 50, 'rendering with FFmpeg')
      .then((ok) => {
        if (!ok) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, Math.max(5_000, Math.floor(LEASE_MS / 3)));
  leaseTimer.unref?.();
  try {
    const result = await renderComposition({ composition, assets, workDir });
    if (leaseLost) {
      throw new VideoProviderError('The render worker lease was lost during FFmpeg rendering.', 'validation', false);
    }
    if (!(await heartbeat(task._id, leaseId, 95, 'validating render'))) {
      throw new VideoProviderError('The render worker lease was lost before publishing output.', 'validation', false);
    }
    const currentTask = await GenerationTask.findOne({
      _id: task._id,
      status: 'running',
      leaseId,
      leaseExpiresAt: { $gt: new Date() },
      compositionRevision: task.compositionRevision,
      outputAssetId: { $exists: false },
    }).lean();
    if (!currentTask) throw new VideoProviderError('The render worker lease is no longer valid.', 'validation', false);

    const outputAssetId = await storeRenderedVideoOutput({
      sourcePath: result.outputPath,
      taskId: task._id,
      projectId: task.projectId,
      workspaceId: task.workspaceId!,
      uploadedById: task.createdById,
      durationSeconds: result.durationSeconds,
      width: result.width,
      height: result.height,
    });
    try {
      let settled = false;
      if (task.budgetReservationId) {
        await settleVideoBudget({ reservationId: task.budgetReservationId, actualAmount: 0 });
        settled = true;
      }
      const completed = await GenerationTask.updateOne(
        { _id: task._id, status: 'running', leaseId, leaseExpiresAt: { $gt: new Date() }, outputAssetId: { $exists: false } },
        {
          $set: {
            status: 'requires_approval',
            providerStatus: 'succeeded',
            outputAssetId,
            actualCost: 0,
            progress: 100,
            currentStage: 'rendered output ready for review',
            outputDurationSeconds: result.durationSeconds,
            outputWidth: result.width,
            outputHeight: result.height,
            completedAt: new Date(),
          },
          $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
        }
      );
      if (completed.modifiedCount !== 1) {
        await removeStoredVideoAsset(outputAssetId);
        throw new VideoProviderError(
          settled
            ? 'The render reservation was settled, but the task could not be completed; manual reconciliation is required.'
            : 'The render lease changed before output publication.',
          'validation',
          false
        );
      }
    } catch (error) {
      await removeStoredVideoAsset(outputAssetId).catch(() => undefined);
      throw error;
    }
    audit({
      workspaceId: task.workspaceId!.toString(),
      projectId: task.projectId.toString(),
      actorType: 'system',
      action: 'video_render.completed',
      entityType: 'generation_task',
      entityId: task._id.toString(),
      after: { compositionRevision: task.compositionRevision, outputAssetId: outputAssetId.toString(), durationSeconds: result.durationSeconds },
    });
  } finally {
    clearInterval(leaseTimer);
    await fs.rm(workDir, { recursive: true, force: true });
  }
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
    if (task.taskType === 'render' || task.providerId === 'ffmpeg') {
      await processRenderJob(task, project, contract, leaseId);
      return;
    }
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
    if (task.budgetReservationId) {
      await settleVideoBudget({
        reservationId: task.budgetReservationId,
        actualAmount: 0,
      });
    }
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
    if (completed.modifiedCount !== 1) {
      await GenerationTask.updateOne(
        { _id: task._id, status: 'running', leaseId },
        {
          $set: {
            status: 'failed',
            errorCode: 'MOCK_SETTLEMENT_TASK_UPDATE_FAILED',
            errorMessage: 'Mock output was settled, but the task could not be marked ready for review; manual reconciliation is required.',
            currentStage: 'manual settlement reconciliation required',
            completedAt: new Date(),
          },
          $unset: { leaseId: 1, leaseExpiresAt: 1, heartbeatAt: 1 },
        }
      );
      return;
    }
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
      try {
        await recoverStaleJobs();
        await recoverVideoBudgetReservations();
        const task = await claimJob(this.workerId);
        if (task) await processJob(task);
      } catch (err) {
        console.error('[video-worker] tick failed:', err);
      }
      if (!this.stopping) this.timer = setTimeout(() => void this.tick(), POLL_MS);
    })();
    try {
      await this.activeTick;
    } finally {
      this.activeTick = undefined;
    }
  }
}
