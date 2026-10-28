import { Router, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User, IUser } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { requireAuth, signAccessToken, signRefreshToken, verifyToken, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { config } from '../config';
import { generateToken, hashToken } from '../crypto';
import { sendEmail } from '../email';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
});

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
});

/**
 * Issues a single-use, 24-hour email-verification token. The raw token exists
 * only in this response (development fallback) — only its hash is persisted,
 * and delivery is never claimed unless a provider accepted the message.
 */
async function issueEmailVerification(user: HydratedDocument<IUser>) {
  const token = generateToken();
  user.emailVerification = { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) };
  await user.save();
  const verifyUrl = `${config.corsOrigin.split(',')[0].trim()}/verify-email?token=${token}`;
  const sent = await sendEmail({
    to: user.email,
    subject: 'Verify your ReadyForge email address',
    text: `Confirm your email to finish setting up ReadyForge: ${verifyUrl}`,
  });
  audit({
    actorId: user._id.toString(),
    action: 'user.email_verification_issued',
    entityType: 'user',
    entityId: user._id.toString(),
    metadata: { delivered: sent.delivered },
  });
  if (sent.delivered) return { delivered: true, mode: 'email' as const };
  return {
    delivered: false,
    mode: 'link_only' as const,
    note: 'No email provider configured — verify from this link instead of an email.',
    // Never expose the token in production; development-only fallback.
    ...(config.isProd ? {} : { verifyUrl }),
  };
}

const REFRESH_COOKIE = 'rf_refresh';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/api/auth',
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

function publicUser(user: Pick<IUser, '_id' | 'name' | 'email' | 'avatarUrl' | 'platformRole' | 'isVerified' | 'language' | 'timezone'>) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    platformRole: user.platformRole,
    isVerified: user.isVerified,
    language: user.language || 'en',
    timezone: user.timezone || 'UTC',
  };
}

/** Real IANA timezones throw only when invalid — no allow-list to maintain. */
function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(registerSchema, req.body);
    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) throw new ApiError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await User.create({ name: body.name, email: body.email, passwordHash, isVerified: false });

    audit({
      actorId: user._id.toString(),
      action: 'user.register',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
      metadata: { email: user.email },
    });

    setRefreshCookie(res, signRefreshToken(user));
    const verification = await issueEmailVerification(user);
    res.status(201).json({ accessToken: signAccessToken(user), user: publicUser(user), verification });
  })
);

const verifySchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid verification token') });

/** Single-use: the token is cleared the moment it succeeds. */
authRouter.post(
  '/verify-email',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = validateBody(verifySchema, req.body);
    const user = await User.findOne({ 'emailVerification.tokenHash': hashToken(body.token) });
    if (!user || !user.emailVerification) {
      throw new ApiError(400, 'Verification link is invalid or has already been used');
    }
    if (user.emailVerification.expiresAt.getTime() <= Date.now()) {
      user.emailVerification = null;
      await user.save();
      throw new ApiError(410, 'Verification link expired — request a new one');
    }
    user.isVerified = true;
    user.emailVerification = null;
    await user.save();
    audit({
      actorId: user._id.toString(),
      action: 'user.email_verified',
      entityType: 'user',
      entityId: user._id.toString(),
    });
    res.json({ ok: true, user: publicUser(user) });
  })
);

authRouter.post(
  '/resend-verification',
  requireAuth,
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.isVerified) return res.json({ ok: true, alreadyVerified: true });
    const verification = await issueEmailVerification(user);
    res.json({ verification });
  })
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(credentialsSchema, req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user) throw new ApiError(401, 'Invalid email or password');

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Invalid email or password');

    audit({
      actorId: user._id.toString(),
      action: 'user.login',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
    });

    setRefreshCookie(res, signRefreshToken(user));
    res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
  })
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!token) throw new ApiError(401, 'No refresh token');
    const { sub } = verifyToken(token, 'refresh');
    const user = await User.findById(sub);
    if (!user) throw new ApiError(401, 'User no longer exists');

    // rotate refresh token
    setRefreshCookie(res, signRefreshToken(user));
    res.json({ accessToken: signAccessToken(user) });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  })
);

/* ---------------- profile & account security (spec §1.1 / §1.2) ---------------- */

const notifPrefSchema = z
  .object({
    approvalRequired: z.boolean().optional(),
    generationComplete: z.boolean().optional(),
    conflictAssigned: z.boolean().optional(),
    budgetWarning: z.boolean().optional(),
    mentions: z.boolean().optional(),
  })
  .strict();

const profileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().max(200).optional(),
  notificationPrefs: notifPrefSchema.optional(),
  language: z.string().min(2).max(16).optional(),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimezone, 'Unknown timezone — use an IANA name like Asia/Kolkata')
    .optional(),
});

