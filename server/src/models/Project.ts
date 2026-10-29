import { Schema, model, Types } from 'mongoose';

export const PROJECT_TYPES = [
  'video',
  'social_post',
  'ad',
  'blog',
  'presentation',
  'landing_page',
  'custom',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = [
  'draft',
  'collecting_inputs',
  'validation',
  'contract_review',
  'ready',
  'generating',
  'review',
  'approved',
  'published',
  'blocked',
  'archived',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const LADDER_STAGES = ['concept', 'script', 'storyboard', 'preview', 'final'] as const;
export type LadderStage = (typeof LADDER_STAGES)[number];

export interface IProject {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  createdById: Types.ObjectId;
  title: string;
  description?: string;
  projectType: ProjectType;
  status: ProjectStatus;
  mode: 'solo' | 'team';
  objective?: string;
  audience?: string;
  tone?: string;
  callToAction?: string;
  successMetric?: string;
  deadline?: Date;
  budget: {
    amount: number;
    currency: string;
    spent: number;
    remaining: number;
    appliedOperations?: Array<{ key: string; kind: 'charge' | 'refund'; amount: number; createdAt: Date }>;
  };
  currentStage: LadderStage;
  readinessScore: number;
  costAtRisk?: {
    plannedCost: number;
    reworkProbability: number;
    estimatedLoss: number;
    currency: string;
    reasons: string[];
    updatedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 4000 },
    projectType: { type: String, enum: PROJECT_TYPES, default: 'custom' },
    status: { type: String, enum: PROJECT_STATUSES, default: 'draft', index: true },
    mode: { type: String, enum: ['solo', 'team'], default: 'solo' },
    objective: { type: String, maxlength: 2000 },
    audience: { type: String, maxlength: 1000 },
    tone: { type: String, maxlength: 400 },
    callToAction: { type: String, maxlength: 400 },
    successMetric: { type: String, maxlength: 400 },
    deadline: { type: Date },
    budget: {
      amount: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'INR' },
      spent: { type: Number, default: 0, min: 0 },
      remaining: { type: Number, default: 0 },
      appliedOperations: [
        {
          key: { type: String, required: true },
          kind: { type: String, enum: ['charge', 'refund'], required: true },
          amount: { type: Number, required: true, min: 0 },
          createdAt: { type: Date, required: true },
        },
      ],
    },
    currentStage: { type: String, enum: LADDER_STAGES, default: 'concept' },
    readinessScore: { type: Number, default: 0, min: 0, max: 100 },
    costAtRisk: {
      plannedCost: Number,
      reworkProbability: Number,
      estimatedLoss: Number,
      currency: String,
      reasons: [String],
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

export const Project = model<IProject>('Project', projectSchema);
