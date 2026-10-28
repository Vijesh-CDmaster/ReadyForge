import { ApiError } from '../http';
import { audit } from '../audit';
import { generateToken, hashToken } from '../crypto';
import { isEmailConfigured, sendEmail } from '../email';
import { config } from '../config';
import { Workspace, IWorkspace, WorkspaceRole } from '../models/Workspace';
import {
  WorkspaceInvitation,
  IWorkspaceInvitation,
  INVITATION_TTL_DAYS,
} from '../models/WorkspaceInvitation';
import { User, IUser } from '../models/User';
import { Notification } from '../models/Notification';

export interface DeliveryOutcome {
  /** True only when a provider actually accepted the message. */
  delivered: boolean;
  mode: 'email' | 'link_only';
  note?: string;
}

export interface CreateInvitationInput {
  workspace: IWorkspace;
  email: string;
  role: WorkspaceRole;
  inviterId: string;
  ipAddress?: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const inviteUrl = (token: string) =>
  `${config.corsOrigin.split(',')[0].trim()}/invite/${token}`;
const ttl = () => new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60_000);

/**
 * Creates a pending invitation. Returns the RAW token exactly once — the
 * caller decides whether it may be exposed (development-only fallback), and
 * only a hash is persisted.
 */
export async function createWorkspaceInvitation(input: CreateInvitationInput) {
  const email = normalizeEmail(input.email);
  const ws = input.workspace;

  const invitedUser = await User.findOne({ email }).select('_id');
  if (invitedUser) {
    const active = ws.members.find(
      (m) => m.userId.toString() === invitedUser._id.toString() && m.status === 'active'
    );
    if (active) throw new ApiError(409, 'Already a member of this workspace');
  }

  const pending = await WorkspaceInvitation.findOne({
    workspaceId: ws._id,
    email,
    status: 'pending',
  });
  if (pending) throw new ApiError(409, 'An invitation is already pending for this email');

  const token = generateToken();
  const invitation = await WorkspaceInvitation.create({
    workspaceId: ws._id,
    email,
    inviterId: input.inviterId,
    role: input.role,
    tokenHash: hashToken(token),
    status: 'pending',
    expiresAt: ttl(),
    resendCount: 0,
    lastSentAt: new Date(),
  });

  const delivery = await deliverInvitation(email, token, ws.name, input.role);

  // In-app notification for a registered recipient (never contains the token).
  if (invitedUser) {
    void Notification.create({
      userId: invitedUser._id,
      workspaceId: ws._id,
      type: 'member_invited',
      title: `You were invited to ${ws.name}`,
      message: `Role: ${input.role.replace(/_/g, ' ')}. Open the invitation to accept or reject it.`,
      link: '/app',
    }).catch(() => undefined);
  }

  audit({
    workspaceId: ws._id.toString(),
    actorId: input.inviterId,
    action: 'workspace.invite_create',
    entityType: 'workspace_invitation',
    entityId: invitation._id.toString(),
    after: { email, role: input.role, mode: delivery.mode },
    ipAddress: input.ipAddress,
  });

  return { invitation, token, delivery };
}

async function deliverInvitation(email: string, token: string, wsName: string, role: WorkspaceRole) {
  const result = await sendEmail({
    to: email,
    subject: `Invitation to join ${wsName} on ReadyForge`,
    text: `You have been invited as ${role}. Accept: ${inviteUrl(token)}`,
  });
  if (result.delivered) return { delivered: true, mode: 'email' as const };

  // Honest degraded mode: no provider → the link is returned to the caller
  // (development only) and NEVER claimed as delivered.
  if (!config.isProd) {
    return {
      delivered: false,
      mode: 'link_only' as const,
      note: 'No email provider configured — invitation link returned to you instead of being emailed.',
    };
  }
  return {
    delivered: false,
    mode: 'link_only' as const,
    note: 'No email provider configured — the invitation is saved but cannot be delivered.',
  };
}

