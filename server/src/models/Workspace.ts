import { Schema, model, Types } from 'mongoose';

export const WORKSPACE_ROLES = [
  'owner',
  'lead',
  'writer',
  'designer',
  'subject_matter_expert',
  'reviewer',
  'legal_reviewer',
  'finance_owner',
  'marketing_strategist',
  'viewer',
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface IWorkspaceMember {
  userId: Types.ObjectId;
  role: WorkspaceRole;
  status: 'active' | 'invited' | 'removed';
  joinedAt?: Date;
}

export interface IBrandDna {
  brandName: string;
  tone: string;
  bannedWords: string[];
  colourPalette: string[];
  logoRules: string;
  targetAudience: string;
  legalRestrictions: string[];
}

export interface IWorkspace {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  ownerId: Types.ObjectId;
  members: IWorkspaceMember[];
  brandProfileId?: Types.ObjectId;
  brandDna?: IBrandDna;
  /** Set when the workspace is archived; null/undefined = active. */
  archivedAt?: Date | null;
  /** One at most: owner offers, recipient must accept (spec §6.2 ownership transfer). */
  pendingOwnershipTransfer?: {
    toUserId: Types.ObjectId;
    initiatedBy: Types.ObjectId;
    expiresAt: Date;
  } | null;
  settings: {
    defaultCurrency: string;
    aiProviders: string[];
    budgetApprovalThreshold: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 1000 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: WORKSPACE_ROLES, required: true },
        status: { type: String, enum: ['active', 'invited', 'removed'], default: 'active' },
        joinedAt: { type: Date },
      },
    ],
    brandProfileId: { type: Schema.Types.ObjectId, ref: 'BrandProfile' },
    brandDna: {
      brandName: { type: String, maxlength: 200, default: '' },
      tone: { type: String, maxlength: 400, default: '' },
      bannedWords: { type: [String], default: [] },
      colourPalette: { type: [String], default: [] },
      logoRules: { type: String, maxlength: 1000, default: '' },
      targetAudience: { type: String, maxlength: 1000, default: '' },
      legalRestrictions: { type: [String], default: [] },
    },
    settings: {
      defaultCurrency: { type: String, default: 'INR' },
      aiProviders: { type: [String], default: ['openai-compatible'] },
      budgetApprovalThreshold: { type: Number, default: 1000 },
    },
    archivedAt: { type: Date, default: null },
    pendingOwnershipTransfer: {
      type: new Schema(
        {
          toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  // Optimistic concurrency: concurrent writers (e.g. competing ownership
  // transfers) fail with VersionError instead of silently overwriting.
  { timestamps: true, optimisticConcurrency: true }
);

export const Workspace = model<IWorkspace>('Workspace', workspaceSchema);
