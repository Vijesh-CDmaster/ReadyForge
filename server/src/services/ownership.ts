import { Types, HydratedDocument } from 'mongoose';
import { ApiError } from '../http';
import { audit } from '../audit';
import { Workspace, IWorkspace } from '../models/Workspace';
import { User } from '../models/User';
import { Notification } from '../models/Notification';

/** Pending ownership transfers expire if the recipient never responds. */
export const TRANSFER_TTL_HOURS = 72;

export interface PendingTransfer {
  toUserId: Types.ObjectId;
  initiatedBy: Types.ObjectId;
  expiresAt: Date;
}

/**
 * Concurrency strategy (documented in docs/ARCHITECTURE.md and docs/SECURITY.md):
 * all state for a transfer lives on ONE workspace document, and MongoDB writes
 * are atomic per document. We rely on Mongoose optimistic concurrency
 * (`__v` version key) so two concurrent writers cannot both succeed — the
 * loser gets a VersionError and the API answers 409. This works on standalone
 * MongoDB where multi-document transactions are unavailable.
 */
export async function initiateOwnershipTransfer(input: {
  workspaceId: string;
  actorId: string;
  targetUserId: string;
  ipAddress?: string;
}) {
  const ws = await Workspace.findById(input.workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');
  if (ws.ownerId.toString() !== input.actorId) {
    throw new ApiError(403, 'Only the current owner can initiate an ownership transfer');
  }
  if (input.targetUserId === input.actorId) {
    throw new ApiError(400, 'You already own this workspace');
  }
  const target = ws.members.find(
    (m) => m.userId.toString() === input.targetUserId && m.status === 'active'
  );
  if (!target) throw new ApiError(404, 'Recipient must be an active member of this workspace');

  ws.pendingOwnershipTransfer = {
    toUserId: new Types.ObjectId(input.targetUserId),
    initiatedBy: new Types.ObjectId(input.actorId),
    expiresAt: new Date(Date.now() + TRANSFER_TTL_HOURS * 60 * 60_000),
  };
  await saveOrConflict(ws);

  void Notification.create({
    userId: target.userId,
    workspaceId: ws._id,
    type: 'approval_required',
    title: `Ownership of ${ws.name} offered to you`,
    message: 'Open the workspace settings to accept or ignore this transfer.',
    link: `/app/workspaces/${ws._id}`,
  }).catch(() => undefined);

  audit({
    workspaceId: ws._id.toString(),
    actorId: input.actorId,
    action: 'workspace.ownership_transfer_initiated',
    entityType: 'workspace',
    entityId: ws._id.toString(),
    after: { toUserId: input.targetUserId, expiresAt: ws.pendingOwnershipTransfer.expiresAt },
    ipAddress: input.ipAddress,
  });
  return serializePending(ws.pendingOwnershipTransfer);
}

export async function cancelOwnershipTransfer(input: {
  workspaceId: string;
  actorId: string;
  ipAddress?: string;
}) {
  const ws = await Workspace.findById(input.workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');
  if (ws.ownerId.toString() !== input.actorId) {
    throw new ApiError(403, 'Only the current owner can cancel an ownership transfer');
  }
  if (!ws.pendingOwnershipTransfer) throw new ApiError(404, 'No ownership transfer is pending');
  ws.pendingOwnershipTransfer = null;
  await saveOrConflict(ws);
  audit({
    workspaceId: ws._id.toString(),
    actorId: input.actorId,
    action: 'workspace.ownership_transfer_cancelled',
    entityType: 'workspace',
    entityId: ws._id.toString(),
    ipAddress: input.ipAddress,
  });
  return { ok: true };
}

export async function acceptOwnershipTransfer(input: {
  workspaceId: string;
  userId: string;
  ipAddress?: string;
}) {
  const ws = await Workspace.findById(input.workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');

  const pending = ws.pendingOwnershipTransfer;
  if (!pending) throw new ApiError(404, 'No ownership transfer is pending');
  if (pending.toUserId.toString() !== input.userId) {
    throw new ApiError(403, 'This transfer was offered to a different member');
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    ws.pendingOwnershipTransfer = null;
    await ws.save().catch(() => undefined);
    throw new ApiError(409, 'This ownership transfer has expired — the owner must start it again');
  }
  const targetMember = ws.members.find(
    (m) => m.userId.toString() === input.userId && m.status === 'active'
  );
  if (!targetMember) throw new ApiError(403, 'You are not an active member of this workspace');

  const previousOwnerId = ws.ownerId.toString();

  // Exactly one owner: the previous owner is demoted to lead in the same
  // single-document write that promotes the recipient.
  for (const m of ws.members) {
    const id = m.userId.toString();
    if (id === input.userId) m.role = 'owner';
    else if (id === previousOwnerId && m.role === 'owner') m.role = 'lead';
  }
  ws.ownerId = new Types.ObjectId(input.userId);
  ws.pendingOwnershipTransfer = null;
  await saveOrConflict(ws);

  void Notification.create({
    userId: new Types.ObjectId(previousOwnerId),
    workspaceId: ws._id,
    type: 'member_invited',
    title: `You are no longer the owner of ${ws.name}`,
    message: 'Ownership was accepted by another member. Your role is now lead.',
    link: `/app/workspaces/${ws._id}`,
  }).catch(() => undefined);

  audit({
    workspaceId: ws._id.toString(),
    actorId: input.userId,
    action: 'workspace.ownership_transfer_completed',
    entityType: 'workspace',
    entityId: ws._id.toString(),
    before: { ownerId: previousOwnerId },
    after: { ownerId: input.userId, previousOwnerRole: 'lead' },
    ipAddress: input.ipAddress,
  });

  return {
    workspaceId: ws._id.toString(),
    ownerId: ws.ownerId.toString(),
    previousOwnerId,
  };
}

export function serializePending(p: PendingTransfer | null | undefined) {
  if (!p) return null;
  return {
    toUserId: p.toUserId.toString(),
    initiatedBy: p.initiatedBy.toString(),
    expiresAt: p.expiresAt,
  };
}

/** save() with a clean 409 when a concurrent writer won the race. */
async function saveOrConflict(ws: HydratedDocument<IWorkspace>) {
  try {
    await ws.save();
  } catch (err) {
    if ((err as { name?: string })?.name === 'VersionError') {
      throw new ApiError(409, 'Workspace was modified concurrently — please retry');
    }
    throw err;
  }
}

/** Used by routes to render transfer state with member names. */
export async function describePendingTransfer(ws: IWorkspace) {
  const pending = serializePending(ws.pendingOwnershipTransfer);
  if (!pending) return null;
  const users = await User.find({
    _id: { $in: [pending.toUserId, pending.initiatedBy] },
  }).select('name email');
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return {
    ...pending,
    toName: byId.get(pending.toUserId)?.name || 'Unknown user',
    initiatedByName: byId.get(pending.initiatedBy)?.name || 'Unknown user',
    expired: new Date(pending.expiresAt).getTime() <= Date.now(),
  };
}