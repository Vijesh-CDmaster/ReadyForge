import { Router } from 'express';
import { z } from 'zod';
import { Project, PROJECT_TYPES, LADDER_STAGES } from '../models/Project';
import { ProjectMember } from '../models/ProjectMember';
import { Workspace, WORKSPACE_ROLES } from '../models/Workspace';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Conflict } from '../models/Conflict';
import { Asset } from '../models/Asset';
import { ProductionContract } from '../models/ProductionContract';
import { AuditLog } from '../models/AuditLog';
import { ProjectTemplate } from '../models/ProjectTemplate';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requireProject, requireRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { computeReadiness } from '../engines/readiness';
import { computeCostAtRisk } from '../engines/costAtRisk';
import { buildContractDraft, requiredApproversFor } from '../engines/contract';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const budgetSchema = z.object({
  amount: z.number().min(0),
  currency: z.string().length(3).default('INR'),
});

const createSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  projectType: z.enum(PROJECT_TYPES).default('custom'),
  mode: z.enum(['solo', 'team']).default('solo'),
  objective: z.string().max(2000).optional(),
  audience: z.string().max(1000).optional(),
  tone: z.string().max(400).optional(),
  callToAction: z.string().max(400).optional(),
  successMetric: z.string().max(400).optional(),
  deadline: z.string().datetime().optional(),
  budget: budgetSchema.optional(),
  templateId: z.string().min(1).optional(),
});

const updateSchema = createSchema.partial().omit({ workspaceId: true }).extend({ status: z.string().optional() });

const memberSchema = z.object({
  userId: z.string().min(1),
  projectRole: z.enum(WORKSPACE_ROLES),
  responsibilities: z.array(z.string().max(200)).default([]),
});

/* ---------- create ---------- */
projectsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(createSchema, req.body);
    const user = req.user!;

    const workspace = await Workspace.findById(body.workspaceId);
    if (!workspace) throw new ApiError(404, 'Workspace not found');
    const membership = workspace.members.find(
      (m) => m.userId.toString() === user._id.toString() && m.status === 'active'
    );
    if (!membership) throw new ApiError(403, 'Not a member of this workspace');
    if (!['owner', 'lead', 'writer'].includes(membership.role) && user.platformRole !== 'admin') {
      throw new ApiError(403, 'Your workspace role cannot create projects');
    }

    // Optional template: a workspace custom template (explicitly selected) or a
    // built-in one. The request's own brief values win; the template only fills
    // what the caller left empty, so the API contract is unchanged for old clients.
    let templateBrief: Record<string, unknown> | undefined;
    if (body.templateId) {
      const builtin = BUILTIN_TEMPLATES.find((b) => b.id === body.templateId);
      if (builtin) {
        templateBrief = builtin.brief as unknown as Record<string, unknown>;
      } else {
        // Custom templates are workspace-scoped — a foreign id 404s (no existence leak).
        if (!isValidObjectId(body.templateId)) throw new ApiError(404, 'Template not found');
        const tpl = await ProjectTemplate.findOne({
          _id: body.templateId,
          workspaceId: workspace._id,
        });
        if (!tpl) throw new ApiError(404, 'Template not found');
        templateBrief = tpl.brief as unknown as Record<string, unknown>;
      }
    }

    const pick = <T>(v: T | undefined, k: string): T | undefined =>
      v !== undefined && v !== null && v !== '' ? v : ((templateBrief?.[k] as T | undefined) ?? undefined);

    const budgetAmount = body.budget?.amount ?? 0;
    const project = await Project.create({
      workspaceId: workspace._id,
      createdById: user._id,
      title: body.title,
      description: body.description,
      projectType: body.projectType,
      mode: body.mode,
      status: 'collecting_inputs',
      objective: pick(body.objective, 'objective'),
      audience: pick(body.audience, 'audience'),
      tone: pick(body.tone, 'tone'),
      callToAction: pick(body.callToAction, 'callToAction'),
      successMetric: pick(body.successMetric, 'successMetric'),
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      budget: {
        amount: budgetAmount,
        currency: body.budget?.currency || workspace.settings.defaultCurrency,
        spent: 0,
        remaining: budgetAmount,
      },
    });

    await ProjectMember.create({
      projectId: project._id,
      userId: user._id,
      workspaceRole: membership.role,
      projectRole: membership.role === 'owner' ? 'lead' : membership.role,
      responsibilities: ['Project creator'],
      status: 'active',
    });

    audit({
      workspaceId: workspace._id.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'project.create',
      entityType: 'project',
      entityId: project._id.toString(),
      after: { title: project.title, mode: project.mode, projectType: project.projectType },
      ipAddress: clientIp(req),
    });

    // Serialized consistently with GET /projects/:id so clients can read `id`
    // (raw mongoose toJSON only exposes `_id`, which broke post-create routing).
    res.status(201).json({
      project: {
        id: project._id.toString(),
        workspaceId: project.workspaceId.toString(),
        title: project.title,
        description: project.description,
        projectType: project.projectType,
        status: project.status,
        mode: project.mode,
        objective: project.objective,
        audience: project.audience,
        tone: project.tone,
        callToAction: project.callToAction,
        successMetric: project.successMetric,
        deadline: project.deadline,
        budget: project.budget,
        currentStage: project.currentStage,
        readinessScore: project.readinessScore,
        createdAt: project.createdAt,
      },
    });
  })
);

