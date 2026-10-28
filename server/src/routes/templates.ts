import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWorkspace, requireRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { Workspace } from '../models/Workspace';
import { Project, PROJECT_TYPES } from '../models/Project';
import { ProjectTemplate, IProjectTemplate } from '../models/ProjectTemplate';
import { BUILTIN_TEMPLATES } from '../templates/builtin';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const briefSchema = z.object({
  objective: z.string().max(2000).default(''),
  audience: z.string().max(1000).default(''),
  tone: z.string().max(300).default(''),
  callToAction: z.string().max(300).default(''),
  deadlineDays: z.number().int().min(1).max(3650).optional(),
  budgetAmount: z.number().min(0).max(1_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
});

const createSchema = z
  .object({
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    projectType: z.enum(PROJECT_TYPES),
    mode: z.enum(['solo', 'team']).default('solo'),
    brief: briefSchema.optional(),
    /** Save an existing project's brief as a reusable template (spec §3.5). */
    sourceProjectId: z.string().length(24).optional(),
  })
  .refine((v) => v.brief || v.sourceProjectId, {
    message: 'Provide either a brief or an existing project id',
  });

function serialize(t: IProjectTemplate) {
  return {
    id: t._id.toString(),
    kind: 'custom' as const,
    name: t.name,
    description: t.description || '',
    projectType: t.projectType,
    mode: t.mode,
    brief: t.brief,
    sourceProjectId: t.sourceProjectId ? t.sourceProjectId.toString() : null,
    createdAt: t.createdAt,
  };
}

function serializeBuiltin(b: (typeof BUILTIN_TEMPLATES)[number]) {
  return {
    id: b.id,
    kind: 'builtin' as const,
    name: b.name,
    description: b.description,
    projectType: b.projectType,
    mode: b.mode,
    brief: b.brief,
    sourceProjectId: null,
    createdAt: null,
  };
}

templatesRouter.get(
  '/workspaces/:id/templates',
  requireAuth,
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const customs = await ProjectTemplate.find({ workspaceId: req.workspace!._id }).sort('-updatedAt').limit(100);
    res.json({
      templates: [...BUILTIN_TEMPLATES.map(serializeBuiltin), ...customs.map(serialize)],
    });
  })
);

templatesRouter.post(
  '/workspaces/:id/templates',
  requireAuth,
  requireWorkspace(),
  requireRole('owner', 'lead', 'writer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(createSchema, req.body);
    const ws = req.workspace!;

    let brief = body.brief;
    let projectType = body.projectType;
    let mode = body.mode;
    let sourceProjectId: string | null = null;

    if (body.sourceProjectId) {
      const project = await Project.findOne({ _id: body.sourceProjectId, workspaceId: ws._id });
      if (!project) throw new ApiError(404, 'Project not found in this workspace');
      brief = {
        objective: project.objective || '',
        audience: project.audience || '',
        tone: project.tone || '',
        callToAction: project.callToAction || '',
        budgetAmount: project.budget?.amount || undefined,
        currency: project.budget?.currency || undefined,
        tags: [],
        ...(project.deadline
          ? { deadlineDays: Math.max(1, Math.ceil((new Date(project.deadline).getTime() - Date.now()) / 86400_000)) }
          : {}),
      };
      projectType = project.projectType as (typeof PROJECT_TYPES)[number];
      mode = project.mode;
      sourceProjectId = project._id.toString();
    }

    const template = await ProjectTemplate.create({
      workspaceId: ws._id,
      ownerId: req.user!._id,
      name: body.name,
      description: body.description,
      projectType,
      mode,
      brief,
      sourceProjectId,
    });

    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'project_template.create',
      entityType: 'project_template',
      entityId: template._id.toString(),
      after: { name: template.name, fromProject: Boolean(sourceProjectId) },
      ipAddress: clientIp(req),
    });

    res.status(201).json({ template: serialize(template) });
  })
);

templatesRouter.get(
  '/templates/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Built-in ids are slugs (`builtin:product_ad`), not ObjectIds — resolve them first.
    const builtin = BUILTIN_TEMPLATES.find((b) => b.id === req.params.id);
    if (builtin) return res.json({ template: serializeBuiltin(builtin) });
    if (!/^[0-9a-f]{24}$/.test(req.params.id)) throw new ApiError(404, 'Template not found');

    const template = await ProjectTemplate.findById(req.params.id);
    if (!template) throw new ApiError(404, 'Template not found');
    const ws = await Workspace.findById(template.workspaceId);
    const member = ws?.members.find(
      (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
    );
    if (!member && req.user!.platformRole !== 'admin') {
      throw new ApiError(403, 'You are not a member of this workspace');
    }
    res.json({ template: serialize(template) });
  })
);

templatesRouter.delete(
  '/templates/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!/^[0-9a-f]{24}$/.test(req.params.id)) throw new ApiError(400, 'Invalid id');
    const template = await ProjectTemplate.findById(req.params.id);
    if (!template) throw new ApiError(404, 'Template not found');

    const ws = await Workspace.findById(template.workspaceId);
    const role = ws?.members.find(
      (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
    )?.role;
    const allowed = role === 'owner' || role === 'lead' || template.ownerId.toString() === req.user!._id.toString();
    if (!allowed && req.user!.platformRole !== 'admin') {
      throw new ApiError(403, 'Only owners, leads or the template author can delete a template');
    }

    await template.deleteOne();
    audit({
      workspaceId: template.workspaceId.toString(),
      actorId: req.user!._id.toString(),
      action: 'project_template.delete',
      entityType: 'project_template',
      entityId: req.params.id,
      before: { name: template.name },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);
