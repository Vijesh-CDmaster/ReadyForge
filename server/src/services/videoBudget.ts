import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { BudgetReservation } from '../models/BudgetReservation';
import { ApiError } from '../http';
import { chargeProjectBudget, refundProjectBudget } from './budget';

export async function reserveVideoBudget(params: {
  projectId: Types.ObjectId;
  generationTaskId: Types.ObjectId;
  key: string;
  amount: number;
  currency: string;
}): Promise<IBudgetReservationResult> {
  if (params.amount < 0) throw new ApiError(400, 'Video estimate cannot be negative.');
  const existing = await BudgetReservation.findOne({ key: params.key });
  if (existing) {
    if (existing.status !== 'reserved') {
      throw new ApiError(409, 'This video budget reservation requires manual reconciliation.');
    }
    return existing;
  }

  const project = await Project.findById(params.projectId).select('budget.currency');
  if (!project) throw new ApiError(404, 'Project not found.');
  if (params.amount > 0 && project.budget.currency !== params.currency) {
    throw new ApiError(409, `Video provider currency ${params.currency} does not match project currency ${project.budget.currency}.`);
  }
  let pending: IBudgetReservationResult;
  try {
    pending = await BudgetReservation.create({
      projectId: params.projectId,
      generationTaskId: params.generationTaskId,
      key: params.key,
      estimatedAmount: params.amount,
      currency: params.currency,
      status: 'pending',
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const duplicate = await BudgetReservation.findOne({ key: params.key });
    if (!duplicate) throw error;
    if (duplicate.status !== 'reserved') {
      throw new ApiError(409, 'This video budget reservation requires manual reconciliation.');
    }
    return duplicate;
  }
  try {
    await chargeProjectBudget({ projectId: params.projectId, cost: params.amount, what: 'Video generation' });
    const reserved = await BudgetReservation.findOneAndUpdate(
      { _id: pending._id, status: 'pending' },
      { $set: { status: 'reserved' } },
      { new: true }
    );
    if (!reserved) throw new ApiError(409, 'Video budget reservation changed unexpectedly.');
    return reserved;
  } catch (error) {
    await BudgetReservation.updateOne(
      { _id: pending._id, status: 'pending' },
      { $set: { status: 'manual_review' } }
    );
    throw error;
  }
}

export type IBudgetReservationResult = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  generationTaskId: Types.ObjectId;
  key: string;
  estimatedAmount: number;
  actualAmount: number;
  currency: string;
  status: 'pending' | 'reserved' | 'settled' | 'refunded' | 'manual_review';
};

export async function settleVideoBudget(params: {
  reservationId: Types.ObjectId;
  actualAmount: number;
}): Promise<void> {
  const reservation = await BudgetReservation.findOneAndUpdate(
    { _id: params.reservationId, status: 'reserved' },
    { $set: { status: 'settled', actualAmount: params.actualAmount } },
    { new: true }
  );
  if (!reservation) return;
  if (params.actualAmount < reservation.estimatedAmount) {
    await refundProjectBudget({
      projectId: reservation.projectId,
      cost: reservation.estimatedAmount - params.actualAmount,
    });
  } else if (params.actualAmount > reservation.estimatedAmount) {
    const project = await Project.findById(reservation.projectId).select('budget');
    if (!project || project.budget.remaining < params.actualAmount - reservation.estimatedAmount) {
      await BudgetReservation.updateOne({ _id: reservation._id }, { $set: { status: 'manual_review' } });
      throw new ApiError(402, 'Actual video cost exceeds the reserved budget.');
    }
    await chargeProjectBudget({
      projectId: reservation.projectId,
      cost: params.actualAmount - reservation.estimatedAmount,
      what: 'Video generation reconciliation',
    });
  }
}

export async function refundVideoBudget(reservationId: Types.ObjectId): Promise<void> {
  const reservation = await BudgetReservation.findOneAndUpdate(
    { _id: reservationId, status: 'reserved' },
    { $set: { status: 'refunded', actualAmount: 0 } },
    { new: true }
  );
  if (!reservation) return;
  await refundProjectBudget({ projectId: reservation.projectId, cost: reservation.estimatedAmount });
}
