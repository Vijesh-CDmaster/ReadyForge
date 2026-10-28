import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { User, IUser } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceInvitation } from '../models/WorkspaceInvitation';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  resendWorkspaceInvitation,
  cancelWorkspaceInvitation,
  resolveInvitationByToken,
  inspectInvitation,
  acceptInvitation,
  rejectInvitation,
} from '../services/invitations';
import { ApiError } from '../http';

let owner: HydratedDocument<IUser>;
let wsId: string;

async function makeUser(email: string) {
  return User.create({ name: email.split('@')[0], email, passwordHash: await bcrypt.hash('Str0ngPass!x', 10) });
}

async function makeWorkspace(ownerId: string) {
  const ws = await Workspace.create({
    name: 'Test WS',
    ownerId,
    members: [{ userId: ownerId, role: 'owner', status: 'active', joinedAt: new Date() }],
    settings: { defaultCurrency: 'INR', aiProviders: [], budgetApprovalThreshold: 1000 },
  });
  return ws;
}

const expectApiError = async (fn: () => Promise<unknown>, status: number) => {
  try {
    await fn();
    throw new Error('expected ApiError');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
  }
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
  owner = await makeUser('owner@example.com');
  const ws = await makeWorkspace(owner._id.toString());
  wsId = ws._id.toString();
});