/** Lists invitations, lazily flipping pending → expired when past their TTL. */
export async function listWorkspaceInvitations(workspaceId: string) {
  await WorkspaceInvitation.updateMany(
    { workspaceId, status: 'pending', expiresAt: { $lte: new Date() } },
    { $set: { status: 'expired' } }
  );
  const list = await WorkspaceInvitation.find({ workspaceId }).sort('-createdAt').limit(100);
  const inviterIds = list.map((i) => i.inviterId);
  const inviters = await User.find({ _id: { $in: inviterIds } }).select('name email');
  const names = new Map(inviters.map((u) => [u._id.toString(), u.name]));
  return list.map((i) => serializeInvitation(i, names));
}

export function serializeInvitation(
  i: IWorkspaceInvitation,
  names?: Map<string, string>
) {
  return {
    id: i._id.toString(),
    workspaceId: i.workspaceId.toString(),
    email: i.email,
    role: i.role,
    status: i.status,
    expiresAt: i.expiresAt,
    invitedBy: names?.get(i.inviterId.toString()) || undefined,
    resendCount: i.resendCount,
    acceptedAt: i.acceptedAt ?? null,
    rejectedAt: i.rejectedAt ?? null,
    revokedAt: i.revokedAt ?? null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export async function resendWorkspaceInvitation(input: {
  workspace: IWorkspace;
  invitationId: string;
  actorId: string;
  ipAddress?: string;
}) {
  const inv = await WorkspaceInvitation.findOne({
    _id: input.invitationId,
    workspaceId: input.workspace._id,
  });
  if (!inv) throw new ApiError(404, 'Invitation not found');
  if (inv.status !== 'pending') {
    throw new ApiError(409, `Invitation is ${inv.status} — create a new invitation instead`);
  }
  const token = generateToken();
  inv.tokenHash = hashToken(token); // rotation: the old link stops working
  inv.expiresAt = ttl();
  inv.resendCount += 1;
  inv.lastSentAt = new Date();
  await inv.save();

  const delivery = await deliverInvitation(inv.email, token, input.workspace.name, inv.role);
  audit({
    workspaceId: input.workspace._id.toString(),
    actorId: input.actorId,
    action: 'workspace.invite_resend',
    entityType: 'workspace_invitation',
    entityId: inv._id.toString(),
    after: { resendCount: inv.resendCount, mode: delivery.mode },
    ipAddress: input.ipAddress,
  });
  return { invitation: inv, token, delivery };
}

export async function cancelWorkspaceInvitation(input: {
  workspace: IWorkspace;
  invitationId: string;
  actorId: string;
  ipAddress?: string;
}) {
  const inv = await WorkspaceInvitation.findOneAndUpdate(
    { _id: input.invitationId, workspaceId: input.workspace._id, status: 'pending' },
    { $set: { status: 'cancelled', revokedAt: new Date() } },
    { new: true }
  );
  if (!inv) {
    const exists = await WorkspaceInvitation.findOne({
      _id: input.invitationId,
      workspaceId: input.workspace._id,
    });
    if (!exists) throw new ApiError(404, 'Invitation not found');
    throw new ApiError(409, `Invitation is already ${exists.status}`);
  }
  audit({
    workspaceId: input.workspace._id.toString(),
    actorId: input.actorId,
    action: 'workspace.invite_cancel',
    entityType: 'workspace_invitation',
    entityId: inv._id.toString(),
    before: { status: 'pending' },
    after: { status: 'cancelled' },
    ipAddress: input.ipAddress,
  });
  return inv;
}

/** Resolves a raw token to its invitation, lazily expiring it. Never leaks why a token failed. */
export async function resolveInvitationByToken(token: string): Promise<IWorkspaceInvitation> {
  const inv = await WorkspaceInvitation.findOne({ tokenHash: hashToken(token) });
  if (!inv) throw new ApiError(404, 'Invitation not found or no longer valid');
  if (inv.status === 'pending' && inv.expiresAt.getTime() <= Date.now()) {
    inv.status = 'expired';
    await inv.save();
  }
  return inv;
}

/** Safe, tokenless payload for the invitation landing page. */
export async function inspectInvitation(token: string) {
  const inv = await resolveInvitationByToken(token);
  const ws = await Workspace.findById(inv.workspaceId).select('name description');
  const inviter = await User.findById(inv.inviterId).select('name');
  return {
    id: inv._id.toString(),
    workspaceName: ws?.name || 'Unknown workspace',
    workspaceDescription: ws?.description || '',
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    invitedBy: inviter?.name || 'A teammate',
  };
}

async function ensureMembership(workspaceId: string, userId: string, role: WorkspaceRole) {
  const notYet = await Workspace.updateOne(
    { _id: workspaceId, 'members.userId': { $ne: userId } },
    { $push: { members: { userId, role, status: 'active', joinedAt: new Date() } } }
  );
  if (notYet.modifiedCount === 1) return { alreadyMember: false };

  // Previously removed member → reactivate atomically via positional update.
  const active = await Workspace.findOne({
    _id: workspaceId,
    members: { $elemMatch: { userId, status: 'active' } },
  }).select('_id');
  if (active) return { alreadyMember: true };

  await Workspace.updateOne(
    { _id: workspaceId, 'members.userId': userId },
    { $set: { 'members.$.status': 'active', 'members.$.role': role, 'members.$.joinedAt': new Date() } }
  );
  return { alreadyMember: false, reactivated: true };
}

export async function acceptInvitation(input: {
  token: string;
  user: Pick<IUser, '_id' | 'email'>;
  ipAddress?: string;
}) {
  const email = normalizeEmail(input.user.email);
  let inv = await resolveInvitationByToken(input.token);

  if (inv.email !== email) {
    throw new ApiError(403, 'This invitation was issued to a different email address');
  }

  if (inv.status === 'accepted') {
    const m = await ensureMembership(inv.workspaceId.toString(), input.user._id.toString(), inv.role);
    return { workspaceId: inv.workspaceId.toString(), role: inv.role, ...m };
  }
  if (inv.status !== 'pending') {
    throw new ApiError(409, `This invitation is ${inv.status} — ask for a new one`);
  }

  // Atomic pending → accepted transition: exactly one concurrent accept wins.
  const claimed = await WorkspaceInvitation.findOneAndUpdate(
    {
      _id: inv._id,
      status: 'pending',
      email,
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: 'accepted', acceptedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    inv = await resolveInvitationByToken(input.token);
    if (inv.status === 'accepted') {
      const m = await ensureMembership(inv.workspaceId.toString(), input.user._id.toString(), inv.role);
      return { workspaceId: inv.workspaceId.toString(), role: inv.role, ...m };
    }
    throw new ApiError(409, `This invitation is ${inv.status} — ask for a new one`);
  }

  const membership = await ensureMembership(
    claimed.workspaceId.toString(),
    input.user._id.toString(),
    claimed.role
  );

  audit({
    workspaceId: claimed.workspaceId.toString(),
    actorId: input.user._id.toString(),
    action: 'workspace.invite_accept',
    entityType: 'workspace_invitation',
    entityId: claimed._id.toString(),
    after: { email, role: claimed.role },
    ipAddress: input.ipAddress,
  });

  return { workspaceId: claimed.workspaceId.toString(), role: claimed.role, ...membership };
}

export async function rejectInvitation(input: {
  token: string;
  user: Pick<IUser, '_id' | 'email'>;
  ipAddress?: string;
}) {
  const email = normalizeEmail(input.user.email);
  const inv = await resolveInvitationByToken(input.token);
  if (inv.email !== email) {
    throw new ApiError(403, 'This invitation was issued to a different email address');
  }
  if (inv.status !== 'pending') {
    throw new ApiError(409, `This invitation is ${inv.status}`);
  }
  const updated = await WorkspaceInvitation.findOneAndUpdate(
    { _id: inv._id, status: 'pending' },
    { $set: { status: 'rejected', rejectedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This invitation is no longer pending');

  audit({
    workspaceId: inv.workspaceId.toString(),
    actorId: input.user._id.toString(),
    action: 'workspace.invite_reject',
    entityType: 'workspace_invitation',
    entityId: inv._id.toString(),
    after: { status: 'rejected' },
    ipAddress: input.ipAddress,
  });
  return updated;
}

export { isEmailConfigured };