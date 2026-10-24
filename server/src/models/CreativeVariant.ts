import { Schema, model, Types } from 'mongoose';

export interface ICreativeVariant {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  createdById: Types.ObjectId;
  name: string; // "Variant A"
  hook: string;
  tone: string;
  audience: string;
  cta: string;
  format: string;
  durationSeconds: number;
  script: string;
  status: 'draft' | 'approved' | 'rejected';
  estimatedCost: number;
  actualCost: number;
  modelName: string;
  reviewComment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const creativeVariantSchema = new Schema<ICreativeVariant>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 80 },
    hook: { type: String, default: '', maxlength: 400 },
    tone: { type: String, default: '', maxlength: 200 },
    audience: { type: String, default: '', maxlength: 400 },
    cta: { type: String, default: '', maxlength: 300 },
    format: { type: String, default: '', maxlength: 120 },
    durationSeconds: { type: Number, default: 0 },
    script: { type: String, default: '', maxlength: 40000 },
    status: { type: String, enum: ['draft', 'approved', 'rejected'], default: 'draft' },
    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    modelName: { type: String, default: 'readyforge-rules' },
    reviewComment: { type: String, maxlength: 2000 },
  },
  { timestamps: true }
);

export const CreativeVariant = model<ICreativeVariant>('CreativeVariant', creativeVariantSchema);