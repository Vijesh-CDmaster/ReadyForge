import { Router, Response } from 'express';
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

function publicUser(user: Pick<IUser, '_id' | 'name' | 'email' | 'avatarUrl' | 'platformRole' | 'isVerified'>) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    platformRole: user.platformRole,
    isVerified: user.isVerified,
  };
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
    res.status(201).json({ accessToken: signAccessToken(user), user: publicUser(user) });
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
