import { Schema, model, Types } from 'mongoose';

export const INPUT_TYPES = [
  'fact',
  'claim',
  'constraint',
  'audience',
  'tone',
  'price',
  'asset_requirement',
  'goal',
  'visual_rule',
  'legal_rule',
  'other',
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const SOURCE_TYPES = ['user_input', 'uploaded_document', 'url', 'approved_library', 'ai_extracted'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface IKnowledgeInput {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  createdById: Types.ObjectId;
  type: InputType;
  title: string;
  content: string;
  sourceType: SourceType;
  sourceReference?: string;
  fileId?: Types.ObjectId;
  status: 'draft' | 'approved' | 'disputed' | 'rejected' | 'expired';
  confidence: number;
  tags: string[];
  version: number;
  approvedById?: Types.ObjectId;
  approvedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeInputSchema = new Schema<IKnowledgeInput>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: INPUT_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, maxlength: 8000 },
    sourceType: { type: String, enum: SOURCE_TYPES, default: 'user_input' },
    sourceReference: { type: String, maxlength: 1000 },
    fileId: { type: Schema.Types.ObjectId, ref: 'File' },
    status: {
      type: String,
      enum: ['draft', 'approved', 'disputed', 'rejected', 'expired'],
      default: 'draft',
      index: true,
    },
    confidence: { type: Number, default: 0.5, min: 0, max: 1 },
    tags: { type: [String], default: [] },
    version: { type: Number, default: 1 },
    approvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

export const KnowledgeInput = model<IKnowledgeInput>('KnowledgeInput', knowledgeInputSchema);
