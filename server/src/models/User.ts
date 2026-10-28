import { Schema, model, Types } from 'mongoose';

export interface INotificationPrefs {
  approvalRequired: boolean;
  generationComplete: boolean;
  conflictAssigned: boolean;
  budgetWarning: boolean;
  mentions: boolean;
}

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
  platformRole: 'user' | 'admin';
  isVerified: boolean;
  /** BCP-47-ish language tag; 'en' until real translations ship. */
  language: string;
  /** IANA timezone (e.g. Asia/Kolkata) used for regional date display. */
  timezone: string;
  /** Hashed single-use email-verification token; null once used/expired. */
  emailVerification?: { tokenHash: string; expiresAt: Date } | null;
  notificationPrefs: INotificationPrefs;
  /** Hashed one-time token for password reset; null once used or expired. */
  passwordReset?: { tokenHash: string; expiresAt: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    avatarUrl: { type: String },
    platformRole: { type: String, enum: ['user', 'admin'], default: 'user' },
    isVerified: { type: Boolean, default: false },
    language: { type: String, default: 'en', maxlength: 16 },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    emailVerification: {
      type: { tokenHash: String, expiresAt: Date },
      default: null,
    },
    notificationPrefs: {
      approvalRequired: { type: Boolean, default: true },
      generationComplete: { type: Boolean, default: true },
      conflictAssigned: { type: Boolean, default: true },
      budgetWarning: { type: Boolean, default: true },
      mentions: { type: Boolean, default: true },
    },
    passwordReset: {
      type: { tokenHash: String, expiresAt: Date },
      default: null,
    },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', userSchema);

const TYPE_TO_PREF: Record<string, keyof INotificationPrefs> = {
  approval_required: 'approvalRequired',
  generation_complete: 'generationComplete',
  conflict_assigned: 'conflictAssigned',
  budget_warning: 'budgetWarning',
  mention: 'mentions',
};

/**
 * Server-side respect for notification preferences (spec §22.1).
 * Unknown event types default to "on" so new features are never silently muted.
 */
export function wantsNotification(
  user: Pick<IUser, 'notificationPrefs'> | undefined | null,
  type: string
): boolean {
  const prefs = user?.notificationPrefs;
  if (!prefs) return true;
  const key = TYPE_TO_PREF[type];
  if (!key) return true;
  return prefs[key] !== false;
}
