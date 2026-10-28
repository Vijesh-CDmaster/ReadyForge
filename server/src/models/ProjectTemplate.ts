import { Schema, model, Types } from 'mongoose';
import { PROJECT_TYPES } from './Project';

export interface ITemplateBrief {
  objective: string;
  audience: string;
  tone: string;
  callToAction: string;
  /** Days from creation — templates are reusable, so absolute dates don't fit. */
  deadlineDays?: number;
  budgetAmount?: number;
  currency?: string;
  tags: string[];
}

export interface IProjectTemplate {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description?: string;
  projectType: string;
  mode: string;
  brief: ITemplateBrief;
  /** Set when the template was saved from an existing project. */
  sourceProjectId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const briefSchema = new Schema<ITemplateBrief>(
  {
    objective: { type: String, default: '', maxlength: 2000 },
    audience: { type: String, default: '', maxlength: 1000 },
    tone: { type: String, default: '', maxlength: 300 },
    callToAction: { type: String, default: '', maxlength: 300 },
    deadlineDays: { type: Number, min: 1, max: 3650 },
    budgetAmount: { type: Number, min: 0 },
    currency: { type: String, maxlength: 3 },
    tags: { type: [String], default: [] },
  },
  { _id: false }
);

const projectTemplateSchema = new Schema<IProjectTemplate>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    description: { type: String, maxlength: 500 },
    projectType: { type: String, enum: PROJECT_TYPES, required: true },
    mode: { type: String, enum: ['solo', 'team'], default: 'solo' },
    brief: { type: briefSchema, required: true },
    sourceProjectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true }
);

export const ProjectTemplate = model<IProjectTemplate>('ProjectTemplate', projectTemplateSchema);