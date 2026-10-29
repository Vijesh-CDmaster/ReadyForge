import { Schema, model, Types } from 'mongoose';

export const RESERVATION_STATUSES = ['pending', 'reserved', 'settled', 'refunded', 'manual_review'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface IBudgetReservation {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  generationTaskId: Types.ObjectId;
  key: string;
  estimatedAmount: number;
  actualAmount: number;
  currency: string;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IBudgetReservation>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    generationTaskId: { type: Schema.Types.ObjectId, ref: 'GenerationTask', required: true, unique: true },
    key: { type: String, required: true, unique: true },
    estimatedAmount: { type: Number, required: true, min: 0 },
    actualAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: RESERVATION_STATUSES, required: true, index: true },
  },
  { timestamps: true }
);

export const BudgetReservation = model<IBudgetReservation>('BudgetReservation', schema);
