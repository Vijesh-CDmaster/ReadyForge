import { Schema, model, Types } from 'mongoose';

export const CHECK_TYPES = [
  'claim_verification',
  'brand_fit',
  'intent_alignment',
  'scene_completeness',
  'accessibility',
  'rights',
  'budget',
  'tone',
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export const CHECK_STATUSES = ['passed', 'warning', 'failed'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface IVerificationCheck {
  checkType: CheckType;
  status: CheckStatus;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  evidence: string;
  sourceInputId?: Types.ObjectId;
  suggestedFix?: string;
}

export interface IVerificationReport {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  contractId?: Types.ObjectId;
  generationTaskId?: Types.ObjectId;
  status: 'passed' | 'warning' | 'failed';
  overallScore: number;
  summary: string;
  checks: IVerificationCheck[];
  createdAt: Date;
  updatedAt: Date;
}

const verificationReportSchema = new Schema<IVerificationReport>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'ProductionContract' },
    generationTaskId: { type: Schema.Types.ObjectId, ref: 'GenerationTask' },
    status: { type: String, enum: CHECK_STATUSES, default: 'warning', index: true },
    overallScore: { type: Number, default: 0, min: 0, max: 100 },
    summary: { type: String, default: '' },
    checks: [
      {
        checkType: { type: String, enum: CHECK_TYPES, required: true },
        status: { type: String, enum: CHECK_STATUSES, required: true },
        severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        message: { type: String, default: '' },
        evidence: { type: String, default: '' },
        sourceInputId: { type: Schema.Types.ObjectId, ref: 'KnowledgeInput' },
        suggestedFix: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export const VerificationReport = model<IVerificationReport>('VerificationReport', verificationReportSchema);