describe('invitation creation', () => {
  it('persists only a hash — the raw token is never stored', async () => {
    const { invitation, token, delivery } = await createWorkspaceInvitation({
      workspace: (await Workspace.findById(wsId))!,
      email: 'New.Member@Example.com',
      role: 'writer',
      inviterId: owner._id.toString(),
    });
    expect(token).toHaveLength(64);
    expect(invitation.tokenHash).not.toBe(token);
    expect(invitation.tokenHash).toHaveLength(64);
    expect(invitation.email).toBe('new.member@example.com'); // normalized
    // No email provider → honest degraded delivery, never "delivered".
    expect(delivery.delivered).toBe(false);
    expect(delivery.mode).toBe('link_only');

    const stored = await WorkspaceInvitation.findById(invitation._id).lean();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('rejects a duplicate pending invitation with 409', async () => {
    const ws = (await Workspace.findById(wsId))!;
    await createWorkspaceInvitation({ workspace: ws, email: 'dup@example.com', role: 'writer', inviterId: owner._id.toString() });
    await expectApiError(
      () => createWorkspaceInvitation({ workspace: ws, email: 'DUP@example.com', role: 'viewer', inviterId: owner._id.toString() }),
      409
    );
  });

  it('rejects inviting an existing active member with 409', async () => {
    const ws = (await Workspace.findById(wsId))!;
    await expectApiError(
      () => createWorkspaceInvitation({ workspace: ws, email: 'owner@example.com', role: 'writer', inviterId: owner._id.toString() }),
      409
    );
  });

  it('lists invitations and flips overdue pending ones to expired', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { invitation } = await createWorkspaceInvitation({ workspace: ws, email: 'late@example.com', role: 'viewer', inviterId: owner._id.toString() });
    await WorkspaceInvitation.updateOne({ _id: invitation._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const rows = await listWorkspaceInvitations(wsId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('expired');
  });
});

describe('token lifecycle: resend, cancel, expiry', () => {
  it('resend rotates the token so the old link stops working', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { invitation, token: oldToken } = await createWorkspaceInvitation({ workspace: ws, email: 'rotate@example.com', role: 'writer', inviterId: owner._id.toString() });
    const { token: newToken, invitation: refreshed } = await resendWorkspaceInvitation({
      workspace: ws,
      invitationId: invitation._id.toString(),
      actorId: owner._id.toString(),
    });
    expect(newToken).not.toBe(oldToken);
    expect(refreshed.resendCount).toBe(1);
    await expectApiError(() => resolveInvitationByToken(oldToken), 404);
    const resolved = await resolveInvitationByToken(newToken);
    expect(resolved.status).toBe('pending');
  });

  it('cancelled invitations cannot be accepted', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { invitation, token } = await createWorkspaceInvitation({ workspace: ws, email: 'gone@example.com', role: 'viewer', inviterId: owner._id.toString() });
    await cancelWorkspaceInvitation({ workspace: ws, invitationId: invitation._id.toString(), actorId: owner._id.toString() });
    const recipient = await makeUser('gone@example.com');
    await expectApiError(
      () => acceptInvitation({ token, user: { _id: recipient._id, email: recipient.email } }),
      409
    );
  });

  it('expired invitations are marked expired and rejected on accept', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { invitation, token } = await createWorkspaceInvitation({ workspace: ws, email: 'slow@example.com', role: 'viewer', inviterId: owner._id.toString() });
    await WorkspaceInvitation.updateOne({ _id: invitation._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const recipient = await makeUser('slow@example.com');
    await expectApiError(
      () => acceptInvitation({ token, user: { _id: recipient._id, email: recipient.email } }),
      409
    );
    const after = await WorkspaceInvitation.findById(invitation._id);
    expect(after!.status).toBe('expired');
  });

  it('inspect returns safe details without leaking the token hash', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { token } = await createWorkspaceInvitation({ workspace: ws, email: 'peek@example.com', role: 'writer', inviterId: owner._id.toString() });
    const details = await inspectInvitation(token);
    expect(details.email).toBe('peek@example.com');
    expect(details.workspaceName).toBe('Test WS');
    expect(JSON.stringify(details)).not.toContain('tokenHash');
  });
});

describe('accept / reject', () => {
  it('accepting with the wrong email is forbidden', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { token } = await createWorkspaceInvitation({ workspace: ws, email: 'intended@example.com', role: 'writer', inviterId: owner._id.toString() });
    const stranger = await makeUser('stranger@example.com');
    await expectApiError(
      () => acceptInvitation({ token, user: { _id: stranger._id, email: stranger.email } }),
      403
    );
  });

  it('accepting adds an active membership exactly once (idempotent)', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { token } = await createWorkspaceInvitation({ workspace: ws, email: 'member@example.com', role: 'writer', inviterId: owner._id.toString() });
    const recipient = await makeUser('member@example.com');
    const first = await acceptInvitation({ token, user: { _id: recipient._id, email: recipient.email } });
    expect(first.alreadyMember).toBe(false);
    const second = await acceptInvitation({ token, user: { _id: recipient._id, email: recipient.email } });
    expect(second.alreadyMember).toBe(true);

    const fresh = await Workspace.findById(wsId);
    const rows = fresh!.members.filter((m) => m.userId.toString() === recipient._id.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].role).toBe('writer');
  });

  it('concurrent accepts still produce a single membership', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { token } = await createWorkspaceInvitation({ workspace: ws, email: 'race@example.com', role: 'reviewer', inviterId: owner._id.toString() });
    const recipient = await makeUser('race@example.com');
    const user = { _id: recipient._id, email: recipient.email };
    const results = await Promise.allSettled([
      acceptInvitation({ token, user }),
      acceptInvitation({ token, user }),
      acceptInvitation({ token, user }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const fresh = await Workspace.findById(wsId);
    expect(fresh!.members.filter((m) => m.userId.toString() === recipient._id.toString())).toHaveLength(1);
    const inv = await WorkspaceInvitation.findOne({ tokenHash: (await resolveInvitationByToken(token)).tokenHash });
    expect(inv!.status).toBe('accepted');
  });

  it('rejecting marks the invitation and blocks a later accept', async () => {
    const ws = (await Workspace.findById(wsId))!;
    const { token, invitation } = await createWorkspaceInvitation({ workspace: ws, email: 'nope@example.com', role: 'viewer', inviterId: owner._id.toString() });
    const recipient = await makeUser('nope@example.com');
    await rejectInvitation({ token, user: { _id: recipient._id, email: recipient.email } });
    const stored = await WorkspaceInvitation.findById(invitation._id);
    expect(stored!.status).toBe('rejected');
    expect(stored!.rejectedAt).toBeTruthy();
    await expectApiError(
      () => acceptInvitation({ token, user: { _id: recipient._id, email: recipient.email } }),
      409
    );
    const fresh = await Workspace.findById(wsId);
    expect(fresh!.members.some((m) => m.userId.toString() === recipient._id.toString())).toBe(false);
  });
});