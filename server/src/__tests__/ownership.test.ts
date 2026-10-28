import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { User, IUser } from '../models/User';
import { Workspace } from '../models/Workspace';
import {
  initiateOwnershipTransfer,
  cancelOwnershipTransfer,
  acceptOwnershipTransfer,
} from '../services/ownership';
import { ApiError } from '../http';

let ownerUser: HydratedDocument<IUser>;
let memberUser: HydratedDocument<IUser>;
let outsiderUser: HydratedDocument<IUser>;
let wsId: string;

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
  const hash = await bcrypt.hash('Str0ngPass!x', 10);
  ownerUser = await User.create({ name: 'Owner', email: 'owner@example.com', passwordHash: hash });
  memberUser = await User.create({ name: 'Member', email: 'member@example.com', passwordHash: hash });
  outsiderUser = await User.create({ name: 'Outsider', email: 'outsider@example.com', passwordHash: hash });
  const ws = await Workspace.create({
    name: 'Transfer WS',
    ownerId: ownerUser._id,
    members: [
      { userId: ownerUser._id, role: 'owner', status: 'active', joinedAt: new Date() },
      { userId: memberUser._id, role: 'writer', status: 'active', joinedAt: new Date() },
    ],
    settings: { defaultCurrency: 'INR', aiProviders: [], budgetApprovalThreshold: 1000 },
  });
  wsId = ws._id.toString();
});

describe('initiate ownership transfer', () => {
  it('only the current owner can initiate', async () => {
    await expectApiError(
      () =>
        initiateOwnershipTransfer({
          workspaceId: wsId,
          actorId: memberUser._id.toString(),
          targetUserId: outsiderUser._id.toString(),
        }),
      403
    );
    await expectApiError(
      () =>
        initiateOwnershipTransfer({
          workspaceId: wsId,
          actorId: ownerUser._id.toString(),
          targetUserId: ownerUser._id.toString(),
        }),
      400
    );
  });

  it('requires an active member as the recipient', async () => {
    await expectApiError(
      () =>
        initiateOwnershipTransfer({
          workspaceId: wsId,
          actorId: ownerUser._id.toString(),
          targetUserId: outsiderUser._id.toString(),
        }),
      404
    );
  });

  it('stores the pending offer and can be cancelled', async () => {
    const pending = await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    expect(pending?.toUserId).toBe(memberUser._id.toString());
    const stored = await Workspace.findById(wsId);
    expect(stored!.pendingOwnershipTransfer?.toUserId.toString()).toBe(memberUser._id.toString());

    await cancelOwnershipTransfer({ workspaceId: wsId, actorId: ownerUser._id.toString() });
    const after = await Workspace.findById(wsId);
    expect(after!.pendingOwnershipTransfer).toBeFalsy();
  });
});

describe('accept ownership transfer', () => {
  it('only the offered member may accept', async () => {
    await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    await expectApiError(
      () => acceptOwnershipTransfer({ workspaceId: wsId, userId: outsiderUser._id.toString() }),
      403
    );
  });

  it('completes with exactly one owner: recipient promoted, previous owner demoted to lead', async () => {
    await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    const result = await acceptOwnershipTransfer({
      workspaceId: wsId,
      userId: memberUser._id.toString(),
    });
    expect(result.ownerId).toBe(memberUser._id.toString());
    expect(result.previousOwnerId).toBe(ownerUser._id.toString());

    const fresh = await Workspace.findById(wsId);
    expect(fresh!.ownerId.toString()).toBe(memberUser._id.toString());
    expect(fresh!.pendingOwnershipTransfer).toBeFalsy();
    expect(fresh!.members.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(fresh!.members.find((m) => m.userId.toString() === ownerUser._id.toString())!.role).toBe('lead');
    expect(fresh!.members.find((m) => m.userId.toString() === memberUser._id.toString())!.role).toBe('owner');
  });

  it('a second accept finds no pending transfer', async () => {
    await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    await acceptOwnershipTransfer({ workspaceId: wsId, userId: memberUser._id.toString() });
    await expectApiError(
      () => acceptOwnershipTransfer({ workspaceId: wsId, userId: memberUser._id.toString() }),
      404
    );
  });

  it('expired transfers cannot be accepted', async () => {
    await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    await Workspace.updateOne(
      { _id: wsId },
      { $set: { 'pendingOwnershipTransfer.expiresAt': new Date(Date.now() - 1000) } }
    );
    await expectApiError(
      () => acceptOwnershipTransfer({ workspaceId: wsId, userId: memberUser._id.toString() }),
      409
    );
    const fresh = await Workspace.findById(wsId);
    expect(fresh!.ownerId.toString()).toBe(ownerUser._id.toString());
  });

  it('concurrent accepts never produce two owners', async () => {
    await initiateOwnershipTransfer({
      workspaceId: wsId,
      actorId: ownerUser._id.toString(),
      targetUserId: memberUser._id.toString(),
    });
    const results = await Promise.allSettled([
      acceptOwnershipTransfer({ workspaceId: wsId, userId: memberUser._id.toString() }),
      acceptOwnershipTransfer({ workspaceId: wsId, userId: memberUser._id.toString() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const fresh = await Workspace.findById(wsId);
    expect(fresh!.members.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(fresh!.ownerId.toString()).toBe(memberUser._id.toString());
    // Losing attempt must fail cleanly (stale write → 409, later read → 404), not corrupt state.
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected).toBeTruthy();
    expect([404, 409]).toContain((rejected.reason as ApiError).status);
  });
});