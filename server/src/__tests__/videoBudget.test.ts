import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { BudgetReservation } from '../models/BudgetReservation';
import { reserveVideoBudget, refundVideoBudget, settleVideoBudget } from '../services/videoBudget';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

beforeAll(async () => connectTestDb());
beforeEach(async () => clearDb());
afterAll(async () => disconnectTestDb());

describe('video budget reservations', () => {
  it('reserves once for the same durable key', async () => {
    const project = await Project.create({
      workspaceId: new Types.ObjectId(),
      createdById: new Types.ObjectId(),
      title: 'Budget test',
      projectType: 'video',
      budget: { amount: 100, currency: 'USD', spent: 0, remaining: 100 },
    });
    const params = {
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'video-reservation-1',
      amount: 10,
      currency: 'USD',
    };
    const first = await reserveVideoBudget(params);
    const second = await reserveVideoBudget(params);
    const fresh = await Project.findById(project._id);
    expect(first._id.toString()).toBe(second._id.toString());
    expect(fresh?.budget.spent).toBe(10);
  });

  it('settles and refunds exactly once', async () => {
    const project = await Project.create({
      workspaceId: new Types.ObjectId(),
      createdById: new Types.ObjectId(),
      title: 'Refund test',
      projectType: 'video',
      budget: { amount: 100, currency: 'USD', spent: 0, remaining: 100 },
    });
    const reservation = await reserveVideoBudget({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'video-reservation-2',
      amount: 10,
      currency: 'USD',
    });
    await settleVideoBudget({ reservationId: reservation._id, actualAmount: 7 });
    await refundVideoBudget(reservation._id);
    const fresh = await Project.findById(project._id);
    const stored = await BudgetReservation.findById(reservation._id);
    expect(fresh?.budget.spent).toBe(7);
    expect(stored?.status).toBe('settled');
  });

  it('fails closed when the provider currency differs from the project currency', async () => {
    const project = await Project.create({
      workspaceId: new Types.ObjectId(),
      createdById: new Types.ObjectId(),
      title: 'Currency test',
      projectType: 'video',
      budget: { amount: 100, currency: 'INR', spent: 0, remaining: 100 },
    });
    await expect(
      reserveVideoBudget({
        projectId: project._id,
        generationTaskId: new Types.ObjectId(),
        key: 'video-reservation-3',
        amount: 10,
        currency: 'USD',
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});
