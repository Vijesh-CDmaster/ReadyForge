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
    inputAId: c.inputAId ? String(c.inputAId) : null,
    inputBId: c.inputBId ? String(c.inputBId) : null,
    inputA: c.inputAId ? { id: String(c.inputAId), ...inputMap.get(String(c.inputAId)) } : null,
    inputB: c.inputBId ? { id: String(c.inputBId), ...inputMap.get(String(c.inputBId)) } : null,
    assignedTo: c.assignedToId ? { id: String(c.assignedToId), ...userMap.get(String(c.assignedToId)) } : null,
    resolution: c.resolution,
    resolvedBy: c.resolvedById ? userMap.get(String(c.resolvedById))?.name : undefined,
    resolvedAt: c.resolvedAt,
    createdAt: c.createdAt,
  }));
}

/* ---------------- one-click recommendation (Enhancement 3) ---------------- */

/** Authority order per conflict type — the role that legitimately owns the decision. */
const AUTHORITY: Record<string, string[]> = {
  pricing: ['finance_owner', 'lead', 'owner'],
  rights: ['legal_reviewer', 'owner'],
  factual: ['subject_matter_expert', 'lead', 'owner'],
  goal: ['lead', 'owner'],
  brand: ['designer', 'lead', 'owner'],
  tone: ['writer', 'lead', 'owner'],
  audience: ['lead', 'owner'],
  budget: ['finance_owner', 'lead', 'owner'],
};

interface Recommendation {
  optionA: { id: string; content: string; creatorRole: string | null } | null;
  optionB: { id: string; content: string; creatorRole: string | null } | null;
  recommended: 'A' | 'B' | null;
  reason: string;
}

