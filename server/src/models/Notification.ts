import { Schema, model, Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'conflict_assigned',
  'approval_required',
  'generation_complete',
  'verification_failed',
  'budget_warning',
  'member_invited',
  'contract_approved',
  'contract_rejected',
  'project_assigned',
  'question_assigned',
  'mention',
] as const;

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'approval_required' },
    title: { type: String, required: true, maxlength: 300 },
    message: { type: String, default: '', maxlength: 1000 },
    isRead: { type: Boolean, default: false },
    link: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Notification = model<INotification>('Notification', notificationSchema);
