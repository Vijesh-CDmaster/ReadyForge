import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { User, IUser } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { ProjectTemplate } from '../models/ProjectTemplate';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

let ownerUser: HydratedDocument<IUser>;
let outsiderUser: HydratedDocument<IUser>;
let wsId: string;
let otherWsId: string;

const validBrief = {
  objective: 'Sell candles',
  audience: 'Home bodies',
  tone: 'Warm',
  callToAction: 'Shop',
  tags: [] as string[],
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
  ownerUser = await User.create({ name: 'Owner', email: 'tpl-owner@example.com', passwordHash: hash });
  outsiderUser = await User.create({ name: 'Outsider', email: 'tpl-outsider@example.com', passwordHash: hash });
  const ws = await Workspace.create({
    name: 'Template WS',
    ownerId: ownerUser._id,
    members: [{ userId: ownerUser._id, role: 'owner', status: 'active', joinedAt: new Date() }],
    settings: { defaultCurrency: 'INR', aiProviders: [], budgetApprovalThreshold: 1000 },
  });
  wsId = ws._id.toString();
  const other = await Workspace.create({
    name: 'Other WS',
    ownerId: outsiderUser._id,
    members: [{ userId: outsiderUser._id, role: 'owner', status: 'active', joinedAt: new Date() }],
    settings: { defaultCurrency: 'INR', aiProviders: [], budgetApprovalThreshold: 1000 },
  });
  otherWsId = other._id.toString();
});

describe('built-in templates', () => {
  it('exposes the eight spec templates as code, not database rows', async () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(8);
    const ids = BUILTIN_TEMPLATES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BUILTIN_TEMPLATES) {
      expect(b.id.startsWith('builtin:')).toBe(true);
      expect(b.brief.objective.length).toBeGreaterThan(0);
      expect(['solo', 'team']).toContain(b.mode);
    }
  });

  it('are resolved by slug even though they are not ObjectIds', () => {
    const found = BUILTIN_TEMPLATES.find((b) => b.id === 'builtin:product_ad');
    expect(found?.projectType).toBe('ad');
    // slug must not satisfy the ObjectId pattern used for custom ids
    expect(/^[0-9a-f]{24}$/.test(found!.id)).toBe(false);
  });
});

describe('custom template persistence', () => {
  it('stores a workspace-scoped template with its brief', async () => {
    const tpl = await ProjectTemplate.create({
      workspaceId: wsId,
      ownerId: ownerUser._id,
      name: 'My brief',
      projectType: 'video',
      mode: 'team',
      brief: validBrief,
    });
    const stored = await ProjectTemplate.findById(tpl._id);
    expect(stored!.brief.objective).toBe('Sell candles');
    expect(stored!.workspaceId.toString()).toBe(wsId);
    expect(stored!.brief.tags).toEqual([]);
  });

  it('rejects an invalid project type', async () => {
    await expect(
      ProjectTemplate.create({
        workspaceId: wsId,
        ownerId: ownerUser._id,
        name: 'Bad',
        projectType: 'nope',
        mode: 'solo',
        brief: validBrief,
      })
    ).rejects.toThrow();
  });

  it('is findable only inside its own workspace (tenant isolation)', async () => {
    const tpl = await ProjectTemplate.create({
      workspaceId: wsId,
      ownerId: ownerUser._id,
      name: 'Private',
      projectType: 'ad',
      mode: 'solo',
      brief: validBrief,
    });
    const inOwn = await ProjectTemplate.findOne({ _id: tpl._id, workspaceId: wsId });
    const inForeign = await ProjectTemplate.findOne({ _id: tpl._id, workspaceId: otherWsId });
    expect(inOwn).toBeTruthy();
    expect(inForeign).toBeNull();
  });
});

describe('save project as template', () => {
  it('copies the brief fields from an existing project in the same workspace', async () => {
    const project = await Project.create({
      workspaceId: wsId,
      createdById: ownerUser._id,
      title: 'Candle launch',
      projectType: 'ad',
      mode: 'solo',
      objective: 'Launch the new candle line',
      audience: 'Candle buyers',
      tone: 'Cosy',
      callToAction: 'Buy now',
      deadline: new Date(Date.now() + 10 * 86400_000),
      budget: { amount: 5000, currency: 'INR', spent: 0, remaining: 5000 },
    });

    const brief = {
      objective: project.objective || '',
      audience: project.audience || '',
      tone: project.tone || '',
      callToAction: project.callToAction || '',
      budgetAmount: project.budget?.amount,
      currency: project.budget?.currency,
      tags: [],
      deadlineDays: 10,
    };
    const tpl = await ProjectTemplate.create({
      workspaceId: wsId,
      ownerId: ownerUser._id,
      name: 'From project',
      projectType: project.projectType,
      mode: project.mode,
      brief,
      sourceProjectId: project._id,
    });

    expect(tpl.brief.objective).toBe('Launch the new candle line');
    expect(tpl.brief.budgetAmount).toBe(5000);
    expect(tpl.sourceProjectId!.toString()).toBe(project._id.toString());
  });

  it('cannot read a project from another workspace', async () => {
    const foreign = await Project.create({
      workspaceId: otherWsId,
      createdById: outsiderUser._id,
      title: 'Foreign project',
      projectType: 'ad',
      mode: 'solo',
    });
    const found = await Project.findOne({ _id: foreign._id, workspaceId: wsId });
    expect(found).toBeNull();
  });
});

describe('create project from a template brief', () => {
  /** Mirrors the fill rule in POST /api/projects: explicit values win. */
  const pick = <T>(v: T | undefined, tpl: Record<string, unknown>, k: string): T | undefined =>
    v !== undefined && v !== null && v !== '' ? v : ((tpl[k] as T | undefined) ?? undefined);

  it('fills only the fields the caller left empty', async () => {
    const tplBrief = validBrief as unknown as Record<string, unknown>;
    expect(pick(undefined, tplBrief, 'audience')).toBe('Home bodies');
    expect(pick('MY audience', tplBrief, 'audience')).toBe('MY audience');
    expect(pick('', tplBrief, 'tone')).toBe('Warm');
    expect(pick(undefined, tplBrief, 'nonexistent')).toBeUndefined();
  });

  it('keeps template defaults out of fields with no template value', async () => {
    const partial = { objective: 'only objective' } as unknown as Record<string, unknown>;
    expect(pick(undefined, partial, 'tone')).toBeUndefined();
  });
});
