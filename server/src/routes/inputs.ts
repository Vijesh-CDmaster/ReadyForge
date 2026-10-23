import { Router } from 'express';
import { z } from 'zod';
import { KnowledgeInput, INPUT_TYPES, SOURCE_TYPES } from '../models/KnowledgeInput';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { requireAuth, requireProject, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';

export const inputsRouter = Router();
inputsRouter.use(requireAuth);

const createSchema = z.object({
  type: z.enum(INPUT_TYPES),
  title: z.string().min(2).max(200),
  content: z.string().min(1).max(8000),
  sourceType: z.enum(SOURCE_TYPES).default('user_input'),
  sourceReference: z.string().max(1000).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  tags: z.array(z.string().max(50)).default([]),
  expiresAt: z.string().datetime().optional(),
});

const updateSchema = createSchema.partial();

const VIEWER_BLOCKED = ['viewer'];

async function serialize(inputs: Array<Record<string, any>>) {
  const ids = [...new Set(inputs.map((i) => String(i.createdById)))];
  const users = await User.find({ _id: { $in: ids } }).select('name email');
  const map = new Map(users.map((u) => [u._id.toString(), u]));
  return inputs.map((i) => {
    const u = map.get(String(i.createdById));
    return {
      id: i._id.toString(),
      projectId: String(i.projectId),
      type: i.type,
      title: i.title,
      content: i.content,
      sourceType: i.sourceType,
      sourceReference: i.sourceReference,
      status: i.status,
      confidence: i.confidence,
      tags: i.tags,
      version: i.version,
      createdById: String(i.createdById),
      contributorName: u?.name || 'Unknown',
      contributorEmail: u?.email || '',
      approvedAt: i.approvedAt,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    };
  });
}

/* list */
inputsRouter.get(
  '/projects/:id/inputs',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const inputs = await KnowledgeInput.find({ projectId: req.project!._id }).sort('-updatedAt');
    res.json(await serialize(inputs as never));
  })
);

/* create */
inputsRouter.post(
  '/projects/:id/inputs',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    if (VIEWER_BLOCKED.includes(req.membershipRole || '')) throw new ApiError(403, 'Viewers cannot add inputs');
    const body = validateBody(createSchema, req.body);

    const input = await KnowledgeInput.create({
      projectId: project._id,
      workspaceId: project.workspaceId,
      createdById: req.user!._id,
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    if (project.status === 'draft') {
      project.status = 'collecting_inputs';
      await project.save();
    }

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'input.create',
      entityType: 'knowledge_input',
      entityId: input._id.toString(),
      after: { type: input.type, title: input.title, status: input.status },
      ipAddress: clientIp(req),
    });

    res.status(201).json({ input: (await serialize([input as never]))[0] });
  })
);

/* update */
inputsRouter.patch(
  '/inputs/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = await KnowledgeInput.findById(req.params.id);
    if (!input) throw new ApiError(404, 'Input not found');
    const project = await Project.findById(input.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const { canEdit, role } = await membership(req, project.workspaceId);
    if (!canEdit) throw new ApiError(403, 'Not allowed to edit this input');
    if (input.createdById.toString() !== req.user!._id.toString() && !['owner', 'lead'].includes(role)) {
      throw new ApiError(403, 'Only the contributor, owner or lead can edit this input');
    }

    const body = validateBody(updateSchema, req.body);
    const before = { title: input.title, content: input.content, status: input.status };
    Object.assign(input, body);
    if (body.expiresAt !== undefined) input.expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    if (input.status === 'approved') {
      // editing an approved input creates a new version and returns it to draft
      input.version += 1;
      input.status = 'draft';
      input.approvedById = undefined;
      input.approvedAt = undefined;
    }
    await input.save();

    audit({
      workspaceId: input.workspaceId.toString(),
      projectId: input.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'input.update',
      entityType: 'knowledge_input',
      entityId: input._id.toString(),
      before,
      after: { title: input.title, content: input.content, status: input.status, version: input.version },
      ipAddress: clientIp(req),
    });

    res.json({ input: (await serialize([input as never]))[0] });
  })
);

/* delete */
inputsRouter.delete(
  '/inputs/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = await KnowledgeInput.findById(req.params.id);
    if (!input) throw new ApiError(404, 'Input not found');
    const project = await Project.findById(input.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const { canEdit, role } = await membership(req, project.workspaceId);
    if (!canEdit) throw new ApiError(403, 'Not allowed to delete this input');
    if (input.createdById.toString() !== req.user!._id.toString() && !['owner', 'lead'].includes(role)) {
      throw new ApiError(403, 'Only the contributor, owner or lead can delete this input');
    }

    await input.deleteOne();
    audit({
      workspaceId: input.workspaceId.toString(),
      projectId: input.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'input.delete',
      entityType: 'knowledge_input',
      entityId: req.params.id,
      before: { title: input.title, type: input.type },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* approve */
inputsRouter.post(
  '/inputs/:id/approve',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = await KnowledgeInput.findById(req.params.id);
    if (!input) throw new ApiError(404, 'Input not found');
    const project = await Project.findById(input.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const role = await roleOf(req, project.workspaceId);
    if (!['owner', 'lead', 'reviewer', 'subject_matter_expert', 'legal_reviewer'].includes(role)) {
      throw new ApiError(403, 'Your role cannot approve knowledge inputs');
    }

    const before = { status: input.status };
    input.status = 'approved';
    input.approvedById = req.user!._id;
    input.approvedAt = new Date();
    await input.save();

    audit({
      workspaceId: input.workspaceId.toString(),
      projectId: input.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'input.approve',
      entityType: 'knowledge_input',
      entityId: input._id.toString(),
      before,
      after: { status: 'approved' },
      ipAddress: clientIp(req),
    });

    res.json({ input: (await serialize([input as never]))[0] });
  })
);

/* dispute */
inputsRouter.post(
  '/inputs/:id/dispute',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ reason: z.string().min(3).max(2000) }), req.body);
    const input = await KnowledgeInput.findById(req.params.id);
    if (!input) throw new ApiError(404, 'Input not found');
    const project = await Project.findById(input.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const role = await roleOf(req, project.workspaceId);
    if (role === 'viewer') throw new ApiError(403, 'Viewers cannot dispute inputs');

    const before = { status: input.status };
    input.status = 'disputed';
    await input.save();

    audit({
      workspaceId: input.workspaceId.toString(),
      projectId: input.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'input.dispute',
      entityType: 'knowledge_input',
      entityId: input._id.toString(),
      before,
      after: { status: 'disputed', reason: body.reason },
      ipAddress: clientIp(req),
    });

    res.json({ input: (await serialize([input as never]))[0] });
  })
);

async function membership(req: AuthedRequest, workspaceId: unknown) {
  const { Workspace } = await import('../models/Workspace');
  const ws = await Workspace.findById(workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');
  const m = ws.members.find((x) => x.userId.toString() === req.user!._id.toString() && x.status === 'active');
  if (!m && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Not a member of this workspace');
  return { canEdit: !m || m.role !== 'viewer', role: m?.role || 'admin', workspace: ws };
}

async function roleOf(req: AuthedRequest, workspaceId: unknown): Promise<string> {
  return (await membership(req, workspaceId)).role;
}
