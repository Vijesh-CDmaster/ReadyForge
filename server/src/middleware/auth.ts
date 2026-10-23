import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HydratedDocument } from 'mongoose';
import { config } from '../config';
import { ApiError } from '../http';
import { User, IUser } from '../models/User';
import { Workspace, WorkspaceRole, IWorkspace } from '../models/Workspace';
import { Project, IProject } from '../models/Project';

export interface AuthedRequest extends Request {
  user?: HydratedDocument<IUser>;
  workspace?: HydratedDocument<IWorkspace>;
  membershipRole?: WorkspaceRole;
  project?: HydratedDocument<IProject>;
}

export function signAccessToken(user: Pick<IUser, '_id' | 'email'>): string {
  return jwt.sign({ sub: user._id.toString(), email: user.email, type: 'access' }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(user: Pick<IUser, '_id'>): string {
  return jwt.sign({ sub: user._id.toString(), type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: `${config.jwt.refreshTtlDays}d`,
  });
}

export function verifyToken(token: string, kind: 'access' | 'refresh'): { sub: string } {
  try {
    const payload = jwt.verify(token, kind === 'access' ? config.jwt.accessSecret : config.jwt.refreshSecret) as {
      sub: string;
      type: string;
    };
    if (payload.type !== kind) throw new Error('wrong token type');
    return { sub: payload.sub };
  } catch {
    throw new ApiError(401, kind === 'access' ? 'Invalid or expired access token' : 'Invalid or expired refresh token');
  }
}

/** Requires a valid Bearer access token and attaches req.user. */
export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ApiError(401, 'Authentication required');
    const { sub } = verifyToken(token, 'access');
    const user = await User.findById(sub);
    if (!user) throw new ApiError(401, 'User no longer exists');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Reads :id (workspace id), verifies active membership, attaches workspace + role. */
export function requireWorkspace() {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, 'Authentication required');
      const workspace = await Workspace.findById(req.params.id);
      if (!workspace) throw new ApiError(404, 'Workspace not found');
      const membership = workspace.members.find(
        (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
      );
      if (!membership && req.user.platformRole !== 'admin') {
        throw new ApiError(403, 'You are not a member of this workspace');
      }
      req.workspace = workspace;
      req.membershipRole = membership?.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** After requireWorkspace: restrict to specific workspace roles (owner always allowed). */
export function requireRole(...roles: WorkspaceRole[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const role = req.membershipRole;
    if (!role) return next(new ApiError(403, 'Workspace membership required'));
    if (role === 'owner' || roles.includes(role)) return next();
    next(new ApiError(403, `Requires one of roles: ${roles.join(', ')}`));
  };
}

/**
 * Reads :id (project id), verifies the user's workspace membership, attaches project.
 * Optionally restricts to workspace roles (owner always allowed).
 */
export function requireProject(...roles: WorkspaceRole[]) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, 'Authentication required');
      const project = await Project.findById(req.params.id);
      if (!project) throw new ApiError(404, 'Project not found');
      const workspace = await Workspace.findById(project.workspaceId);
      if (!workspace) throw new ApiError(404, 'Workspace not found');
      const membership = workspace.members.find(
        (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
      );
      if (!membership && req.user.platformRole !== 'admin') {
        throw new ApiError(403, 'You are not a member of this project workspace');
      }
      const role = membership?.role;
      if (roles.length > 0 && role !== 'owner' && !(role && roles.includes(role))) {
        throw new ApiError(403, `Requires one of roles: ${roles.join(', ')}`);
      }
      req.project = project;
      req.workspace = workspace;
      req.membershipRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
