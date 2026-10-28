import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';
import { User } from '../models/User';
import { signAccessToken, signRefreshToken, verifyToken, requireAuth, requireRole } from '../middleware/auth';
import { ApiError } from '../http';
import { hashToken, generateToken } from '../crypto';

const call = (mw: (req: unknown, res: unknown, next: NextFunction) => unknown, req: Partial<Request>) =>
  new Promise<{ err?: unknown; req: Record<string, unknown> }>((resolve) => {
    const r = req as Record<string, unknown>;
    mw(r, {} as Response, (err?: unknown) => resolve({ err, req: r }));
  });

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('password hashing', () => {
  it('never stores the plaintext and verifies correctly', async () => {
    const plain = 'Str0ngPass!x';
    const user = await User.create({
      name: 'Hash Test',
      email: 'hash@example.com',
      passwordHash: await bcrypt.hash(plain, 10),
    });
    expect(user.passwordHash).not.toContain(plain);
    expect(await bcrypt.compare(plain, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', user.passwordHash)).toBe(false);
  });
});

describe('token lifecycle', () => {
  it('access and refresh tokens round-trip and reject kind confusion', async () => {
    const user = await User.create({
      name: 'Token Test',
      email: 'token@example.com',
      passwordHash: await bcrypt.hash('Str0ngPass!x', 10),
    });
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    expect(verifyToken(access, 'access').sub).toBe(user._id.toString());
    expect(verifyToken(refresh, 'refresh').sub).toBe(user._id.toString());
    // A refresh token must not be usable as an access token (and vice versa).
    expect(() => verifyToken(refresh, 'access')).toThrow(ApiError);
    expect(() => verifyToken('not-a-token', 'access')).toThrow(ApiError);
    expect(() => verifyToken(access, 'refresh')).toThrow(ApiError);
  });

  it('token hashing is deterministic and one-way', () => {
    const t = generateToken();
    expect(t).toHaveLength(64);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
    expect(hashToken(t + 'x')).not.toBe(hashToken(t));
  });
});

describe('protected routes', () => {
  it('rejects missing and malformed bearer tokens with 401', async () => {
    const noHeader = await call(requireAuth as never, { headers: {} });
    expect((noHeader.err as ApiError).status).toBe(401);

    const badHeader = await call(requireAuth as never, { headers: { authorization: 'Bearer garbage' } });
    expect((badHeader.err as ApiError).status).toBe(401);
  });

  it('attaches the user for a valid access token', async () => {
    const user = await User.create({
      name: 'Authed',
      email: 'authed@example.com',
      passwordHash: await bcrypt.hash('Str0ngPass!x', 10),
    });
    const { err, req } = await call(requireAuth as never, {
      headers: { authorization: `Bearer ${signAccessToken(user)}` },
    });
    expect(err).toBeUndefined();
    expect((req.user as { email: string }).email).toBe('authed@example.com');
  });

  it('rejects tokens for deleted users', async () => {
    const user = await User.create({
      name: 'Ghost',
      email: 'ghost@example.com',
      passwordHash: await bcrypt.hash('Str0ngPass!x', 10),
    });
    const token = signAccessToken(user);
    await user.deleteOne();
    const { err } = await call(requireAuth as never, { headers: { authorization: `Bearer ${token}` } });
    expect((err as ApiError).status).toBe(401);
  });
});

describe('role checks', () => {
  const reqWithRole = (role?: string) => ({ membershipRole: role }) as unknown as Request;

  it('owner bypasses role restrictions', async () => {
    const { err } = await call(requireRole('viewer') as never, reqWithRole('owner'));
    expect(err).toBeUndefined();
  });

  it('allows listed roles and denies others', async () => {
    const allowed = await call(requireRole('lead') as never, reqWithRole('lead'));
    expect(allowed.err).toBeUndefined();

    const denied = await call(requireRole('lead') as never, reqWithRole('viewer'));
    expect((denied.err as ApiError).status).toBe(403);
  });

  it('denies users with no membership', async () => {
    const { err } = await call(requireRole('lead') as never, reqWithRole(undefined));
    expect((err as ApiError).status).toBe(403);
  });
});