/* ---------- list ---------- */
projectsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = req.user!;
    const filter: Record<string, unknown> = {};
    if (req.query.workspaceId) filter.workspaceId = req.query.workspaceId;
    if (req.query.status) filter.status = req.query.status;

    const memberships = await Workspace.find({
      'members.userId': user._id,
      'members.status': 'active',
    }).select('_id');
    const allowed = memberships.map((m) => m._id);
    const projects = await Project.find({ ...filter, workspaceId: { $in: allowed } })
      .sort('-updatedAt')
      .limit(200);

    const workspaceIds = [...new Set(projects.map((p) => p.workspaceId.toString()))];
    const workspaces = await Workspace.find({ _id: { $in: workspaceIds } }).select('name');
    const wsNames = new Map(workspaces.map((w) => [w._id.toString(), w.name]));

    res.json(
      projects.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        status: p.status,
        mode: p.mode,
        projectType: p.projectType,
        readinessScore: p.readinessScore,
        currentStage: p.currentStage,
        workspaceId: p.workspaceId.toString(),
        workspaceName: wsNames.get(p.workspaceId.toString()) || '',
        budget: p.budget,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      }))
    );
  })
);

/* ---------- detail ---------- */
projectsRouter.get(
  '/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const ws = req.workspace!;
    const [members, counts, contract] = await Promise.all([
      ProjectMember.find({ projectId: project._id, status: { $ne: 'removed' } }),
      KnowledgeInput.aggregate([
        { $match: { projectId: project._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version'),
    ]);
    const memberIds = members.map((m) => m.userId);
    const { User } = await import('../models/User');
    const users = await User.find({ _id: { $in: memberIds } }).select('name email avatarUrl');
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const inputCounts: Record<string, number> = {};
    counts.forEach((c) => (inputCounts[c._id] = c.count));

    res.json({
      id: project._id.toString(),
      workspaceId: project.workspaceId.toString(),
      workspaceName: ws.name,
      workspaceRole: req.membershipRole,
      title: project.title,
      description: project.description,
      projectType: project.projectType,
      status: project.status,
      mode: project.mode,
      objective: project.objective,
      audience: project.audience,
      tone: project.tone,
      callToAction: project.callToAction,
      successMetric: project.successMetric,
      deadline: project.deadline,
      budget: project.budget,
      currentStage: project.currentStage,
      readinessScore: project.readinessScore,
      costAtRisk: project.costAtRisk,
      inputCounts,
      latestContract: contract
        ? { id: contract._id.toString(), version: contract.version, status: contract.status }
        : null,
      members: members.map((m) => {
        const u = userMap.get(m.userId.toString());
        return {
          id: m._id.toString(),
          userId: m.userId.toString(),
          projectRole: m.projectRole,
          workspaceRole: m.workspaceRole,
          responsibilities: m.responsibilities,
          name: u?.name || 'Unknown',
          email: u?.email || '',
        };
      }),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  })
);

/* ---------- update ---------- */
projectsRouter.patch(
  '/:id',
  requireProject('owner', 'lead', 'writer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(updateSchema, req.body);
    const project = req.project!;
    const before = { title: project.title, status: project.status, objective: project.objective };

    const allowed: Array<keyof typeof body> = [
      'title', 'description', 'objective', 'audience', 'tone', 'callToAction', 'successMetric',
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) (project as any)[key] = body[key];
    }
    if (body.deadline !== undefined) project.deadline = body.deadline ? new Date(body.deadline) : undefined;
    if (body.projectType) project.projectType = body.projectType;
    if (body.budget) {
      project.budget.amount = body.budget.amount;
      if (body.budget.currency) project.budget.currency = body.budget.currency;
    }

    // Only amount/currency are dirty here — `remaining` is left to the atomic
    // recompute below so a concurrent generation charge cannot be overwritten
    // by this request's stale read of `spent`.
    await project.save();
    if (body.budget) {
      const fresh = await Project.findOneAndUpdate(
        { _id: project._id },
        [
          {
            $set: {
              'budget.remaining': { $max: [0, { $subtract: ['$budget.amount', '$budget.spent'] }] },
              updatedAt: new Date(),
            },
          },
        ],
        { new: true }
      ).select('budget');
      if (fresh) project.budget = fresh.budget;
    }

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'project.update',
      entityType: 'project',
      entityId: project._id.toString(),
      before,
      after: { title: project.title, status: project.status, budget: project.budget },
      ipAddress: clientIp(req),
    });
    res.json({ project });
  })
);

