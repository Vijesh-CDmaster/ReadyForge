import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { BudgetReservation, IBudgetReservation } from '../models/BudgetReservation';
import { ApiError } from '../http';
import { chargeProjectBudget, refundProjectBudget } from './budget';

function operationKey(reservationId: Types.ObjectId, action: string): string {
  return `video:${reservationId.toString()}:${action}`;
}

async function operationApplied(projectId: Types.ObjectId, key: string): Promise<boolean> {
  return Boolean(await Project.exists({ _id: projectId, 'budget.appliedOperations.key': key }));
}

async function applySettlement(reservation: IBudgetReservation): Promise<void> {
  const actual = reservation.pendingActualAmount ?? reservation.estimatedAmount;
  const delta = Math.abs(actual - reservation.estimatedAmount);
  if (actual < reservation.estimatedAmount) {
    await refundProjectBudget({
      projectId: reservation.projectId,
      cost: delta,
      operationKey: operationKey(reservation._id, 'settlement-refund'),
    });
  } else if (actual > reservation.estimatedAmount) {
    await chargeProjectBudget({
      projectId: reservation.projectId,
      cost: delta,
      what: 'Video generation reconciliation',
      operationKey: operationKey(reservation._id, 'settlement-charge'),
    });
  }
  await BudgetReservation.updateOne(
    { _id: reservation._id, status: 'settling', pendingActualAmount: actual },
    { $set: { status: 'settled', actualAmount: actual }, $unset: { pendingActualAmount: 1 } }
  );
}

async function applyRefund(reservation: IBudgetReservation): Promise<void> {
  await refundProjectBudget({
    projectId: reservation.projectId,
    cost: reservation.estimatedAmount,
    operationKey: operationKey(reservation._id, 'refund'),
  });
  await BudgetReservation.updateOne(
    { _id: reservation._id, status: 'refunding' },
    { $set: { status: 'refunded', actualAmount: 0 } }
  );
}

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
    if (existing.status === 'pending') return reconcileVideoBudget(existing._id);
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
  let pending: IBudgetReservation;
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
    return reconcileVideoBudget(duplicate._id);
  }
  return reconcileVideoBudget(pending._id);
}

export type IBudgetReservationResult = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  generationTaskId: Types.ObjectId;
  key: string;
  estimatedAmount: number;
  actualAmount: number;
  currency: string;
  status: 'pending' | 'reserved' | 'settling' | 'settled' | 'refunding' | 'refunded' | 'manual_review';
  pendingActualAmount?: number;
};

async function reconcileReservation(reservation: IBudgetReservation): Promise<IBudgetReservation> {
  if (reservation.status === 'pending') {
    const key = operationKey(reservation._id, 'reserve');
    await chargeProjectBudget({
      projectId: reservation.projectId,
      cost: reservation.estimatedAmount,
      what: 'Video generation',
      operationKey: key,
    });
    const reserved = await BudgetReservation.findOneAndUpdate(
      { _id: reservation._id, status: 'pending' },
      { $set: { status: 'reserved' } },
      { new: true }
    );
    if (!reserved) {
      const current = await BudgetReservation.findById(reservation._id);
      if (current?.status === 'reserved') return current;
      throw new ApiError(409, 'Video budget reservation changed unexpectedly.');
    }
    return reserved;
  }
  if (reservation.status === 'settling') {
    await applySettlement(reservation);
    return (await BudgetReservation.findById(reservation._id))!;
  }
  if (reservation.status === 'refunding') {
    await applyRefund(reservation);
    return (await BudgetReservation.findById(reservation._id))!;
  }
  return reservation;
}

export async function reconcileVideoBudget(reservationId: Types.ObjectId): Promise<IBudgetReservation> {
  const reservation = await BudgetReservation.findById(reservationId);
  if (!reservation) throw new ApiError(404, 'Video budget reservation not found.');
  try {
    return await reconcileReservation(reservation);
  } catch (error) {
    await BudgetReservation.updateOne(
      { _id: reservation._id, status: { $in: ['pending', 'settling', 'refunding'] } },
      { $set: { status: 'manual_review' } }
    );
    throw error;
  }
}

export async function recoverVideoBudgetReservations(): Promise<number> {
  const reservations = await BudgetReservation.find({ status: { $in: ['pending', 'settling', 'refunding'] } }).limit(100);
  let recovered = 0;
  for (const reservation of reservations) {
    try {
      await reconcileVideoBudget(reservation._id);
      recovered += 1;
    } catch {
      // The reservation is already marked manual_review by reconcileVideoBudget.
    }
  }
  return recovered;
}

export async function settleVideoBudget(params: {
  reservationId: Types.ObjectId;
  actualAmount: number;
}): Promise<void> {
  if (params.actualAmount < 0) throw new ApiError(400, 'Actual video cost cannot be negative.');
  const claimed = await BudgetReservation.findOneAndUpdate(
    { _id: params.reservationId, status: 'reserved' },
    { $set: { status: 'settling', pendingActualAmount: params.actualAmount } },
    { new: true }
  );
  if (claimed) {
    await reconcileVideoBudget(claimed._id);
    return;
  }
  const existing = await BudgetReservation.findById(params.reservationId);
  if (existing?.status === 'settled' && existing.actualAmount === params.actualAmount) return;
  if (existing?.status === 'settling' && existing.pendingActualAmount === params.actualAmount) {
    await reconcileVideoBudget(existing._id);
    return;
  }
  if (existing?.status === 'settled') return;
  throw new ApiError(409, 'This video budget reservation is not available for settlement.');
}

export async function refundVideoBudget(reservationId: Types.ObjectId): Promise<void> {
  const claimed = await BudgetReservation.findOneAndUpdate(
    { _id: reservationId, status: 'reserved' },
    { $set: { status: 'refunding' } },
    { new: true }
  );
  if (claimed) {
    await reconcileVideoBudget(claimed._id);
    return;
  }
  const existing = await BudgetReservation.findById(reservationId);
  if (existing?.status === 'refunded') return;
  if (existing?.status === 'refunding') {
    await reconcileVideoBudget(reservationId);
    return;
  }
  if (existing?.status === 'settled') return;
  throw new ApiError(409, 'This video budget reservation is not available for refund.');
}
