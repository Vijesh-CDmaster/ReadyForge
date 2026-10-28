import { Router } from 'express';
import { z } from 'zod';
import { Workspace, WORKSPACE_ROLES, WorkspaceRole } from '../models/Workspace';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { ProjectMember } from '../models/ProjectMember';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Conflict } from '../models/Conflict';
import { Asset } from '../models/Asset';
import { AuditLog } from '../models/AuditLog';
import { requireAuth, requireWorkspace, requireRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  currency: z.string().length(3).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  settings: z
    .object({
      defaultCurrency: z.string().length(3).optional(),
      aiProviders: z.array(z.string()).optional(),
      budgetApprovalThreshold: z.number().min(0).optional(),
    })
    .optional(),
  brandDna: z
    .object({
      brandName: z.string().max(200).optional(),
      tone: z.string().max(400).optional(),
      bannedWords: z.array(z.string().max(80)).max(60).optional(),
      colourPalette: z.array(z.string().max(40)).max(20).optional(),
      logoRules: z.string().max(1000).optional(),
      targetAudience: z.string().max(1000).optional(),
      legalRestrictions: z.array(z.string().max(300)).max(30).optional(),
    })
    .optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES).refine((r) => r !== 'owner', 'Owner role cannot be assigned'),
});

const memberRoleSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });

const roleParams = (role?: WorkspaceRole) => (role ? [role] : []);

function serializeMember(m: { userId: unknown; role: string; status: string; joinedAt?: Date }, users?: Map<string, { name: string; email: string; avatarUrl?: string }>) {
  const id = String(m.userId);
  const u = users?.get(id);
  return {
    id,
    userId: id,
    name: u?.name || 'Unknown user',
    email: u?.email || '',
    avatarUrl: u?.avatarUrl || '',
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt,
  };
}

async function loadUsers(ids: unknown[]) {
  const list = await User.find({ _id: { $in: ids } }).select('name email avatarUrl');
  return new Map(list.map((u) => [u._id.toString(), { name: u.name, email: u.email, avatarUrl: u.avatarUrl }]));
}

/* ---------- create ---------- */
workspacesRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(createSchema, req.body);
    const user = req.user!;
    const workspace = await Workspace.create({
      name: body.name,
      description: body.description,
      ownerId: user._id,
      members: [{ userId: user._id, role: 'owner', status: 'active', joinedAt: new Date() }],
      settings: {
        defaultCurrency: body.currency || 'INR',
        aiProviders: ['openai-compatible'],
        budgetApprovalThreshold: 1000,
      },
    });
    audit({
      workspaceId: workspace._id.toString(),
      actorId: user._id.toString(),
      action: 'workspace.create',
      entityType: 'workspace',
      entityId: workspace._id.toString(),
      after: { name: workspace.name },
      ipAddress: clientIp(req),
    });
    // Serialized like GET /:id — clients navigate with `id`, not `_id`.
    const users = await loadUsers(workspace.members.map((m) => m.userId));
    res.status(201).json({
      workspace: {
        id: workspace._id.toString(),
        name: workspace.name,
        description: workspace.description,
        ownerId: workspace.ownerId.toString(),
        settings: workspace.settings,
        brandDna: workspace.brandDna ?? null,
        archivedAt: workspace.archivedAt ?? null,
        role: 'owner',
        createdAt: workspace.createdAt,
        members: workspace.members.map((m) => serializeMember(m, users)),
        projects: [],
      },
    });
  })
);

/* ---------- list ---------- */
workspacesRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const includeArchived = req.query.includeArchived === '1';
    const workspaces = await Workspace.find({
      'members.userId': user._id,
      'members.status': 'active',
      // Archived workspaces stay recoverable but hidden from the normal list.
      ...(includeArchived ? {} : { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] }),
    }).sort('-updatedAt');
    const projectCounts = await Project.aggregate([
      { $match: { workspaceId: { $in: workspaces.map((w) => w._id) } } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]);
    const counts = new Map(projectCounts.map((c) => [c._id.toString(), c.count]));
    res.json(
      workspaces.map((w) => {
        const membership = w.members.find((m) => m.userId.toString() === user._id.toString());
        return {
          id: w._id.toString(),
          name: w.name,
          description: w.description,
          role: membership?.role,
          memberCount: w.members.filter((m) => m.status !== 'removed').length,
          projectCount: counts.get(w._id.toString()) || 0,
          settings: w.settings,
          ownerId: w.ownerId.toString(),
          archivedAt: w.archivedAt ?? null,
          createdAt: w.createdAt,
        };
      })
    );
  })
);

/* ---------- archive / restore (spec §2.1) ---------- */
workspacesRouter.post(
  '/:id/archive',
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    ws.archivedAt = new Date();
    await ws.save();
    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.archive',
      entityType: 'workspace',
      entityId: ws._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true, archivedAt: ws.archivedAt });
  })
);