/* ---------- delete ---------- */
projectsRouter.delete(
  '/:id',
  requireProject('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    await KnowledgeInput.deleteMany({ projectId: project._id });
    await Conflict.deleteMany({ projectId: project._id });
    await Asset.deleteMany({ projectId: project._id });
    await ProductionContract.deleteMany({ projectId: project._id });
    await ProjectMember.deleteMany({ projectId: project._id });
    await project.deleteOne();
    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'project.delete',
      entityType: 'project',
      entityId: project._id.toString(),
      before: { title: project.title },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* ---------- project members ---------- */
projectsRouter.post(
  '/:id/members',
  requireProject('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(memberSchema, req.body);
    const project = req.project!;
    const ws = req.workspace!;
    const wsMember = ws.members.find(
      (m) => m.userId.toString() === body.userId && m.status === 'active'
    );
    if (!wsMember) throw new ApiError(404, 'User is not an active member of this workspace');

    const existing = await ProjectMember.findOne({ projectId: project._id, userId: body.userId });
    if (existing) {
      existing.projectRole = body.projectRole;
      existing.responsibilities = body.responsibilities;
      existing.status = 'active';
      await existing.save();
    } else {
      await ProjectMember.create({
        projectId: project._id,
        userId: body.userId,
        workspaceRole: wsMember.role,
        projectRole: body.projectRole,
        responsibilities: body.responsibilities,
        status: 'active',
      });
    }
    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'project.member_assign',
      entityType: 'project_member',
      entityId: body.userId,
      after: { projectRole: body.projectRole },
      ipAddress: clientIp(req),
    });
    res.status(201).json({ ok: true });
  })
);

/* ---------- validate (readiness) ---------- */
async function projectContext(projectId: unknown) {
  const [inputs, conflicts, assets, contract] = await Promise.all([
    KnowledgeInput.find({ projectId }),
    Conflict.find({ projectId }),
    Asset.find({ projectId }),
    ProductionContract.findOne({ projectId, status: { $ne: 'superseded' } }).sort('-version'),
  ]);
  return { inputs, conflicts, assets, contract };
}

