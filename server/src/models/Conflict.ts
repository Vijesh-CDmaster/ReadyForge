import { Schema, model, Types } from 'mongoose';

export const CONFLICT_TYPES = [
  'factual',
  'pricing',
  'audience',
  'tone',
  'rights',
  'brand',
  'budget',
  'goal',
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export interface IConflict {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'awaiting_decision' | 'resolved' | 'dismissed';
  inputAId?: Types.ObjectId;
  inputBId?: Types.ObjectId;
  conflictType: ConflictType;
  detectedBy: 'user' | 'ai' | 'system';
  assignedToId?: Types.ObjectId;
  recommendedAction?: string;
  impactIfUnresolved?: string;
  resolution?: string;
  resolvedById?: Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const conflictSchema = new Schema<IConflict>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    title: { type: String, required: true, maxlength: 300 },
    description: { type: String, required: true, maxlength: 4000 },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'awaiting_decision', 'resolved', 'dismissed'],
      default: 'open',
      index: true,
    },
    inputAId: { type: Schema.Types.ObjectId, ref: 'KnowledgeInput' },
    inputBId: { type: Schema.Types.ObjectId, ref: 'KnowledgeInput' },
    conflictType: { type: String, enum: CONFLICT_TYPES, required: true },
    detectedBy: { type: String, enum: ['user', 'ai', 'system'], default: 'ai' },
    assignedToId: { type: Schema.Types.ObjectId, ref: 'User' },
    recommendedAction: { type: String, maxlength: 2000 },
    impactIfUnresolved: { type: String, maxlength: 2000 },
    resolution: { type: String, maxlength: 4000 },
    resolvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

export const Conflict = model<IConflict>('Conflict', conflictSchema);
