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
  'viewer',
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface IWorkspaceMember {
  userId: Types.ObjectId;
  role: WorkspaceRole;
  status: 'active' | 'invited' | 'removed';
  joinedAt?: Date;
}

export interface IWorkspace {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  ownerId: Types.ObjectId;
  members: IWorkspaceMember[];
  brandProfileId?: Types.ObjectId;
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
    settings: {
      defaultCurrency: { type: String, default: 'INR' },
      aiProviders: { type: [String], default: ['openai-compatible'] },
      budgetApprovalThreshold: { type: Number, default: 1000 },
    },
  },
  { timestamps: true }
);

export const Workspace = model<IWorkspace>('Workspace', workspaceSchema);