projectsRouter.post(
  '/:id/validate',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);
    const report = computeReadiness({ project, inputs, conflicts, assets, contract });

    const before = project.readinessScore;
    project.readinessScore = report.score;
    await project.save();

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'project.validate',
      entityType: 'project',
      entityId: project._id.toString(),
      before: { readinessScore: before },
      after: { readinessScore: report.score, blockers: report.blockingIssues.length },
      ipAddress: clientIp(req),
    });

    res.json(report);
  })
);

projectsRouter.get(
  '/:id/readiness',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);
    res.json(computeReadiness({ project, inputs, conflicts, assets, contract }));
  })
);

/* Spec: project validation — can this project safely generate right now? */
projectsRouter.get(
  '/:id/validate',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);
    const report = computeReadiness({ project, inputs, conflicts, assets, contract });
    res.json({
      ...report,
      valid: report.blockingIssues.length === 0,
      openConflicts: conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision').length,
      contractStatus: contract?.status ?? null,
      validatedAt: new Date(),
    });
  })
);

projectsRouter.get(
  '/:id/cost-at-risk',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets } = await projectContext(project._id);
    const report = computeCostAtRisk({ project, inputs, conflicts, assets });

    project.costAtRisk = {
      plannedCost: report.plannedCost,
      reworkProbability: report.reworkProbability,
      estimatedLoss: report.estimatedLoss,
      currency: report.currency,
      reasons: report.reasons,
      updatedAt: new Date(),
    };
    await project.save();
    res.json(report);
  })
);

/* ---------- contract ---------- */
projectsRouter.post(
  '/:id/contract',
  requireProject('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const ws = req.workspace!;
    const { inputs, assets, conflicts } = await projectContext(project._id);

    const { draft, source, model } = await buildContractDraft({ project, inputs, assets, conflicts });

    const previous = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
    // Number from the highest version ever issued (incl. superseded), so versions never repeat.
    const latestEver = await ProductionContract.findOne({ projectId: project._id }).sort('-version');

    const approvedClaimIds = inputs
      .filter((i) => i.type === 'claim' && i.status === 'approved')
      .map((i) => i._id);
    const approvedAssetIds = assets
      .filter((a) => a.licenseStatus === 'owned' || a.licenseStatus === 'licensed')
      .map((a) => a._id);

    const contract = await ProductionContract.create({
      projectId: project._id,
      workspaceId: ws._id,
      version: (latestEver?.version || 0) + 1,
      status: 'pending_approval',
      objective: draft.objective,
      audience: draft.audience,
      tone: draft.tone,
      keyMessage: draft.keyMessage,
      callToAction: draft.callToAction,
      approvedClaimIds,
      approvedAssetIds,
      brandRules: draft.brandRules,
      accessibilityRequirements: draft.accessibilityRequirements,
      localisationRequirements: draft.localisationRequirements,
      contentPlan: { outline: draft.contentPlan.outline, script: draft.contentPlan.script, storyboard: [] },
      modelRoutingPlan: draft.modelRoutingPlan,
      budgetLimit: project.budget.amount,
      blockers: draft.blockers,
      requiredApprovals: [],
      createdById: req.user!._id,
    });

    // Only supersede the old contract once its replacement exists, so a failed
    // create can never leave the project without a current contract.
    if (previous) {
      previous.status = 'superseded';
      await previous.save();
    }

    const approvers = requiredApproversFor(project, ws.members.filter((m) => m.status === 'active').map((m) => ({ userId: m.userId, role: m.role })));
    contract.requiredApprovals = approvers.map((a) => ({
      userId: a.userId as never,
      role: a.role,
      status: 'pending',
    }));
    await contract.save();

    project.status = 'contract_review';
    await project.save();

    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'contract.create',
      entityType: 'production_contract',
      entityId: contract._id.toString(),
      after: { version: contract.version, status: contract.status, blockers: contract.blockers },
      metadata: { source, model },
      ipAddress: clientIp(req),
    });

    res.status(201).json({ contract, aiSource: source, model });
  })
);

