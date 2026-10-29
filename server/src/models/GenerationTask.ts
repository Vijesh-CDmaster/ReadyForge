import { Schema, model, Types } from 'mongoose';
import { LADDER_STAGES } from './Project';

export const TASK_TYPES = ['outline', 'script', 'storyboard', 'preview', 'final', 'verification'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'requires_approval'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const VIDEO_JOB_MODES = ['success', 'retryable_failure', 'permanent_failure', 'timeout'] as const;
export type VideoJobMode = (typeof VIDEO_JOB_MODES)[number];

export const TASK_DECISIONS = ['pending', 'approved', 'rejected', 'changes_requested'] as const;
export type TaskDecision = (typeof TASK_DECISIONS)[number];

/** Map a ladder stage to the task type that produces it. */
export const STAGE_TASK: Record<string, TaskType> = {
  concept: 'outline',
  script: 'script',
  storyboard: 'storyboard',
  preview: 'preview',
  final: 'final',
};

export interface IGenerationTask {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  contractId?: Types.ObjectId;
  createdById: Types.ObjectId;
  taskType: TaskType;
  /** Ladder stage this task produces; null for verification runs. */
  stage?: (typeof LADDER_STAGES)[number];
  status: TaskStatus;
  attempt: number;
  inputPrompt: string;
  modelProvider: string;
  modelName: string;
  fallbackModel: string;
  estimatedCost: number;
  actualCost: number;
  tokensUsed: number;
  latencyMs: number;
  outputText: string;
  outputUrl?: string;
  error?: string;
  reviewStatus: TaskDecision;
  reviewedById?: Types.ObjectId;
  reviewedAt?: Date;
  reviewComment?: string;
  /** Why a previous attempt is being regenerated (required after a rejection). */
  regenerationNotes?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  workspaceId?: Types.ObjectId;
  progress?: number;
  currentStage?: string;
  maxAttempts?: number;
  retryCount?: number;
  nextAttemptAt?: Date;
  leaseId?: string;
  leaseExpiresAt?: Date;
  heartbeatAt?: Date;
  idempotencyKey?: string;
  requestFingerprint?: string;
  correlationId?: string;
  contractVersion?: number;
  errorCode?: string;
  errorMessage?: string;
  providerMode?: VideoJobMode;
  mockOutput?: boolean;
  providerId?: string;
  providerJobId?: string;
  providerStatus?: string;
  budgetReservationId?: Types.ObjectId;
  costCurrency?: string;
  timeoutAt?: Date;
  outputAssetId?: Types.ObjectId;
  ambiguousSubmission?: boolean;
}

const generationTaskSchema = new Schema<IGenerationTask>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'ProductionContract' },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskType: { type: String, enum: TASK_TYPES, required: true },
    stage: { type: String, enum: [...LADDER_STAGES, null], default: undefined },
    status: { type: String, enum: TASK_STATUSES, default: 'queued', index: true },
    attempt: { type: Number, default: 1, min: 1 },
    inputPrompt: { type: String, default: '' },
    modelProvider: { type: String, default: 'local' },
    modelName: { type: String, default: 'readyforge-local' },
    fallbackModel: { type: String, default: 'readyforge-rules' },
    estimatedCost: { type: Number, default: 0, min: 0 },
    actualCost: { type: Number, default: 0, min: 0 },
    tokensUsed: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    outputText: { type: String, default: '' },
    outputUrl: { type: String },
    error: { type: String },
    reviewStatus: { type: String, enum: TASK_DECISIONS, default: 'pending', index: true },
    reviewedById: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewComment: { type: String },
    regenerationNotes: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    currentStage: { type: String, default: '' },
    maxAttempts: { type: Number, min: 1, max: 10, default: 3 },
    retryCount: { type: Number, min: 0, default: 0 },
    nextAttemptAt: { type: Date },
    leaseId: { type: String },
    leaseExpiresAt: { type: Date, index: true },
    heartbeatAt: { type: Date },
    idempotencyKey: { type: String },
    requestFingerprint: { type: String },
    correlationId: { type: String, index: true },
    contractVersion: { type: Number },
    errorCode: { type: String },
    errorMessage: { type: String },
    providerMode: { type: String, enum: VIDEO_JOB_MODES, default: 'success' },
    mockOutput: { type: Boolean, default: false },
    providerId: { type: String },
    providerJobId: { type: String },
    providerStatus: { type: String },
    budgetReservationId: { type: Schema.Types.ObjectId, ref: 'BudgetReservation' },
    costCurrency: { type: String },
    timeoutAt: { type: Date },
    outputAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    ambiguousSubmission: { type: Boolean, default: false },
  },
  { timestamps: true }
);

generationTaskSchema.index({ projectId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
generationTaskSchema.index({ status: 1, nextAttemptAt: 1, leaseExpiresAt: 1 });

export const GenerationTask = model<IGenerationTask>('GenerationTask', generationTaskSchema);