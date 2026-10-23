import { Schema, model, Types } from 'mongoose';

export const CONTRACT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'locked',
  'superseded',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface IStoryboardScene {
  sceneNumber: number;
  title: string;
  description: string;
  visualDirection?: string;
  voiceover?: string;
  durationSeconds?: number;
  status: 'draft' | 'approved' | 'failed' | 'regenerated';
}

export interface IApproval {
  userId: Types.ObjectId;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: Date;
  comment?: string;
}

export interface IProductionContract {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  version: number;
  status: ContractStatus;
  objective: string;
  audience: string;
  tone: string;
  keyMessage: string;
  callToAction: string;
  approvedClaimIds: Types.ObjectId[];
  approvedAssetIds: Types.ObjectId[];
  brandRules: string[];
  accessibilityRequirements: string[];
  localisationRequirements: string[];
  contentPlan: {
    outline: string[];
    script: string;
    storyboard: IStoryboardScene[];
  };
  modelRoutingPlan: Array<{
    task: string;
    preferredModel: string;
    fallbackModel: string;
    estimatedCost: number;
    reason: string;
  }>;
  budgetLimit: number;
  requiredApprovals: IApproval[];
  blockers: string[];
  createdById: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const contractSchema = new Schema<IProductionContract>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    version: { type: Number, default: 1 },
    status: { type: String, enum: CONTRACT_STATUSES, default: 'draft', index: true },
    objective: { type: String, default: '' },
    audience: { type: String, default: '' },
    tone: { type: String, default: '' },
    keyMessage: { type: String, default: '' },
    callToAction: { type: String, default: '' },
    approvedClaimIds: { type: [Schema.Types.ObjectId], ref: 'KnowledgeInput', default: [] },
    approvedAssetIds: { type: [Schema.Types.ObjectId], ref: 'Asset', default: [] },
    brandRules: { type: [String], default: [] },
    accessibilityRequirements: { type: [String], default: [] },
    localisationRequirements: { type: [String], default: [] },
    contentPlan: {
      outline: { type: [String], default: [] },
      script: { type: String, default: '' },
      storyboard: [
        {
          sceneNumber: Number,
          title: String,
          description: String,
          visualDirection: String,
          voiceover: String,
          durationSeconds: Number,
          status: {
            type: String,
            enum: ['draft', 'approved', 'failed', 'regenerated'],
            default: 'draft',
          },
        },
      ],
    },
    modelRoutingPlan: [
      {
        task: String,
        preferredModel: String,
        fallbackModel: String,
        estimatedCost: Number,
        reason: String,
      },
    ],
    budgetLimit: { type: Number, default: 0 },
    requiredApprovals: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        role: String,
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        decidedAt: Date,
        comment: String,
      },
    ],
    blockers: { type: [String], default: [] },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

export const ProductionContract = model<IProductionContract>('ProductionContract', contractSchema);