projectsRouter.get(
  '/:id/contract',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const contract = await ProductionContract.findOne({ projectId: req.project!._id, status: { $ne: 'superseded' } })
      .sort('-version')
      .populate('requiredApprovals.userId', 'name email')
      .populate('approvedClaimIds', 'title content')
      .populate('approvedAssetIds', 'name licenseStatus fileUrl');
    const history = await ProductionContract.find({ projectId: req.project!._id })
      .select('version status createdAt approvedAt')
      .sort('-version');

    let payload: unknown = contract;
    if (contract) {
      // Blockers reflect CURRENT project state, not the frozen generation snapshot.
      const { inputs, conflicts, assets } = await projectContext(req.project!._id);
      const live = computeReadiness({ project: req.project!, inputs, conflicts, assets, contract });
      const contractPayload = contract.toObject() as unknown as Record<string, unknown>;
      const approvedAssetIds = Array.isArray(contractPayload.approvedAssetIds)
        ? contractPayload.approvedAssetIds.map((asset) => {
            const value = asset as { _id?: unknown; fileUrl?: string };
            return {
              ...value,
              fileUrl: value._id ? `/api/assets/${String(value._id)}/file` : undefined,
            };
          })
        : [];
      payload = {
        ...contractPayload,
        approvedAssetIds,
        blockers: [
          ...live.blockingIssues.map((b) => b.message),
          ...contract.blockers.filter((c) => c.startsWith('Objective missing') || c.startsWith('Audience missing') || c.startsWith('Budget not set') || c.startsWith('No approved facts')),
        ],
      };
    }
    res.json({ contract: payload, history });
  })
);

/* Contract version diff (spec §12.4) — field-level comparison of two versions. */
function flattenContract(obj: unknown, prefix = '', out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (depth > 4 || obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    out[prefix || 'value'] = obj.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' | ');
    return out;
  }
  if (typeof obj !== 'object') {
    out[prefix || 'value'] = String(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (['_id', '__v', 'createdAt', 'updatedAt', 'projectId', 'workspaceId', 'createdById'].includes(k)) continue;
    flattenContract(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  }
  return out;
}

projectsRouter.get(
  '/:id/contract/diff',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new ApiError(400, 'Query params ?from=<version>&to=<version> are required');
    }
    const [a, b] = await Promise.all([
      ProductionContract.findOne({ projectId: req.project!._id, version: from }),
      ProductionContract.findOne({ projectId: req.project!._id, version: to }),
    ]);
    if (!a || !b) throw new ApiError(404, 'One of those contract versions does not exist');

    const fa = flattenContract(a.toObject());
    const fb = flattenContract(b.toObject());
    const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
    const changes = keys
      .filter((k) => (fa[k] ?? '') !== (fb[k] ?? ''))
      .map((k) => ({ field: k, from: fa[k] ?? '—', to: fb[k] ?? '—' }));

    res.json({
      from: { version: from, status: a.status, createdAt: a.createdAt },
      to: { version: to, status: b.status, createdAt: b.createdAt },
      changes,
      summary:
        changes.length === 0
          ? `Versions ${from} and ${to} are identical.`
          : `${changes.length} field(s) changed between versions ${from} and ${to}.`,
    });
  })
);

const decisionSchema = z.object({ comment: z.string().max(2000).optional() });

