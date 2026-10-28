import type { Types } from 'mongoose';
import { Project } from '../models/Project';
import { ApiError } from '../http';

/**
 * Atomically charges `cost` against a project's budget.
 *
 * The hard limit (`spent + cost <= budget.amount`) is evaluated by MongoDB inside a
 * single conditional update, so concurrent requests cannot both pass a read-then-write
 * check and overspend: each update is applied only if it still fits the limit when the
 * database processes it. Projects with no budget configured (`amount = 0`) keep the
 * historical behaviour — the charge is applied and `remaining` is clamped at zero
 * (the generation ladder already blocks those projects separately).
 *
 * `remaining` is always recomputed as `amount - spent`, which self-heals any drift
 * caused by an earlier budget edit.
 *
 * @throws ApiError(402) when the charge would exceed the hard limit,
 *         ApiError(404) when the project does not exist.
 */
export async function chargeProjectBudget(params: {
  projectId: Types.ObjectId | string;
  cost: number;
  /** Short human description of what is being charged, used in the 402 message. */
  what: string;
}): Promise<void> {
  const { projectId, cost, what } = params;
  if (cost <= 0) return;

  const charged = await Project.findOneAndUpdate(
    {
      _id: projectId,
      $or: [
        { 'budget.amount': 0 },
        { $expr: { $lte: [{ $add: ['$budget.spent', cost] }, '$budget.amount'] } },
      ],
    },
    [
      {
        $set: {
          'budget.spent': { $add: ['$budget.spent', cost] },
          'budget.remaining': {
            $cond: [
              { $gt: ['$budget.amount', 0] },
              {
                $max: [
                  0,
                  { $subtract: ['$budget.amount', { $add: ['$budget.spent', cost] }] },
                ],
              },
              { $max: [0, { $subtract: ['$budget.remaining', cost] }] },
            ],
          },
          updatedAt: new Date(),
        },
      },
    ],
    { new: true }
  );

  if (charged) return;

  const fresh = await Project.findById(projectId).select('budget').lean();
  if (!fresh) throw new ApiError(404, 'Project not found.');
  throw new ApiError(
    402,
    `${what} would exceed the project budget: ${cost} ${fresh.budget.currency} requested, ` +
      `${fresh.budget.remaining} ${fresh.budget.currency} remaining — finance approval required.`
  );
}

/**
 * Refunds a previous charge. Used when a generation run fails after the budget was
 * reserved, so a failed run never consumes budget. The `$expr` guard prevents the
 * counter from going negative if the refund races with another write.
 */
export async function refundProjectBudget(params: {
  projectId: Types.ObjectId | string;
  cost: number;
}): Promise<void> {
  const { projectId, cost } = params;
  if (cost <= 0) return;

  await Project.updateOne(
    { _id: projectId, $expr: { $gte: ['$budget.spent', cost] } },
    [
      {
        $set: {
          'budget.spent': { $subtract: ['$budget.spent', cost] },
          'budget.remaining': {
            $cond: [
              { $gt: ['$budget.amount', 0] },
              {
                $max: [
                  0,
                  { $subtract: ['$budget.amount', { $subtract: ['$budget.spent', cost] }] },
                ],
              },
              { $max: [0, { $add: ['$budget.remaining', cost] }] },
            ],
          },
          updatedAt: new Date(),
        },
      },
    ]
  );
}