async function computeRecommendation(conflict: import('../models/Conflict').IConflict): Promise<Recommendation> {
  const [inputA, inputB, ws] = await Promise.all([
    conflict.inputAId ? KnowledgeInput.findById(conflict.inputAId) : null,
    conflict.inputBId ? KnowledgeInput.findById(conflict.inputBId) : null,
    Workspace.findById(conflict.workspaceId),
  ]);
  const roleOf = (userId?: unknown) =>
    ws?.members.find((m) => m.userId.toString() === String(userId) && m.status === 'active')?.role ?? null;

  const optionA = inputA
    ? { id: String(inputA._id), content: inputA.content, creatorRole: roleOf(inputA.createdById) }
    : null;
  const optionB = inputB
    ? { id: String(inputB._id), content: inputB.content, creatorRole: roleOf(inputB.createdById) }
    : null;
  if (!optionA || !optionB) {
    return { optionA, optionB, recommended: null, reason: conflict.recommendedAction || 'No paired inputs to compare.' };
  }

  const order = AUTHORITY[conflict.conflictType] || ['lead', 'owner'];
  const rank = (role: string | null) => (role ? Math.max(0, order.indexOf(role) >= 0 ? order.length - order.indexOf(role) : 0) : 0);
  // Authority dominates; approval status and supplier confidence break ties
  // (e.g. two inputs from the same owner — the higher-confidence one wins).
  const score = (o: NonNullable<Recommendation['optionA']>, input: { status: string; confidence?: number }) =>
    rank(o.creatorRole) * 10 + (input.status === 'approved' ? 5 : 0) + Math.round((input.confidence ?? 0.5) * 3);

  const sA = score(optionA, inputA!);
  const sB = score(optionB, inputB!);
  const tied = sA === sB;
  let recommended: 'A' | 'B' | null = tied ? null : sA > sB ? 'A' : 'B';
  if (recommended === null) {
    // Full tie (same authority, same status, same confidence): still give one-click
    // resolution a concrete action — prefer approved, then higher confidence, then Option A.
    if (inputA!.status === 'approved' && inputB!.status !== 'approved') recommended = 'A';
    else if (inputB!.status === 'approved' && inputA!.status !== 'approved') recommended = 'B';
    else if ((inputA!.confidence ?? 0.5) !== (inputB!.confidence ?? 0.5)) {
      recommended = (inputA!.confidence ?? 0.5) > (inputB!.confidence ?? 0.5) ? 'A' : 'B';
    } else recommended = 'A';
  }

  const winner = recommended === 'A' ? optionA : optionB;
  const reason =
    `Recommended: Option ${recommended} — supplied by the ${winner!.creatorRole || 'member'}${
      (recommended === 'A' ? inputA! : inputB!).status === 'approved' ? ' and already approved in the ledger' : ''
    }, the authorised role for ${conflict.conflictType} decisions${
      tied
        ? ' (inputs scored equally — the tie was broken by approval status, then supplier confidence, then the first-stated option)'
        : rank(optionA.creatorRole) === rank(optionB.creatorRole)
          ? ', with higher supplier confidence as the tie-break'
          : ''
    }. ${conflict.recommendedAction || ''}`.trim();

  return { optionA, optionB, recommended, reason };
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
        // in-app notification for the assigned resolver — respecting their prefs
        const { Notification } = await import('../models/Notification');
        const { User, wantsNotification } = await import('../models/User');
        const resolverUser = await User.findById(resolver.userId);
        if (wantsNotification(resolverUser, 'conflict_assigned')) {
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

/* recommendation (for the one-click resolve UI) */
conflictsRouter.get(
  '/conflicts/:id/recommendation',
  asyncHandler(async (req: AuthedRequest, res) => {
    const conflict = await Conflict.findById(req.params.id);
    if (!conflict) throw new ApiError(404, 'Conflict not found');
    const ws = await Workspace.findById(conflict.workspaceId);
    const role = ws?.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role;
    if (!role && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Workspace membership required');
    res.json(await computeRecommendation(conflict));
  })
);

/* one-click accept: resolve with the recommendation, flip both inputs accordingly */
conflictsRouter.patch(
  '/conflicts/:id/accept-recommendation',
  asyncHandler(async (req: AuthedRequest, res) => {
    const conflict = await Conflict.findById(req.params.id);
    if (!conflict) throw new ApiError(404, 'Conflict not found');
    if (['resolved', 'dismissed'].includes(conflict.status)) throw new ApiError(409, 'Conflict already closed');

    const ws = await Workspace.findById(conflict.workspaceId);
    const role = ws?.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role || 'admin';
    const isAssignee = conflict.assignedToId?.toString() === req.user!._id.toString();
    if (!isAssignee && !['owner', 'lead'].includes(role)) {
      throw new ApiError(403, 'Only the assigned resolver, owner or lead can resolve this conflict');
    }

    const rec = await computeRecommendation(conflict);
    if (!rec.recommended || !rec.optionA || !rec.optionB) {
      throw new ApiError(409, 'No automatic recommendation available — resolve manually with a written decision.');
    }

    const winnerId = rec.recommended === 'A' ? rec.optionA.id : rec.optionB.id;
    const loserId = rec.recommended === 'A' ? rec.optionB.id : rec.optionA.id;

    const before = { status: conflict.status };
    conflict.status = 'resolved';
    conflict.resolution = `Accepted recommendation (Option ${rec.recommended}): ${rec.reason}`;
    conflict.resolvedById = req.user!._id as never;
    conflict.resolvedAt = new Date();
    await conflict.save();

    const winner = await KnowledgeInput.findById(winnerId);
    const loser = await KnowledgeInput.findById(loserId);
    if (winner) {
      winner.status = 'approved';
      winner.approvedById = req.user!._id;
      winner.approvedAt = new Date();
      await winner.save();
    }
    if (loser && loser.status !== 'rejected') {
      loser.status = 'rejected';
      await loser.save();
    }

    audit({
      workspaceId: conflict.workspaceId.toString(),
      projectId: conflict.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'conflict.resolve',
      entityType: 'conflict',
      entityId: conflict._id.toString(),
      before,
      after: { status: 'resolved', via: 'one_click_recommendation', recommended: rec.recommended },
      metadata: { approvedInput: winnerId, rejectedInput: loserId },
      ipAddress: clientIp(req),
    });

    res.json({
      ok: true,
      resolved: true,
      status: conflict.status,
      recommended: rec.recommended,
      reason: rec.reason,
      applied: [winnerId, loserId],
    });
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

    res.json({ ok: true, resolved: true, status: conflict.status, applied });
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