projectsRouter.post(
  '/:id/contract/approve',
  requireProject('owner', 'lead', 'reviewer', 'legal_reviewer', 'finance_owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(decisionSchema, req.body);
    const project = req.project!;
    const contract = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
    if (!contract) throw new ApiError(404, 'No contract to approve');
    if (contract.status !== 'pending_approval' && contract.status !== 'rejected') {
      throw new ApiError(409, `Contract is ${contract.status} — no approval needed`);
    }

    const user = req.user!;
    const entry = contract.requiredApprovals.find((a) => a.userId.toString() === user._id.toString());
    if (entry) {
      entry.status = 'approved';
      entry.decidedAt = new Date();
      entry.comment = body.comment;
    } else if (['owner', 'lead', 'reviewer'].includes(req.membershipRole || '')) {
      contract.requiredApprovals.push({
        userId: user._id,
        role: req.membershipRole!,
        status: 'approved',
        decidedAt: new Date(),
        comment: body.comment,
      });
    } else {
      throw new ApiError(403, 'You are not an authorised approver for this contract');
    }

    const allApproved =
      contract.requiredApprovals.some((a) => a.status === 'approved') &&
      !contract.requiredApprovals.some((a) => a.status === 'rejected') &&
      (contract.requiredApprovals.every((a) => a.status === 'approved') || req.membershipRole === 'owner');
    if (allApproved) {
      contract.status = 'approved';
      contract.approvedAt = new Date();
      const liveCtx = await projectContext(project._id);
      const liveReport = computeReadiness({
        project,
        inputs: liveCtx.inputs,
        conflicts: liveCtx.conflicts,
        assets: liveCtx.assets,
        contract,
      });
      project.status = liveReport.blockingIssues.length ? 'blocked' : 'ready';
      await project.save();
    }
    await contract.save();

    audit({
      workspaceId: contract.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'contract.approve',
      entityType: 'production_contract',
      entityId: contract._id.toString(),
      after: { status: contract.status, comment: body.comment },
      ipAddress: clientIp(req),
    });

    res.json({ contract, allApproved });
  })
);

projectsRouter.post(
  '/:id/contract/reject',
  requireProject('owner', 'lead', 'reviewer', 'legal_reviewer', 'finance_owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ comment: z.string().min(3, 'A reason is required').max(2000) }), req.body);
    const project = req.project!;
    const contract = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
    if (!contract) throw new ApiError(404, 'No contract to reject');

    const user = req.user!;
    const entry = contract.requiredApprovals.find((a) => a.userId.toString() === user._id.toString());
    if (entry) {
      entry.status = 'rejected';
      entry.decidedAt = new Date();
      entry.comment = body.comment;
    } else if (['owner', 'lead', 'reviewer'].includes(req.membershipRole || '')) {
      contract.requiredApprovals.push({
        userId: user._id,
        role: req.membershipRole!,
        status: 'rejected',
        decidedAt: new Date(),
        comment: body.comment,
      });
    } else {
      throw new ApiError(403, 'You are not an authorised approver for this contract');
    }

    contract.status = 'rejected';
    await contract.save();
    project.status = 'validation';
    await project.save();

    audit({
      workspaceId: contract.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'contract.reject',
      entityType: 'production_contract',
      entityId: contract._id.toString(),
      before: { status: 'pending_approval' },
      after: { status: 'rejected', comment: body.comment },
      ipAddress: clientIp(req),
    });

    res.json({ contract });
  })
);

/* Lock an approved contract so final generation runs against frozen terms (spec 10.16). */
projectsRouter.post(
  '/:id/contract/lock',
  requireProject('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const contract = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
    if (!contract) throw new ApiError(404, 'No contract to lock');
    if (contract.status !== 'approved') {
      throw new ApiError(409, `Contract is ${contract.status} — only an approved contract can be locked`);
    }

    contract.status = 'locked';
    await contract.save();

    audit({
      workspaceId: contract.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'contract.lock',
      entityType: 'production_contract',
      entityId: contract._id.toString(),
      before: { status: 'approved' },
      after: { status: 'locked' },
      ipAddress: clientIp(req),
    });

    res.json({ contract });
  })
);

/* ---------- activity timeline ---------- */
projectsRouter.get(
  '/:id/activity',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const logs = await AuditLog.find({ projectId: req.project!._id })
      .sort('-createdAt')
      .limit(120)
      .populate('actorId', 'name');
    res.json(
      logs.map((l) => ({
        id: l._id.toString(),
        action: l.action,
        entityType: l.entityType,
        actor: (l.actorId as unknown as { name?: string })?.name || 'system',
        metadata: l.metadata,
        createdAt: l.createdAt,
      }))
    );
  })
);
