import { Router } from 'express';
import { z } from 'zod';
import { Conflict } from '../models/Conflict';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { User } from '../models/User';
import { requireAuth, requireProject, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { detectConflicts } from '../ai/conflicts';

export const conflictsRouter = Router();
conflictsRouter.use(requireAuth);

async function serialize(list: Array<Record<string, any>>) {
  const userIds = new Set<string>();
  list.forEach((c: any) => {
    if (c.assignedToId) userIds.add(String(c.assignedToId));
    if (c.resolvedById) userIds.add(String(c.resolvedById));
    if (c.inputAId) userIds.add(String(c.inputAId));
    if (c.inputBId) userIds.add(String(c.inputBId));
  });
  const [users, inputs] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name email'),
    KnowledgeInput.find({ _id: { $in: [...userIds] } }).select('title content type status'),
  ]);
  const userMap = new Map(users.map((u) => [u._id.toString(), { name: u.name, email: u.email }]));
  const inputMap = new Map(inputs.map((i) => [i._id.toString(), { title: i.title, content: i.content, type: i.type, status: i.status }]));

  return list.map((c: any) => ({
    id: c._id.toString(),
    projectId: String(c.projectId),
    title: c.title,
    description: c.description,
    severity: c.severity,
    status: c.status,
    conflictType: c.conflictType,
    detectedBy: c.detectedBy,
    recommendedAction: c.recommendedAction,
    impactIfUnresolved: c.impactIfUnresolved,
    inputA: c.inputAId ? { id: String(c.inputAId), ...inputMap.get(String(c.inputAId)) } : null,
    inputB: c.inputBId ? { id: String(c.inputBId), ...inputMap.get(String(c.inputBId)) } : null,
    assignedTo: c.assignedToId ? { id: String(c.assignedToId), ...userMap.get(String(c.assignedToId)) } : null,
    resolution: c.resolution,
    resolvedBy: c.resolvedById ? userMap.get(String(c.resolvedById))?.name : undefined,
    resolvedAt: c.resolvedAt,
    createdAt: c.createdAt,
  }));
}

/* list */
conflictsRouter.get(
  '/projects/:id/conflicts',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await Conflict.find({ projectId: req.project!._id }).sort('-createdAt');
    res.json(await serialize(list as never));
  })
);

/* detect */
conflictsRouter.post(
  '/projects/:id/conflicts/detect',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const inputs = await KnowledgeInput.find({ projectId: project._id });
    const { conflicts: detected, source, model } = await detectConflicts(inputs as never);

    const existingOpen = await Conflict.find({
      projectId: project._id,
      status: { $in: ['open', 'awaiting_decision'] },
    });
    const created: unknown[] = [];

    for (const d of detected) {
      const alreadyExists = existingOpen.some(
        (e) => e.title.toLowerCase() === d.title.toLowerCase()
      );
      if (alreadyExists) continue;

      const ws = await Workspace.findById(project.workspaceId);
      const resolver = ws?.members.find(
        (m) => m.role === d.recommendedResolverRole && m.status === 'active'
      ) || ws?.members.find((m) => m.role === 'lead' && m.status === 'active');

      const conflict = await Conflict.create({
        projectId: project._id,
        workspaceId: project.workspaceId,
        title: d.title,
        description: d.description,
        severity: d.severity,
        conflictType: d.conflictType,
        detectedBy: source === 'ai' ? 'ai' : 'system',
        assignedToId: resolver?.userId,
        inputAId: d.relatedInputIds[0],
        inputBId: d.relatedInputIds[1],
        recommendedAction: d.recommendedAction,
        impactIfUnresolved: d.impactIfUnresolved,
      });
      created.push(conflict);

      if (resolver) {
        // in-app notification for the assigned resolver
        const { Notification } = await import('../models/Notification');
        void Notification.create({
          userId: resolver.userId,
          workspaceId: project.workspaceId,
          projectId: project._id,
          type: 'conflict_assigned',
          title: `Conflict assigned: ${d.title}`,
          message: d.description,
          link: `/app/projects/${project._id}/conflicts`,
        }).catch(() => undefined);
      }
    }

    if (created.length) {
      audit({
        workspaceId: project.workspaceId.toString(),
        projectId: project._id.toString(),
        actorId: req.user!._id.toString(),
        actorType: 'ai',
        action: 'conflict.detect',
        entityType: 'conflict',
        after: { detected: detected.length, created: created.length, source, model },
        ipAddress: clientIp(req),
      });
      if (project.status === 'collecting_inputs') {
        project.status = 'validation';
        await project.save();
      }
    }

    const all = await Conflict.find({ projectId: project._id }).sort('-createdAt');
    res.json({ conflicts: await serialize(all as never), detectedCount: detected.length, createdCount: created.length, aiSource: source, model });
  })
);

/* assign */
const assignSchema = z.object({ userId: z.string().min(1) });

