import { Schema, model, Types } from 'mongoose';

export const REVIEW_DECISIONS = ['approved', 'rejected', 'changes_requested'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface IReview {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  contractId?: Types.ObjectId;
  generationTaskId?: Types.ObjectId;
  reviewerId: Types.ObjectId;
  decision: ReviewDecision;
  comment: string;
  /** Regeneration autopsy: which input/check caused the failure. */
  rootCause?: string;
  /** What the author changed in response. */
  resolution?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'ProductionContract' },
    generationTaskId: { type: Schema.Types.ObjectId, ref: 'GenerationTask' },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: REVIEW_DECISIONS, required: true },
    comment: { type: String, default: '' },
    rootCause: { type: String },
    resolution: { type: String },
  },
  { timestamps: true }
);

export const Review = model<IReview>('Review', reviewSchema);