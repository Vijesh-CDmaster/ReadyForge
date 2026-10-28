import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireWorkspace, requireRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../http';
import { clientIp } from '../audit';
import { config } from '../config';
import { WORKSPACE_ROLES } from '../models/Workspace';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  resendWorkspaceInvitation,
  cancelWorkspaceInvitation,
  inspectInvitation,
  acceptInvitation,
  rejectInvitation,
  serializeInvitation,
  DeliveryOutcome,
} from '../services/invitations';
import {
  initiateOwnershipTransfer,
  cancelOwnershipTransfer,
  acceptOwnershipTransfer,
  describePendingTransfer,
} from '../services/ownership';

export const invitationsRouter = Router();

/** Token endpoints are guess-resistant by construction (256-bit) but still rate limited. */
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invitation requests — try again later.' },
});

const TOKEN_RE = /^[a-f0-9]{64}$/;
const tokenParams = z.object({ token: z.string().regex(TOKEN_RE, 'Invalid invitation token') });

const createSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(WORKSPACE_ROLES).refine((r) => r !== 'owner', 'Owner cannot be invited'),
});

/**
 * Raw invitation tokens are exposed ONLY in development, and only when no
 * email provider accepted the message (the honest link_only fallback).
 * Production responses never carry a usable token.
 */
function exposeToken(token: string, delivery: DeliveryOutcome) {
  if (delivery.mode === 'link_only' && !config.isProd) {
    return {
      inviteUrl: `${config.corsOrigin.split(',')[0].trim()}/invite/${token}`,
      token,
      delivery,
    };
  }
  return { delivery };
}

/* ---------------- workspace-scoped invitation management ---------------- */

invitationsRouter.post(
  '/workspaces/:id/invitations',
  requireAuth,
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(createSchema, req.body);
    const { invitation, token, delivery } = await createWorkspaceInvitation({
      workspace: req.workspace!,
      email: body.email,
      role: body.role,
      inviterId: req.user!._id.toString(),
      ipAddress: clientIp(req),
    });
    res.status(201).json({
      invitation: serializeInvitation(invitation),
      ...exposeToken(token, delivery),
    });
  })
);

invitationsRouter.get(
  '/workspaces/:id/invitations',
  requireAuth,
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const invitations = await listWorkspaceInvitations(req.workspace!._id.toString());
    res.json({ invitations });
  })
);

invitationsRouter.post(
  '/workspaces/:id/invitations/:invId/resend',
  requireAuth,
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { invitation, token, delivery } = await resendWorkspaceInvitation({
      workspace: req.workspace!,
      invitationId: req.params.invId,
      actorId: req.user!._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ invitation: serializeInvitation(invitation), ...exposeToken(token, delivery) });
  })
);

invitationsRouter.delete(
  '/workspaces/:id/invitations/:invId',
  requireAuth,
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const invitation = await cancelWorkspaceInvitation({
      workspace: req.workspace!,
      invitationId: req.params.invId,
      actorId: req.user!._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ invitation: serializeInvitation(invitation) });
  })
);

/* ---------------- ownership transfer ---------------- */

invitationsRouter.get(
  '/workspaces/:id/ownership-transfer',
  requireAuth,
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const pending = await describePendingTransfer(req.workspace!);
    res.json({ pending });
  })
);

const transferSchema = z.object({ targetUserId: z.string().min(24).max(24) });

invitationsRouter.post(
  '/workspaces/:id/ownership-transfer',
  requireAuth,
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(transferSchema, req.body);
    const pending = await initiateOwnershipTransfer({
      workspaceId: req.workspace!._id.toString(),
      actorId: req.user!._id.toString(),
      targetUserId: body.targetUserId,
      ipAddress: clientIp(req),
    });
    res.status(201).json({ pending });
  })
);

invitationsRouter.post(
  '/workspaces/:id/ownership-transfer/accept',
  requireAuth,
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await acceptOwnershipTransfer({
      workspaceId: req.workspace!._id.toString(),
      userId: req.user!._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

invitationsRouter.post(
  '/workspaces/:id/ownership-transfer/cancel',
  requireAuth,
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await cancelOwnershipTransfer({
      workspaceId: req.workspace!._id.toString(),
      actorId: req.user!._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

/* ---------------- recipient-facing token endpoints ---------------- */

/** Public: the landing page for /invite/:token — safe, tokenless payload. */
invitationsRouter.get(
  '/invitations/:token',
  inviteLimiter,
  asyncHandler(async (req, res) => {
    const { token } = validateBody(tokenParams, req.params);
    const details = await inspectInvitation(token);
    res.json({ invitation: details });
  })
);

invitationsRouter.post(
  '/invitations/:token/accept',
  inviteLimiter,
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { token } = validateBody(tokenParams, req.params);
    const result = await acceptInvitation({
      token,
      user: { _id: req.user!._id, email: req.user!.email },
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

invitationsRouter.post(
  '/invitations/:token/reject',
  inviteLimiter,
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { token } = validateBody(tokenParams, req.params);
    await rejectInvitation({
      token,
      user: { _id: req.user!._id, email: req.user!.email },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);
