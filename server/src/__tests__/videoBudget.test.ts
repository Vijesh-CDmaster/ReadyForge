import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { BudgetReservation } from '../models/BudgetReservation';
import {
  recoverVideoBudgetReservations,
  reconcileVideoBudget,
  reserveVideoBudget,
  refundVideoBudget,
  settleVideoBudget,
} from '../services/videoBudget';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

beforeAll(async () => connectTestDb());
beforeEach(async () => clearDb());
afterAll(async () => disconnectTestDb());

describe('video budget reservations', () => {
  async function makeProject() {
    return Project.create({
      workspaceId: new Types.ObjectId(),
      createdById: new Types.ObjectId(),
      title: 'Budget test',
      projectType: 'video',
      budget: { amount: 100, currency: 'USD', spent: 0, remaining: 100 },
    });
  }

  it('reserves once for the same durable key', async () => {
    const project = await makeProject();
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
    const project = await makeProject();
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

  it('recovers a reservation interrupted after the reservation document was created', async () => {
    const project = await makeProject();
    const reservation = await BudgetReservation.create({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'interrupted-reservation',
      estimatedAmount: 12,
      currency: 'USD',
      status: 'pending',
    });
    await reconcileVideoBudget(reservation._id);
    const freshProject = await Project.findById(project._id);
    const recovered = await BudgetReservation.findById(reservation._id);
    expect(freshProject?.budget.spent).toBe(12);
    expect(recovered?.status).toBe('reserved');
    expect(freshProject?.budget.appliedOperations).toHaveLength(1);
  });

  it('recovers an interrupted settlement without double-applying the adjustment', async () => {
    const project = await makeProject();
    const reservation = await reserveVideoBudget({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'interrupted-settlement',
      amount: 12,
      currency: 'USD',
    });
    await BudgetReservation.updateOne(
      { _id: reservation._id },
      { $set: { status: 'settling', pendingActualAmount: 8 } }
    );
    await reconcileVideoBudget(reservation._id);
    await reconcileVideoBudget(reservation._id);
    const freshProject = await Project.findById(project._id);
    const recovered = await BudgetReservation.findById(reservation._id);
    expect(freshProject?.budget.spent).toBe(8);
    expect(recovered?.status).toBe('settled');
  });

  it('handles concurrent settlement and refund calls idempotently', async () => {
    const project = await makeProject();
    const settlement = await reserveVideoBudget({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'concurrent-settlement',
      amount: 12,
      currency: 'USD',
    });
    await Promise.all([
      settleVideoBudget({ reservationId: settlement._id, actualAmount: 9 }),
      settleVideoBudget({ reservationId: settlement._id, actualAmount: 9 }),
    ]);
    const refund = await reserveVideoBudget({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'concurrent-refund',
      amount: 7,
      currency: 'USD',
    });
    await Promise.all([
      refundVideoBudget(refund._id),
      refundVideoBudget(refund._id),
    ]);
    const freshProject = await Project.findById(project._id);
    expect(freshProject?.budget.spent).toBe(9);
  });

  it('recovers pending reservations from the worker recovery pass', async () => {
    const project = await makeProject();
    await BudgetReservation.create({
      projectId: project._id,
      generationTaskId: new Types.ObjectId(),
      key: 'worker-recovery',
      estimatedAmount: 5,
      currency: 'USD',
      status: 'pending',
    });
    expect(await recoverVideoBudgetReservations()).toBe(1);
    const freshProject = await Project.findById(project._id);
    expect(freshProject?.budget.spent).toBe(5);
  });
});
