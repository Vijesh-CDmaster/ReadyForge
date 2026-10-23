import { Schema, model, Types } from 'mongoose';

export const LICENSE_STATUSES = ['owned', 'licensed', 'unknown', 'restricted', 'expired'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface IAsset {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  uploadedById: Types.ObjectId;
  name: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'logo' | 'document' | 'other';
  fileUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeBytes: number;
  licenseStatus: LicenseStatus;
  licenseType?: string;
  licenseOwner?: string;
  licenseExpiry?: Date;
  allowedChannels: string[];
  allowedRegions: string[];
  consentRequired: boolean;
  consentStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  aiGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<IAsset>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 300 },
    type: {
      type: String,
      enum: ['image', 'video', 'audio', 'font', 'logo', 'document', 'other'],
      default: 'other',
    },
    fileUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    mimeType: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    licenseStatus: { type: String, enum: LICENSE_STATUSES, default: 'unknown', index: true },
    licenseType: { type: String, maxlength: 300 },
    licenseOwner: { type: String, maxlength: 300 },
    licenseExpiry: { type: Date },
    allowedChannels: { type: [String], default: [] },
    allowedRegions: { type: [String], default: [] },
    consentRequired: { type: Boolean, default: false },
    consentStatus: {
      type: String,
      enum: ['not_required', 'pending', 'approved', 'rejected'],
      default: 'not_required',
    },
    aiGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Asset = model<IAsset>('Asset', assetSchema);
