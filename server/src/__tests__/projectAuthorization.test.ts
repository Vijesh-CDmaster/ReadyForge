import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { getAuthorizedProject } from '../middleware/auth';
import { ApiError } from '../http';

describe('project authorization', () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearDb();
  });

  it('rejects a project lookup for a user outside the project workspace', async () => {
    const passwordHash = await bcrypt.hash('Str0ngPass!x', 10);
    const owner = await User.create({ name: 'Owner', email: 'owner@example.com', passwordHash });
    const outsider = await User.create({ name: 'Outsider', email: 'outsider@example.com', passwordHash });
    const workspace = await Workspace.create({
      name: 'Private workspace',
      ownerId: owner._id,
      members: [{ userId: owner._id, role: 'owner', status: 'active', joinedAt: new Date() }],
      settings: { defaultCurrency: 'INR', aiProviders: [], budgetApprovalThreshold: 1000 },
    });
    const project = await Project.create({
      workspaceId: workspace._id,
      createdById: owner._id,
      title: 'Private project',
      projectType: 'custom',
      status: 'draft',
      mode: 'solo',
      budget: { amount: 0, currency: 'INR', spent: 0, remaining: 0 },
    });

    await expect(getAuthorizedProject(outsider, project._id)).rejects.toMatchObject({
      status: 403,
      message: 'You are not a member of this project workspace',
    } satisfies Partial<ApiError>);
  });
});