conflictsRouter.patch(
  '/conflicts/:id/assign',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(assignSchema, req.body);
    const conflict = await Conflict.findById(req.params.id);
    if (!conflict) throw new ApiError(404, 'Conflict not found');
    const ws = await Workspace.findById(conflict.workspaceId);
    if (!ws) throw new ApiError(404, 'Workspace not found');
    const role = ws.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role;
    if (!role || !['owner', 'lead'].includes(role)) throw new ApiError(403, 'Only owner or lead can assign conflicts');

    const target = ws.members.find((m) => m.userId.toString() === body.userId && m.status === 'active');
    if (!target) throw new ApiError(404, 'User is not an active workspace member');

    conflict.assignedToId = target.userId as never;
    if (conflict.status === 'open') conflict.status = 'awaiting_decision';
    await conflict.save();

    audit({
      workspaceId: conflict.workspaceId.toString(),
      projectId: conflict.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'conflict.assign',
      entityType: 'conflict',
      entityId: conflict._id.toString(),
      after: { assignedToId: body.userId },
      ipAddress: clientIp(req),
    });

    res.json({ ok: true });
  })
);

/* resolve */
const resolveSchema = z.object({
  resolution: z.string().min(3, 'A written decision is required').max(4000),
  inputActions: z
    .array(
      z.object({
        inputId: z.string(),
        action: z.enum(['approve', 'reject', 'update']),
        content: z.string().max(8000).optional(),
      })
    )
    .default([]),
});

conflictsRouter.patch(
  '/conflicts/:id/resolve',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(resolveSchema, req.body);
    const conflict = await Conflict.findById(req.params.id);
    if (!conflict) throw new ApiError(404, 'Conflict not found');
    if (['resolved', 'dismissed'].includes(conflict.status)) throw new ApiError(409, 'Conflict already closed');

    const ws = await Workspace.findById(conflict.workspaceId);
    if (!ws) throw new ApiError(404, 'Workspace not found');
    const role = ws.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role || 'admin';
    const isAssignee = conflict.assignedToId?.toString() === req.user!._id.toString();
    if (!isAssignee && !['owner', 'lead'].includes(role)) {
      throw new ApiError(403, 'Only the assigned resolver, owner or lead can resolve this conflict');
    }

    const before = { status: conflict.status };
    conflict.status = 'resolved';
    conflict.resolution = body.resolution;
    conflict.resolvedById = req.user!._id as never;
    conflict.resolvedAt = new Date();
    await conflict.save();

    const applied: string[] = [];
    for (const action of body.inputActions) {
      const input = await KnowledgeInput.findById(action.inputId);
      if (!input || input.projectId.toString() !== conflict.projectId.toString()) continue;
      if (action.action === 'approve') {
        input.status = 'approved';
        input.approvedById = req.user!._id;
        input.approvedAt = new Date();
      } else if (action.action === 'reject') {
        input.status = 'rejected';
      } else if (action.action === 'update' && action.content) {
        input.content = action.content;
        input.version += 1;
        input.status = 'draft';
      }
      await input.save();
      applied.push(`${action.action}: ${input.title}`);
      audit({
        workspaceId: input.workspaceId.toString(),
        projectId: input.projectId.toString(),
        actorId: req.user!._id.toString(),
        action: `input.${action.action}`,
        entityType: 'knowledge_input',
        entityId: input._id.toString(),
        after: { status: input.status, viaConflict: conflict._id },
        ipAddress: clientIp(req),
      });
    }

    audit({
      workspaceId: conflict.workspaceId.toString(),
      projectId: conflict.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'conflict.resolve',
      entityType: 'conflict',
      entityId: conflict._id.toString(),
      before,
      after: { status: 'resolved', resolution: body.resolution, inputActions: applied },
      ipAddress: clientIp(req),
    });

    res.json({ ok: true, applied });
  })
);

/* dismiss */
conflictsRouter.patch(
  '/conflicts/:id/dismiss',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ reason: z.string().min(3).max(2000) }), req.body);
    const conflict = await Conflict.findById(req.params.id);
    if (!conflict) throw new ApiError(404, 'Conflict not found');

    const ws = await Workspace.findById(conflict.workspaceId);
    const role = ws?.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role;
    if (!role || !['owner', 'lead', 'reviewer'].includes(role)) throw new ApiError(403, 'Not allowed to dismiss conflicts');

    const before = { status: conflict.status };
    conflict.status = 'dismissed';
    conflict.resolution = `Dismissed: ${body.reason}`;
    conflict.resolvedById = req.user!._id as never;
    conflict.resolvedAt = new Date();
    await conflict.save();

    audit({
      workspaceId: conflict.workspaceId.toString(),
      projectId: conflict.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'conflict.dismiss',
      entityType: 'conflict',
      entityId: conflict._id.toString(),
      before,
      after: { status: 'dismissed', reason: body.reason },
      ipAddress: clientIp(req),
    });

    res.json({ ok: true });
  })
);
