import { Schema, model, Types } from 'mongoose';
import { WORKSPACE_ROLES, WorkspaceRole } from './Workspace';

export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'revoked', 'expired', 'cancelled'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Invitations are valid for 7 days by default (spec §6.2: links must expire). */
export const INVITATION_TTL_DAYS = 7;

export interface IWorkspaceInvitation {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  /** Normalized (lowercase) email of the intended recipient. */
  email: string;
  inviterId: Types.ObjectId;
  role: WorkspaceRole;
  /** SHA-256 of the raw token. The raw token is never persisted. */
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  revokedAt?: Date;
  /** Incremented on every resend; each resend rotates the token. */
  resendCount: number;
  lastSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceInvitationSchema = new Schema<IWorkspaceInvitation>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: INVITATION_STATUSES, default: 'pending' },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    rejectedAt: Date,
    revokedAt: Date,
    resendCount: { type: Number, default: 0, min: 0 },
    lastSentAt: Date,
  },
  { timestamps: true }
);

// At most ONE active invitation per (workspace, email): concurrent duplicate
// invites race on this index and the loser gets a clean 409.
workspaceInvitationSchema.index(
  { workspaceId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
workspaceInvitationSchema.index({ workspaceId: 1, status: 1 });

export const WorkspaceInvitation = model<IWorkspaceInvitation>(
  'WorkspaceInvitation',
  workspaceInvitationSchema
);