workspacesRouter.post(
  '/:id/restore',
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    ws.archivedAt = null;
    await ws.save();
    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.restore',
      entityType: 'workspace',
      entityId: ws._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* ---------- detail ---------- */
workspacesRouter.get(
  '/:id',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const users = await loadUsers(ws.members.map((m) => m.userId));
    const projects = await Project.find({ workspaceId: ws._id }).sort('-updatedAt').limit(50);
    res.json({
      id: ws._id.toString(),
      name: ws.name,
      description: ws.description,
      ownerId: ws.ownerId.toString(),
      settings: ws.settings,
      brandDna: ws.brandDna ?? null,
      archivedAt: ws.archivedAt ?? null,
      role: req.membershipRole,
      createdAt: ws.createdAt,
      members: ws.members.filter((m) => m.status !== 'removed').map((m) => serializeMember(m, users)),
      projects: projects.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        status: p.status,
        mode: p.mode,
        projectType: p.projectType,
        readinessScore: p.readinessScore,
        currentStage: p.currentStage,
        updatedAt: p.updatedAt,
      })),
    });
  })
);

/* ---------- update ---------- */
workspacesRouter.patch(
  '/:id',
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(updateSchema, req.body);
    const ws = req.workspace!;
    const before = { name: ws.name, settings: ws.settings };
    if (body.name) ws.name = body.name;
    if (body.description !== undefined) ws.description = body.description;
    if (body.settings) ws.settings = { ...ws.settings, ...body.settings };
    if (body.brandDna) ws.brandDna = { ...(ws.brandDna || ({} as never)), ...body.brandDna } as never;
    await ws.save();
    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.update',
      entityType: 'workspace',
      entityId: ws._id.toString(),
      before,
      after: { name: ws.name, settings: ws.settings, brandDna: ws.brandDna },
      ipAddress: clientIp(req),
    });
    res.json({ workspace: ws });
  })
);

/* ---------- delete ---------- */
workspacesRouter.delete(
  '/:id',
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    await KnowledgeInput.deleteMany({ workspaceId: ws._id });
    await Conflict.deleteMany({ workspaceId: ws._id });
    await Asset.deleteMany({ workspaceId: ws._id });
    await ProjectMember.deleteMany({ projectId: { $in: (await Project.find({ workspaceId: ws._id }).select('_id')).map((p) => p._id) } });
    await Project.deleteMany({ workspaceId: ws._id });
    await ws.deleteOne();
    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.delete',
      entityType: 'workspace',
      entityId: ws._id.toString(),
      before: { name: ws.name },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* ---------- members ---------- */
workspacesRouter.post(
  '/:id/members/invite',
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(inviteSchema, req.body);
    const ws = req.workspace!;
    const invitee = await User.findOne({ email: body.email.toLowerCase() });
    if (!invitee) throw new ApiError(404, 'No user with that email — ask them to register first.');

    const existing = ws.members.find((m) => m.userId.toString() === invitee._id.toString());
    if (existing && existing.status !== 'removed') throw new ApiError(409, 'Already a member of this workspace');

    const member = { userId: invitee._id, role: body.role, status: 'active' as const, joinedAt: new Date() };
    if (existing) {
      existing.role = body.role;
      existing.status = 'active';
      existing.joinedAt = new Date();
    } else {
      ws.members.push(member);
    }
    await ws.save();

    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.member_invite',
      entityType: 'workspace_member',
      entityId: invitee._id.toString(),
      after: { email: invitee.email, role: body.role },
      ipAddress: clientIp(req),
    });

    const users = await loadUsers([invitee._id]);
    res.status(201).json({
      member: serializeMember({ ...member, userId: invitee._id, status: 'active' }, users),
    });
  })
);

workspacesRouter.patch(
  '/:id/members/:memberId',
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(memberRoleSchema, req.body);
    const ws = req.workspace!;
    const target = ws.members.find((m) => m.userId.toString() === req.params.memberId && m.status !== 'removed');
    if (!target) throw new ApiError(404, 'Member not found');
    if (target.role === 'owner') throw new ApiError(403, 'The workspace owner’s role cannot be changed');
    if (body.role === 'owner') throw new ApiError(403, 'Ownership cannot be transferred here');

    const before = { role: target.role };
    target.role = body.role;
    await ws.save();

    await ProjectMember.updateMany(
      { userId: target.userId, workspaceRole: before.role },
      { workspaceRole: body.role }
    );

    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.role_change',
      entityType: 'workspace_member',
      entityId: String(target.userId),
      before,
      after: { role: body.role },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true, role: body.role });
  })
);

workspacesRouter.delete(
  '/:id/members/:memberId',
  requireWorkspace(),
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const target = ws.members.find((m) => m.userId.toString() === req.params.memberId && m.status !== 'removed');
    if (!target) throw new ApiError(404, 'Member not found');
    if (target.role === 'owner') throw new ApiError(403, 'The workspace owner cannot be removed');

    target.status = 'removed';
    await ws.save();

    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'workspace.member_remove',
      entityType: 'workspace_member',
      entityId: String(target.userId),
      before: { role: target.role, status: 'active' },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* ---------- audit trail ---------- */
workspacesRouter.get(
  '/:id/audit-logs',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const logs = await AuditLog.find({ workspaceId: req.workspace!._id })
      .sort('-createdAt')
      .limit(100)
      .populate('actorId', 'name email');
    res.json(
      logs.map((l) => ({
        id: l._id.toString(),
        action: l.action,
        entityType: l.entityType,
        actor: (l.actorId as unknown as { name?: string; email?: string })?.name || 'system',
        metadata: l.metadata,
        createdAt: l.createdAt,
      }))
    );
  })
);