authRouter.patch(
  '/me',
  requireAuth,
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(profileSchema, req.body);
    const user = req.user!;

    if (body.email && body.email.toLowerCase() !== user.email) {
      const taken = await User.findOne({ email: body.email.toLowerCase() });
      if (taken) throw new ApiError(409, 'That email is already in use');
      user.email = body.email.toLowerCase();
      user.isVerified = false; // a changed address must re-verify once email delivery exists
    }
    if (body.name) user.name = body.name;
    if (body.language) user.language = body.language;
    if (body.timezone) user.timezone = body.timezone;
    if (body.notificationPrefs) user.notificationPrefs = { ...user.notificationPrefs, ...body.notificationPrefs };
    await user.save();

    audit({
      actorId: user._id.toString(),
      action: 'user.profile_update',
      entityType: 'user',
      entityId: user._id.toString(),
      before: { name: undefined, email: undefined },
      after: { name: user.name, email: user.email, notificationPrefs: user.notificationPrefs },
      ipAddress: clientIp(req),
    });
    res.json({ user: publicUser(user), notificationPrefs: user.notificationPrefs });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
});

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(changePasswordSchema, req.body);
    const user = req.user!;
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Current password is incorrect');
    user.passwordHash = await bcrypt.hash(body.newPassword, 10);
    await user.save();
    audit({
      actorId: user._id.toString(),
      action: 'user.change_password',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

authRouter.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = validateBody(z.object({ email: z.string().email().max(200) }), req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() });
    // Always answer 200 so the endpoint cannot be used to enumerate accounts.
    if (!user) return res.json({ ok: true, delivered: false });

    const token = generateToken();
    user.passwordReset = { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) };
    await user.save();

    const resetUrl = `${config.corsOrigin.split(',')[0].trim()}/reset-password?token=${token}`;
    audit({
      actorId: user._id.toString(),
      action: 'user.forgot_password',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
    });
    // No email provider is configured yet — surface the link honestly in-app
    // instead of pretending an email was sent.
    res.json({ ok: true, delivered: false, resetUrl, note: 'No email provider is configured — this reset link is returned to the caller instead of being emailed.' });
  })
);

authRouter.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = validateBody(
      z.object({ token: z.string().min(16).max(128), newPassword: z.string().min(8).max(200) }),
      req.body
    );
    const user = await User.findOne({ 'passwordReset.tokenHash': hashToken(body.token) });
    if (!user || !user.passwordReset || user.passwordReset.expiresAt < new Date()) {
      throw new ApiError(400, 'Reset link is invalid or expired — request a new one.');
    }
    user.passwordHash = await bcrypt.hash(body.newPassword, 10);
    user.passwordReset = null;
    await user.save();
    audit({
      actorId: user._id.toString(),
      action: 'user.reset_password',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

authRouter.delete(
  '/me',
  requireAuth,
  authLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ password: z.string().min(1).max(200) }), req.body);
    const user = req.user!;
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Password is incorrect');

    // Owned workspaces must be handed over or deleted first — deleting an owner
    // would strand their team's data.
    const owned = await Workspace.countDocuments({ ownerId: user._id });
    if (owned > 0) {
      throw new ApiError(409, `You own ${owned} workspace(s). Delete or transfer them before deleting your account.`);
    }

    // Remove memberships everywhere; the account itself is deleted.
    await Workspace.updateMany(
      { 'members.userId': user._id },
      { $pull: { members: { userId: user._id } } }
    );
    await User.deleteOne({ _id: user._id });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    audit({
      actorId: user._id.toString(),
      action: 'user.delete_account',
      entityType: 'user',
      entityId: user._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

authRouter.get(
  '/export',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const { KnowledgeInput } = await import('../models/KnowledgeInput');
    const { Review } = await import('../models/Review');
    const { Notification: NotificationModel } = await import('../models/Notification');

    const [inputs, reviews, notifications, memberships] = await Promise.all([
      KnowledgeInput.find({ createdById: user._id }).select('-__v').lean(),
      Review.find({ reviewerId: user._id }).select('-__v').lean(),
      NotificationModel.find({ userId: user._id }).select('-__v').lean(),
      Workspace.find({ 'members.userId': user._id }).select('name members.$').lean(),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      disclaimer: 'Personal data export — contains only records attributed to this account.',
      profile: { ...publicUser(user), createdAt: user.createdAt },
      workspaces: memberships.map((w) => ({ name: w.name, membership: w.members?.[0] })),
      authoredInputs: inputs,
      reviews,
      notifications,
    });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const workspaces = await Workspace.find({ 'members.userId': user._id, 'members.status': 'active' }).select(
      'name description settings ownerId members.userId members.role members.status'
    );
    const projectCount = await Project.countDocuments({ workspaceId: { $in: workspaces.map((w) => w._id) } });
    res.json({
      user: publicUser(user),
      notificationPrefs: user.notificationPrefs,
      workspaces: workspaces.map((w) => ({
        id: w._id.toString(),
        name: w.name,
        description: w.description,
        role: w.members.find((m) => m.userId.toString() === user._id.toString() && m.status === 'active')?.role,
        settings: w.settings,
        ownerId: w.ownerId.toString(),
      })),
      projectCount,
    });
  })
);
