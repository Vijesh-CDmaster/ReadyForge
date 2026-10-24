import { Schema, model, Types } from 'mongoose';

export interface IAiUsageLog {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  userId?: Types.ObjectId;
  provider: string;
  model: string;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  currency: string;
  status: 'success' | 'failed';
  latencyMs: number;
  createdAt: Date;
  updatedAt: Date;
}

const aiUsageLogSchema = new Schema<IAiUsageLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    provider: { type: String, default: 'local' },
    model: { type: String, required: true },
    taskType: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    latencyMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const AiUsageLog = model<IAiUsageLog>('AiUsageLog', aiUsageLogSchema);