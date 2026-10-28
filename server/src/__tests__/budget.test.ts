import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { Project } from '../models/Project';
import { chargeProjectBudget, refundProjectBudget } from '../services/budget';
import { ApiError } from '../http';

const workspaceId = new Types.ObjectId();
const createdById = new Types.ObjectId();

const expectApiError = async (fn: () => Promise<unknown>, status: number) => {
  try {
    await fn();
    throw new Error('expected ApiError');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
  }
};

async function makeProject(budget: { amount: number; spent?: number; remaining?: number }) {
  return Project.create({
    workspaceId,
    createdById,
    title: 'Budget project',
    projectType: 'ad',
    mode: 'solo',
    budget: {
      amount: budget.amount,
      currency: 'INR',
      spent: budget.spent ?? 0,
      remaining: budget.remaining ?? budget.amount,
    },
  });
}

async function readBudget(projectId: unknown) {
  const doc = await Project.findById(projectId).lean();
  return doc!.budget;
}

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('chargeProjectBudget', () => {
  it('applies a charge inside the hard limit and recomputes remaining', async () => {
    const p = await makeProject({ amount: 100 });
    await chargeProjectBudget({ projectId: p._id, cost: 30, what: 'Generating script' });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(30);
    expect(budget.remaining).toBe(70);
  });

  it('rejects a charge that would exceed the hard limit and leaves the budget untouched', async () => {
    const p = await makeProject({ amount: 100 });
    await expectApiError(
      () => chargeProjectBudget({ projectId: p._id, cost: 101, what: 'Generating final' }),
      402
    );
    const untouched = await readBudget(p._id);
    expect(untouched.spent).toBe(0);
    expect(untouched.remaining).toBe(100);
  });

  it('rejects a partial fit once the remaining balance is too small', async () => {
    const p = await makeProject({ amount: 100 });
    await chargeProjectBudget({ projectId: p._id, cost: 90, what: 'Generating script' });
    await expectApiError(
      () => chargeProjectBudget({ projectId: p._id, cost: 20, what: 'Generating storyboard' }),
      402
    );
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(90);
    expect(budget.remaining).toBe(10);
  });

  it('never overspends under concurrent charges: only the charges that fit are applied', async () => {
    const p = await makeProject({ amount: 100 });
    // 6 simultaneous 30-unit charges against a 100-unit budget: at most 3 can fit.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        chargeProjectBudget({ projectId: p._id, cost: 30, what: 'Concurrent generate' })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);

    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(90);
    expect(budget.remaining).toBe(10);
    for (const r of results) {
      if (r.status === 'rejected') expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    }
  });

  it('treats a zero-cost charge as a no-op', async () => {
    const p = await makeProject({ amount: 100 });
    await chargeProjectBudget({ projectId: p._id, cost: 0, what: 'Free step' });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(0);
    expect(budget.remaining).toBe(100);
  });

  it('keeps the historical clamp behaviour for a project with no budget configured', async () => {
    // amount = 0 means "no budget set": the generation ladder blocks those projects,
    // but the variant matrix historically still charged and clamped remaining at zero.
    const p = await makeProject({ amount: 0, remaining: 0 });
    await chargeProjectBudget({ projectId: p._id, cost: 70, what: 'Generating the variant matrix' });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(70);
    expect(budget.remaining).toBe(0);
  });

  it('404s for an unknown project', async () => {
    await expectApiError(
      () => chargeProjectBudget({ projectId: new Types.ObjectId(), cost: 10, what: 'Ghost' }),
      404
    );
  });
});

describe('refundProjectBudget', () => {
  it('restores the budget after a failed generation run', async () => {
    const p = await makeProject({ amount: 100 });
    await chargeProjectBudget({ projectId: p._id, cost: 40, what: 'Generating concept' });
    await refundProjectBudget({ projectId: p._id, cost: 40 });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(0);
    expect(budget.remaining).toBe(100);
  });

  it('never drives the counter negative when there is nothing to refund', async () => {
    const p = await makeProject({ amount: 100 });
    await refundProjectBudget({ projectId: p._id, cost: 50 });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(0);
    expect(budget.remaining).toBe(100);
  });

  it('an oversized refund is a no-op — spent never goes negative', async () => {
    const p = await makeProject({ amount: 100 });
    await chargeProjectBudget({ projectId: p._id, cost: 30, what: 'Generating concept' });
    await refundProjectBudget({ projectId: p._id, cost: 999 });
    const budget = await readBudget(p._id);
    expect(budget.spent).toBe(30);
    expect(budget.remaining).toBe(70);
  });
});
