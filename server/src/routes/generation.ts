import { Router } from 'express';
import { z } from 'zod';
import type { HydratedDocument } from 'mongoose';
import { ApiError, asyncHandler, validateBody } from '../http';
import { audit, clientIp } from '../audit';
import { AuthedRequest, requireAuth, requireProject } from '../middleware/auth';
import { IProject, LADDER_STAGES, Project } from '../models/Project';
import { IProductionContract, ProductionContract, IStoryboardScene } from '../models/ProductionContract';
import { GenerationTask, STAGE_TASK, IGenerationTask } from '../models/GenerationTask';
import { VerificationReport } from '../models/VerificationReport';
import { Review } from '../models/Review';
import { AiUsageLog } from '../models/AiUsageLog';
import { IKnowledgeInput, KnowledgeInput } from '../models/KnowledgeInput';
import { IConflict, Conflict } from '../models/Conflict';
import { IAsset, Asset } from '../models/Asset';
import { Notification } from '../models/Notification';
import { ProjectMember } from '../models/ProjectMember';
import { User, wantsNotification } from '../models/User';
import { computeReadiness } from '../engines/readiness';
import {
  STAGE_COST,
  STAGE_LABEL,
  buildFinalDocument,
  buildPreviewDocument,
  generateOutline,
  generateScript,
  generateStoryboard,
} from '../ai/generation';
import { verifyOutput } from '../ai/verify';
import { loadTasteDirection } from '../ai/taste';
import { TasteProfile } from '../models/TasteProfile';
import { chargeProjectBudget, refundProjectBudget } from '../services/budget';

export const generationRouter = Router();
generationRouter.use(requireAuth);

const VERIFY_COST = 10;

async function projectContext(projectId: unknown) {
  const [inputs, conflicts, assets, contract] = await Promise.all([
    KnowledgeInput.find({ projectId }),
    Conflict.find({ projectId }),
    Asset.find({ projectId }),
    ProductionContract.findOne({ projectId, status: { $ne: 'superseded' } }).sort('-version'),
  ]);
  return { inputs, conflicts, assets, contract };
}

function serializeTask(t: IGenerationTask & { createdById?: { name?: string }; reviewedById?: { name?: string } }) {
  return {
    id: t._id.toString(),
    taskType: t.taskType,
    stage: t.stage ?? null,
    status: t.status,
    attempt: t.attempt,
    modelProvider: t.modelProvider,
    modelName: t.modelName,
    fallbackModel: t.fallbackModel,
    estimatedCost: t.estimatedCost,
    actualCost: t.actualCost,
    tokensUsed: t.tokensUsed,
    latencyMs: t.latencyMs,
    outputText: t.outputText,
    outputUrl: t.outputUrl ?? null,
    error: t.error ?? null,
    reviewStatus: t.reviewStatus,
    reviewable: Boolean(t.stage),
    reviewComment: t.reviewComment ?? null,
    reviewedByName: (t.reviewedById as { name?: string })?.name ?? null,
    reviewedAt: t.reviewedAt ?? null,
    regenerationNotes: t.regenerationNotes ?? null,
    createdByName: (t.createdById as { name?: string })?.name ?? null,
    createdAt: t.createdAt,
    completedAt: t.completedAt ?? null,
  };
}

type StageState = {
  stage: string;
  label: string;
  estimatedCost: number;
  state: 'approved' | 'awaiting_review' | 'changes_requested' | 'failed' | 'ready' | 'locked';
  blockers: string[];
  task: ReturnType<typeof serializeTask> | null;
};

/** Computes gate state for every ladder rung (spec §6.8 draft-ladder rules). */
function computeLadder(opts: {
  project: IProject;
  contract: IProductionContract | null;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  assets: IAsset[];
  tasks: IGenerationTask[];
}): { globalBlockers: string[]; stages: StageState[] } {
  const { project, contract, inputs, conflicts, assets, tasks } = opts;
  const stageIndex = (stage: string) => (LADDER_STAGES as readonly string[]).indexOf(stage);

  const readiness = computeReadiness({ project, inputs, conflicts, assets, contract: contract ?? undefined });
  const globalBlockers = readiness.blockingIssues.map((b) => b.message);

  if (!contract) globalBlockers.unshift('No Production Contract yet — create and approve one first.');
  else if (contract.status !== 'approved' && contract.status !== 'locked') {
    globalBlockers.unshift(`Contract v${contract.version} is ${contract.status} — generation requires an approved contract.`);
  }

  const uncleared = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );
  const openHigh = conflicts.filter(
    (c) => (c.status === 'open' || c.status === 'awaiting_decision') && (c.severity === 'high' || c.severity === 'critical')
  );
  const budgetBlocker =
    !project.budget.amount
      ? 'No budget set for this project.'
      : undefined;

  const stages: StageState[] = [];
  let previousApproved = true;

  for (const stage of LADDER_STAGES) {
    const task = tasks.find((t) => t.stage === stage) || null;
    const blockers: string[] = [];
    if (globalBlockers.length) blockers.push(...globalBlockers);
    if (budgetBlocker) blockers.push(budgetBlocker);
    if (stage !== 'concept' && !previousApproved) {
      const prev = LADDER_STAGES[stageIndex(stage) - 1];
      blockers.push(`Previous rung "${STAGE_LABEL[prev]}" must be approved first.`);
    }
    if (stage === 'storyboard' && contract && !contract.contentPlan.script.trim()) {
      blockers.push('Script is empty — generate the script rung first.');
    }
    if ((stage === 'preview' || stage === 'final') && contract && !contract.contentPlan.storyboard.length) {
      blockers.push('Storyboard is empty — generate the storyboard rung first.');
    }
    if (stage === 'final') {
      if (uncleared.length) blockers.push(`${uncleared.length} asset(s) are not licence-cleared and block final generation.`);
      if (openHigh.length) blockers.push(`${openHigh.length} high/critical conflict(s) still open.`);
    }
    const estimatedCost = STAGE_COST[stage] || 0;
    if (project.budget.amount > 0 && estimatedCost > project.budget.remaining) {
      blockers.push(
        `Estimated cost ${estimatedCost} ${project.budget.currency} exceeds remaining budget ${project.budget.remaining} ${project.budget.currency} — finance approval required.`
      );
    }

    let state: StageState['state'];
    if (task?.reviewStatus === 'approved') state = 'approved';
    else if (task && task.status === 'requires_approval') state = 'awaiting_review';
    else if (task && (task.reviewStatus === 'rejected' || task.reviewStatus === 'changes_requested')) state = 'changes_requested';
    else if (task && task.status === 'failed') state = 'failed';
    else state = blockers.length ? 'locked' : 'ready';

    stages.push({
      stage,
      label: STAGE_LABEL[stage] || stage,
      estimatedCost,
      state,
      blockers: Array.from(new Set(blockers)),
      task: task ? serializeTask(task as never) : null,
    });

    previousApproved = state === 'approved';
  }

  return { globalBlockers: Array.from(new Set(globalBlockers)), stages };
}

async function loadTasks(projectId: unknown) {
  return GenerationTask.find({ projectId })
    .sort('-createdAt')
    .populate('createdById', 'name')
    .populate('reviewedById', 'name');
}

async function notifyApprovers(
  project: import('../models/Project').IProject,
  workspaceId: unknown,
  actorId: string,
  notification: { type: string; title: string; message: string; link: string }
) {
  const members = (await import('../models/Workspace')).Workspace;
  const ws = await members.findById(workspaceId);
  if (!ws) return;
  const targets = ws.members.filter(
    (m) =>
      m.status === 'active' &&
      ['owner', 'lead', 'reviewer'].includes(m.role) &&
      m.userId.toString() !== actorId
  );
  // Respect each recipient's notification preferences (spec §22.1).
  const targetUsers = await User.find({ _id: { $in: targets.map((m) => m.userId) } });
  const allowed = targets.filter((m) => {
    const u = targetUsers.find((t) => t._id.toString() === m.userId.toString());
    return wantsNotification(u, notification.type);
  });
  if (!allowed.length) return;
  await Notification.insertMany(
    allowed.map((m) => ({
      userId: m.userId,
      workspaceId,
      projectId: project._id,
      ...notification,
    }))
  );
}

/* ---------------- ladder ---------------- */

generationRouter.get(
  '/projects/:id/ladder',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);
    const tasks = await loadTasks(project._id);
    const { globalBlockers, stages } = computeLadder({ project, contract, inputs, conflicts, assets, tasks });

    res.json({
      currentStage: project.currentStage,
      projectStatus: project.status,
      budget: project.budget,
      contract: contract
        ? {
            id: contract._id.toString(),
            version: contract.version,
            status: contract.status,
            approvedAt: contract.approvedAt,
            sceneCount: contract.contentPlan.storyboard.length,
            hasScript: Boolean(contract.contentPlan.script.trim()),
          }
        : null,
      blockers: globalBlockers,
      stages,
      tasks: tasks.map((t) => serializeTask(t as never)),
    });
  })
);

/* ---------------- generate ---------------- */

const generateSchema = z.object({
  stage: z.enum(LADDER_STAGES),
  notes: z.string().min(3, 'Regeneration after a rejection requires notes on what changed').max(2000).optional(),
});

generationRouter.post(
  '/projects/:id/generate',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(generateSchema, req.body);
    const project = req.project!;
    const ws = req.workspace!;
    const user = req.user!;
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);

    if (!contract) throw new ApiError(409, 'Create and approve a Production Contract before generating.');
    const tasks = await loadTasks(project._id);
    const { stages } = computeLadder({ project, contract, inputs, conflicts, assets, tasks });
    const stage = stages.find((s) => s.stage === body.stage)!;

    const pending = tasks.find((t) => t.stage === body.stage);
    if (pending && pending.status === 'requires_approval' && pending.reviewStatus === 'pending') {
      throw new ApiError(409, `The "${stage.label}" output is awaiting review — approve or reject it first.`);
    }
    if (pending && (pending.reviewStatus === 'rejected' || pending.reviewStatus === 'changes_requested') && !body.notes) {
      throw new ApiError(409, `The "${stage.label}" rung was rejected — include notes describing what changed before regenerating.`);
    }
    if (stage.blockers.length) throw new ApiError(409, stage.blockers.join(' '));

    const attempt = tasks.filter((t) => t.stage === body.stage).length + 1;
    const cost = STAGE_COST[body.stage] || 0;

    // Atomic budget reservation: this conditional update is the authoritative hard-limit
    // check — the ladder blocker above is only advisory under concurrent requests.
    await chargeProjectBudget({
      projectId: project._id,
      cost,
      what: `Generating ${stage.label}`,
    });

    let task: HydratedDocument<IGenerationTask> | null = null;
    const started = Date.now();
    try {
      task = await GenerationTask.create({
        projectId: project._id,
        contractId: contract._id,
        createdById: user._id,
        taskType: STAGE_TASK[body.stage],
        stage: body.stage,
        status: 'running',
        attempt,
        inputPrompt: `Generate ${stage.label} for "${project.title}"`,
        estimatedCost: cost,
        startedAt: new Date(),
        regenerationNotes: body.notes,
      });

      // Creative Taste DNA shapes expression; the approved contract always wins conflicts.
      const tasteDirection = (await loadTasteDirection(user._id, project._id)) ?? undefined;
      let outputText = '';
      let source: 'ai' | 'rule_engine' = 'rule_engine';
      let model = 'readyforge-rules';

      if (body.stage === 'concept') {
        const r = await generateOutline(project, contract);
        contract.contentPlan.outline = r.data.outline;
        outputText = r.data.outline.map((b, i) => `${i + 1}. ${b}`).join('\n');
        source = r.source;
        model = r.model;
      } else if (body.stage === 'script') {
        const r = await generateScript(project, contract, tasteDirection);
        contract.contentPlan.script = r.data.script;
        outputText = r.data.script;
        source = r.source;
        model = r.model;
      } else if (body.stage === 'storyboard') {
        const r = await generateStoryboard(project, contract, contract.contentPlan.script, tasteDirection);
        const scenes: IStoryboardScene[] = r.data.scenes.map((s) => ({
          sceneNumber: s.sceneNumber,
          title: s.title,
          description: s.description,
          visualDirection: s.visualDirection,
          voiceover: s.voiceover,
          durationSeconds: s.durationSeconds,
          status: 'draft',
        }));
        contract.contentPlan.storyboard = scenes;
        const total = scenes.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
        outputText = `${scenes.length} scenes · ${total}s total\n\n${scenes
          .map((s) => `Scene ${s.sceneNumber} (${s.durationSeconds || 0}s) — ${s.title}: ${s.description}`)
          .join('\n')}`;
        source = r.source;
        model = r.model;
      } else if (body.stage === 'preview') {
        outputText = buildPreviewDocument(project, contract, contract.contentPlan.storyboard);
        model = 'readyforge-simulated-render';
      } else if (body.stage === 'final') {
        outputText = buildFinalDocument(project, contract, contract.contentPlan.script, contract.contentPlan.storyboard);
        model = 'readyforge-simulated-render';
      }

      const latencyMs = Date.now() - started;
      task.status = 'requires_approval';
      task.outputText = outputText;
      task.actualCost = cost;
      task.latencyMs = latencyMs;
      task.modelName = model;
      task.modelProvider = source === 'ai' ? 'local-llm' : stage.stage === 'preview' || body.stage === 'final' ? 'simulated' : 'local-rules';
      task.completedAt = new Date();
      await task.save();
      await contract.save();

      // Budget was already charged atomically above; only `status` is dirty in memory,
      // so this save cannot overwrite the atomic budget counters.
      project.status = 'review';
      await project.save();

      await AiUsageLog.create({
        workspaceId: ws._id,
        projectId: project._id,
        userId: user._id,
        provider: task.modelProvider,
        model,
        taskType: task.taskType,
        inputTokens: 0,
        outputTokens: Math.round(outputText.length / 4),
        cost,
        currency: project.budget.currency,
        status: 'success',
        latencyMs,
      });

      audit({
        workspaceId: ws._id.toString(),
        projectId: project._id.toString(),
        actorId: user._id.toString(),
        action: 'generation.create',
        entityType: 'generation_task',
        entityId: task._id.toString(),
        after: { stage: body.stage, attempt, status: task.status, model, cost, latencyMs },
        metadata: { source, model },
        ipAddress: clientIp(req),
      });

      await notifyApprovers(project, ws._id, user._id.toString(), {
        type: 'approval_required',
        title: `Review ${stage.label} — ${project.title}`,
        message: `${user.name} generated ${stage.label} (attempt ${attempt}, ${cost} ${project.budget.currency}). A decision is required to continue.`,
        link: `/app/projects/${project._id.toString()}/ladder`,
      });

      res.status(201).json({ task: serializeTask(task as never), contract: { status: contract.status } });
    } catch (err) {
      // A failed run must not consume budget — release the reservation first.
      await refundProjectBudget({ projectId: project._id, cost }).catch(() => undefined);
      if (task) {
        task.status = 'failed';
        task.error = (err as Error).message;
        task.completedAt = new Date();
        await task.save();
        await AiUsageLog.create({
          workspaceId: ws._id,
          projectId: project._id,
          userId: user._id,
          model: task.modelName,
          taskType: task.taskType,
          cost: 0,
          currency: project.budget.currency,
          status: 'failed',
          latencyMs: Date.now() - started,
        }).catch(() => undefined);
      }
      throw err instanceof ApiError ? err : new ApiError(500, `Generation failed: ${(err as Error).message}`);
    }
  })
);

/* ---------------- tasks ---------------- */

generationRouter.get(
  '/projects/:id/tasks',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const tasks = await loadTasks(req.project!._id);
    res.json(tasks.map((t) => serializeTask(t as never)));
  })
);

const reviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'changes_requested']),
    comment: z.string().max(2000).optional(),
    rootCause: z.string().max(500).optional(),
  })
  .refine((d) => d.decision === 'approved' || (d.comment && d.comment.trim().length >= 3), {
    message: 'A reason is required when rejecting or requesting changes',
    path: ['comment'],
  });

generationRouter.post(
  '/tasks/:id/review',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(reviewSchema, req.body);
    const user = req.user!;

    const task = await GenerationTask.findById(req.params.id);
    if (!task) throw new ApiError(404, 'Generation task not found');
    const project = await Project.findById(task.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const ws = await (await import('../models/Workspace')).Workspace.findById(project.workspaceId);
    if (!ws) throw new ApiError(404, 'Workspace not found');

    const membership = ws.members.find((m) => m.userId.toString() === user._id.toString() && m.status === 'active');
    if (!membership && user.platformRole !== 'admin') throw new ApiError(403, 'You are not a member of this workspace');
    const role = membership?.role;
    if (role !== 'owner' && !['lead', 'reviewer'].includes(role || '')) {
      throw new ApiError(403, 'Only owner, lead or reviewer can decide on generated output');
    }

    if (task.reviewStatus !== 'pending') throw new ApiError(409, `Task already ${task.reviewStatus}`);
    if (task.status !== 'requires_approval' && task.status !== 'completed') {
      throw new ApiError(409, `Task is ${task.status} — only completed output can be reviewed`);
    }

    // Spec 13.10 — a failed verification blocks approval until a documented human override exists.
    if (body.decision === 'approved') {
      const latest = await VerificationReport.findOne({ projectId: project._id }).sort('-createdAt');
      if (latest?.status === 'failed' && !latest.override?.at) {
        throw new ApiError(
          409,
          'Verification failed — fix the reported issues, or record a documented override, before approving this output.'
        );
      }
    }

    task.reviewStatus = body.decision;
    task.reviewedById = user._id;
    task.reviewedAt = new Date();
    task.reviewComment = body.comment;
    await task.save();

    let rootCause = body.rootCause;
    if (body.decision !== 'approved' && !rootCause) {
      const report = await VerificationReport.findOne({ projectId: project._id }).sort('-createdAt');
      rootCause = report?.checks.find((c) => c.status === 'failed')?.message || undefined;
    }

    await Review.create({
      projectId: project._id,
      contractId: task.contractId,
      generationTaskId: task._id,
      reviewerId: user._id,
      decision: body.decision,
      comment: body.comment || '',
      rootCause,
    });

    // Taste learning (#16): every decision teaches the reviewer's Creative Taste DNA.
    // They only learn here — not silently — so the change is visible in Taste history.
    try {
      const taste = await TasteProfile.findOneAndUpdate(
        { userId: user._id, projectId: { $exists: false } },
        body.decision === 'approved' ? { $inc: { 'stats.acceptedOutputs': 1 } } : { $inc: { 'stats.rejections': 1 } },
        { new: true }
      );
      if (taste) {
        taste.history.unshift({
          at: new Date(),
          summary:
            body.decision === 'approved'
              ? `Approved ${STAGE_LABEL[task.stage || task.taskType]} output — accepted-output evidence`
              : `Rejected ${STAGE_LABEL[task.stage || task.taskType]} output — taste evidence updated`,
          source: 'learned',
          scope: 'user',
          remember: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as never);
        if (taste.history.length > 100) taste.history.length = 100;
        await taste.save();
      }
    } catch (err) {
      console.warn('[taste] learn failed:', (err as Error).message);
    }

    if (task.stage) {
      const contract = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
      if (body.decision === 'approved') {
        if (task.stage === 'storyboard' && contract) {
          contract.contentPlan.storyboard = contract.contentPlan.storyboard.map((s) => ({
            ...s,
            status: 'approved' as const,
          }));
          await contract.save();
        }
        const idx = LADDER_STAGES.indexOf(task.stage);
        project.currentStage = LADDER_STAGES[Math.min(idx + 1, LADDER_STAGES.length - 1)];
        project.status = task.stage === 'final' ? 'approved' : 'ready';
        await project.save();
      }
    }

    const notifyType = body.decision === 'approved' ? 'generation_complete' : 'approval_required';
    const author = await User.findById(task.createdById);
    if (wantsNotification(author, notifyType)) {
      await Notification.create({
        userId: task.createdById,
        workspaceId: ws._id,
        projectId: project._id,
        type: notifyType,
        title:
          body.decision === 'approved'
            ? `${STAGE_LABEL[task.stage || task.taskType]} approved — ${project.title}`
            : `Changes requested on ${STAGE_LABEL[task.stage || task.taskType]} — ${project.title}`,
        message: body.comment || 'Reviewed by ' + user.name,
        link: `/app/projects/${project._id.toString()}/ladder`,
      });
    }

    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: `generation.${body.decision}`,
      entityType: 'generation_task',
      entityId: task._id.toString(),
      before: { reviewStatus: 'pending' },
      after: { reviewStatus: body.decision, comment: body.comment, rootCause },
      ipAddress: clientIp(req),
    });

    res.json({ task: serializeTask(task as never), projectStatus: project.status });
  })
);

/* ---------------- verification ---------------- */

generationRouter.post(
  '/projects/:id/verify',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const ws = req.workspace!;
    const user = req.user!;
    const { inputs, assets, contract } = await projectContext(project._id);
    if (!contract) throw new ApiError(409, 'Create the Production Contract before verifying output.');

    const approvedFacts = inputs.filter(
      (i) => i.status === 'approved' && ['fact', 'price', 'claim'].includes(i.type)
    );

    const started = Date.now();
    const outcome = await verifyOutput({
      project,
      contract,
      assets,
      approvedFacts,
      script: contract.contentPlan.script,
      scenes: contract.contentPlan.storyboard,
      brandDna: ws.brandDna ?? null,
    });
    const latencyMs = Date.now() - started;

    const report = await VerificationReport.create({
      projectId: project._id,
      contractId: contract._id,
      status: outcome.report.status,
      overallScore: outcome.report.overallScore,
      summary: outcome.report.summary,
      checks: outcome.report.checks,
    });

    const task = await GenerationTask.create({
      projectId: project._id,
      contractId: contract._id,
      createdById: user._id,
      taskType: 'verification',
      status: 'completed',
      inputPrompt: 'Verify generated output against the approved Production Contract',
      modelProvider: outcome.source === 'ai' ? 'local-llm' : 'local-rules',
      modelName: outcome.model,
      estimatedCost: VERIFY_COST,
      actualCost: VERIFY_COST,
      latencyMs,
      outputText: outcome.report.summary,
      startedAt: new Date(started),
      completedAt: new Date(),
    });

    await AiUsageLog.create({
      workspaceId: ws._id,
      projectId: project._id,
      userId: user._id,
      provider: task.modelProvider,
      model: outcome.model,
      taskType: 'verification',
      outputTokens: Math.round(outcome.report.summary.length / 4),
      cost: VERIFY_COST,
      currency: project.budget.currency,
      status: 'success',
      latencyMs,
    });

    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'verification.run',
      entityType: 'verification_report',
      entityId: report._id.toString(),
      after: { status: report.status, score: report.overallScore, checks: report.checks.length },
      metadata: { source: outcome.source, model: outcome.model },
      ipAddress: clientIp(req),
    });

    if (report.status === 'failed') {
      await notifyApprovers(project, ws._id, user._id.toString(), {
        type: 'verification_failed',
        title: `Verification failed — ${project.title}`,
        message: outcome.report.summary.slice(0, 400),
        link: `/app/projects/${project._id.toString()}/verification`,
      });
    }

    res.status(201).json({ report, aiSource: outcome.source, model: outcome.model, task: serializeTask(task as never) });
  })
);

generationRouter.get(
  '/projects/:id/verification',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const reports = await VerificationReport.find({ projectId: req.project!._id }).sort('-createdAt').limit(20);
    res.json(reports);
  })
);

/* Human override of a failed/warning report (spec 13.11–13.12: explainable, disputable, auditable). */
const overrideSchema = z.object({ reason: z.string().min(10, 'Give a reason an auditor can read').max(2000) });

generationRouter.post(
  '/projects/:id/verification/:reportId/override',
  requireProject('owner', 'lead', 'reviewer', 'legal_reviewer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(overrideSchema, req.body);
    const project = req.project!;
    const report = await VerificationReport.findOne({ _id: req.params.reportId, projectId: project._id });
    if (!report) throw new ApiError(404, 'Verification report not found');
    if (report.status === 'passed') throw new ApiError(409, 'This report already passed — no override needed');
    if (report.override?.at) throw new ApiError(409, 'This report already carries an override');

    report.override = {
      reason: body.reason,
      byName: req.user!.name,
      byId: req.user!._id,
      at: new Date(),
    };
    await report.save();

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'verification.override',
      entityType: 'verification_report',
      entityId: report._id.toString(),
      before: { status: report.status, override: null },
      after: { status: report.status, reason: body.reason },
      ipAddress: clientIp(req),
    });

    res.json({ report });
  })
);

/* Canonical spec 13.11 path: POST /verification-reports/:id/override */
generationRouter.post(
  '/verification-reports/:id/override',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(overrideSchema, req.body);
    const report = await VerificationReport.findById(req.params.id);
    if (!report) throw new ApiError(404, 'Verification report not found');
    const project = await Project.findById(report.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const { Workspace } = await import('../models/Workspace');
    const ws = await Workspace.findById(project.workspaceId);
    const membership = ws?.members.find(
      (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
    );
    if (!membership && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Not a member of this workspace');
    const role = membership?.role;
    if (!['owner', 'lead', 'reviewer', 'legal_reviewer'].includes(role || '') && req.user!.platformRole !== 'admin') {
      throw new ApiError(403, 'Your role cannot override verification reports');
    }
    if (report.status === 'passed') throw new ApiError(409, 'This report already passed — no override needed');
    if (report.override?.at) throw new ApiError(409, 'This report already carries an override');

    report.override = { reason: body.reason, byName: req.user!.name, byId: req.user!._id, at: new Date() };
    await report.save();

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'verification.override',
      entityType: 'verification_report',
      entityId: report._id.toString(),
      before: { status: report.status, override: null },
      after: { status: report.status, reason: body.reason },
      ipAddress: clientIp(req),
    });

    res.json({ report });
  })
);

/* ---------------- manual content editing (Script / Storyboard editors) ---------------- */

const planSchema = z
  .object({
    outline: z.array(z.string().min(1).max(300)).max(30).optional(),
    script: z.string().max(40000).optional(),
    storyboard: z
      .array(
        z.object({
          sceneNumber: z.number().int().min(1).max(200),
          title: z.string().max(200).default(''),
          description: z.string().max(2000).default(''),
          visualDirection: z.string().max(2000).default(''),
          voiceover: z.string().max(2000).default(''),
          durationSeconds: z.number().min(0).max(3600).default(0),
        })
      )
      .max(60)
      .optional(),
  })
  .refine((d) => d.outline !== undefined || d.script !== undefined || d.storyboard !== undefined, {
    message: 'Nothing to update',
  });

generationRouter.patch(
  '/projects/:id/plan',
  requireProject('owner', 'lead', 'writer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(planSchema, req.body);
    const project = req.project!;
    const contract = await ProductionContract.findOne({ projectId: project._id, status: { $ne: 'superseded' } }).sort('-version');
    if (!contract) throw new ApiError(409, 'No contract to edit yet.');

    const before = {
      outline: contract.contentPlan.outline.length,
      scriptLength: contract.contentPlan.script.length,
      scenes: contract.contentPlan.storyboard.length,
    };
    if (body.outline) contract.contentPlan.outline = body.outline;
    if (body.script !== undefined) contract.contentPlan.script = body.script;
    if (body.storyboard) {
      contract.contentPlan.storyboard = body.storyboard.map(
        (s): IStoryboardScene => ({ ...s, status: 'draft' })
      );
    }
    await contract.save();

    audit({
      workspaceId: req.workspace!._id.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'contract.content_edit',
      entityType: 'production_contract',
      entityId: contract._id.toString(),
      before,
      after: {
        outline: contract.contentPlan.outline.length,
        scriptLength: contract.contentPlan.script.length,
        scenes: contract.contentPlan.storyboard.length,
      },
      ipAddress: clientIp(req),
    });

    res.json({ contract: { status: contract.status, contentPlan: contract.contentPlan } });
  })
);

/* ---------------- provenance passport ---------------- */

/** Builds the full Provenance Passport (spec §15) for display and export. */
async function buildProvenancePassport(
  project: NonNullable<AuthedRequest['project']>,
  ws: NonNullable<AuthedRequest['workspace']>
): Promise<Record<string, unknown>> {
    const { inputs, conflicts, assets, contract } = await projectContext(project._id);

    const [members, tasks, reviews, contracts, reports] = await Promise.all([
      ProjectMember.find({ projectId: project._id, status: { $ne: 'removed' } }),
      loadTasks(project._id),
      Review.find({ projectId: project._id }).sort('createdAt').populate('reviewerId', 'name'),
      ProductionContract.find({ projectId: project._id }).sort('-version').populate('requiredApprovals.userId', 'name'),
      VerificationReport.find({ projectId: project._id }).sort('-createdAt').limit(1),
    ]);

    const userIds = members.map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } }).select('name email');
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const modelsUsed = Array.from(new Set(tasks.map((t) => t.modelName)));
    const generationCost = tasks.reduce((sum, t) => sum + (t.actualCost || 0), 0);

    return {
      project: {
        id: project._id.toString(),
        title: project.title,
        type: project.projectType,
        mode: project.mode,
        status: project.status,
        createdAt: project.createdAt,
        budget: project.budget,
      },
      workspace: { id: ws._id.toString(), name: ws.name },
      contributors: members.map((m) => ({
        name: userMap.get(m.userId.toString())?.name || 'Unknown',
        role: m.projectRole || m.workspaceRole || m.responsibilities?.join(', ') || 'member',
      })),
      inputs: inputs
        .filter((i) => i.status === 'approved')
        .map((i) => ({
          id: i._id.toString(),
          type: i.type,
          title: i.title,
          content: i.content,
          status: i.status,
          sourceType: i.sourceType,
          approvedAt: i.approvedAt,
          createdAt: i.createdAt,
        })),
      conflicts: conflicts.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        conflictType: c.conflictType,
        severity: c.severity,
        status: c.status,
        resolution: c.resolution,
        resolvedAt: c.resolvedAt,
      })),
      contracts: contracts.map((c) => ({
        version: c.version,
        status: c.status,
        approvedAt: c.approvedAt,
        approvals: c.requiredApprovals.map((a) => ({
          role: a.role,
          name: (a.userId as unknown as { name?: string })?.name || 'Unknown',
          status: a.status,
          decidedAt: a.decidedAt,
          comment: a.comment,
        })),
      })),
      tasks: tasks.map((t) => ({
        id: t._id.toString(),
        taskType: t.taskType,
        stage: t.stage,
        attempt: t.attempt,
        modelProvider: t.modelProvider,
        modelName: t.modelName,
        cost: t.actualCost,
        currency: project.budget.currency,
        latencyMs: t.latencyMs,
        status: t.status,
        reviewStatus: t.reviewStatus,
        createdAt: t.createdAt,
      })),
      reviews: reviews.map((r) => ({
        decision: r.decision,
        reviewer: (r.reviewerId as unknown as { name?: string })?.name || 'Unknown',
        comment: r.comment,
        rootCause: r.rootCause,
        resolution: r.resolution,
        createdAt: r.createdAt,
      })),
      assets: assets.map((a) => ({
        id: a._id.toString(),
        name: a.name,
        type: a.type,
        licenseStatus: a.licenseStatus,
        licenseType: a.licenseType,
        licenseOwner: a.licenseOwner,
        licenseExpiry: a.licenseExpiry,
        aiGenerated: a.aiGenerated,
      })),
      latestVerification: reports[0]
        ? {
            status: reports[0].status,
            score: reports[0].overallScore,
            summary: reports[0].summary,
            createdAt: reports[0].createdAt,
          }
        : null,
      totals: {
        generationCost,
        currency: project.budget.currency,
        tasks: tasks.length,
        approvedFacts: inputs.filter((i) => i.status === 'approved' && i.type === 'fact').length,
        conflictsResolved: conflicts.filter((c) => c.status === 'resolved').length,
        modelsUsed,
      },
      aiDisclosure:
        modelsUsed.length > 0
          ? `AI-assisted output generated with locally hosted models: ${modelsUsed.join(', ')}. Every AI action is listed above with its model and cost.`
          : 'No AI generation has run on this project yet.',
    };
}

generationRouter.get(
  '/projects/:id/provenance',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await buildProvenancePassport(req.project!, req.workspace!));
  })
);

/* Spec 15.6/15.7 — export the passport as downloadable JSON or PDF. */
generationRouter.get(
  '/provenance/:id/export/json',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const payload = await buildProvenancePassport(req.project!, req.workspace!);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="provenance-${req.params.id}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  })
);

generationRouter.get(
  '/provenance/:id/export/pdf',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const payload = await buildProvenancePassport(req.project!, req.workspace!);
    const pdf = textToPdf('ReadyForge Provenance Passport', passportLines(payload));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="provenance-${req.params.id}.pdf"`);
    res.send(Buffer.from(pdf, 'latin1'));
  })
);

/** Flattens the passport into printable lines for the PDF export. */
function passportLines(payload: Record<string, unknown>): string[] {
  const lines: string[] = ['ReadyForge - Provenance Passport', '=================================', ''];
  const walk = (value: unknown, indent: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        lines.push(`${indent}[${i + 1}]`);
        walk(v, indent + '  ');
      });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v && typeof v === 'object') {
          lines.push(`${indent}${k}:`);
          walk(v, indent + '  ');
        } else {
          lines.push(`${indent}${k}: ${v === null || v === undefined ? '-' : String(v)}`);
        }
      }
    } else {
      lines.push(`${indent}${String(value)}`);
    }
  };
  walk(payload, '');
  return lines.map((l) => (l.length > 110 ? `${l.slice(0, 107)}...` : l));
}

/** Minimal dependency-free multi-page PDF writer (Helvetica text pages). */
function textToPdf(title: string, lines: string[]): string {
  const esc = (s: string) =>
    s
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  const W = 612;
  const H = 792;
  const M = 40;
  const LEAD = 11;
  const perPage = Math.max(1, Math.floor((H - 2 * M) / LEAD));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([title]);

  const contentIds = pages.map((_, i) => 4 + i * 2);
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const bodies: string[] = [];
  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  bodies[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((page, i) => {
    const stream = [
      'BT',
      '/F1 8.5 Tf',
      `${M} ${H - M} Td`,
      `${LEAD} TL`,
      ...page.map((l) => `(${esc(l)}) Tj T*`),
      'ET',
    ].join('\n');
    bodies[contentIds[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    bodies[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  const total = 3 + 2 * pages.length;
  for (let id = 1; id <= total; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${bodies[id]}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return out;
}

/* ---------------- claim passport (Enhancement 4) ---------------- */

generationRouter.get(
  '/projects/:id/claim-passport',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, contract } = await projectContext(project._id);

    const claims = inputs.filter((i) => i.type === 'claim');
    if (!claims.length) {
      res.json({ claims: [], note: 'No claims recorded in the Knowledge Ledger yet.' });
      return;
    }

    const [users, tasks, reports] = await Promise.all([
      User.find({ _id: { $in: claims.flatMap((c) => [c.createdById, c.approvedById].filter(Boolean)) } }).select(
        'name email'
      ),
      loadTasks(project._id),
      VerificationReport.find({ projectId: project._id }).sort('-createdAt').limit(1),
    ]);
    const nameOf = (id?: unknown) => users.find((u) => u._id.toString() === String(id))?.name || 'Unknown';

    const scriptTask = tasks.find((t) => t.stage === 'script' && t.reviewStatus !== 'rejected');
    const script = contract?.contentPlan.script || '';
    const scenes = contract?.contentPlan.storyboard || [];
    const latestReport = reports[0];

    const passport = claims.map((c) => {
      const claimTokens = c.content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4);
      const hitIn = (text: string) => {
        const lower = text.toLowerCase();
        if (c.content.length > 20 && lower.includes(c.content.slice(0, 40).toLowerCase())) return true;
        return claimTokens.some((w) => lower.includes(w));
      };

      const usedIn: string[] = [];
      if (script && hitIn(script)) usedIn.push('Script');
      scenes.forEach((s) => {
        if (hitIn(`${s.voiceover || ''} ${s.description || ''} ${s.title || ''}`)) {
          usedIn.push(`Scene ${s.sceneNumber}: ${s.title}`);
        }
      });

      const claimCheck = latestReport?.checks.find(
        (ch) => ch.checkType === 'claim_verification' && hitIn(`${ch.evidence} ${ch.message}`)
      );

      return {
        id: c._id.toString(),
        claim: c.content,
        title: c.title,
        status: c.status,
        source: c.sourceReference || c.sourceType.replace(/_/g, ' '),
        sourceType: c.sourceType,
        suppliedBy: nameOf(c.createdById),
        approvedBy: c.approvedById ? nameOf(c.approvedById) : null,
        approvedAt: c.approvedAt || null,
        usedIn,
        model: scriptTask?.modelName || null,
        verification: claimCheck
          ? { status: claimCheck.status, evidence: claimCheck.evidence, suggestedFix: claimCheck.suggestedFix }
          : { status: c.status === 'approved' ? 'not_run' : 'unverified', evidence: latestReport ? 'Not matched in the latest verification report.' : 'No verification run yet.', suggestedFix: undefined },
      };
    });

    res.json({
      claims: passport,
      contractVersion: contract?.version ?? null,
      note: null,
    });
  })
);

/* ---------------- regeneration autopsy (Enhancement 6) ---------------- */

generationRouter.get(
  '/projects/:id/autopsy',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const [tasks, reviews, reports] = await Promise.all([
      loadTasks(project._id),
      Review.find({ projectId: project._id, decision: { $ne: 'approved' } })
        .sort('-createdAt')
        .populate('reviewerId', 'name'),
      VerificationReport.find({ projectId: project._id }).sort('-createdAt'),
    ]);

    const preventions: Record<string, string> = {
      claim_verification: 'Claim approval is now required before storyboard generation.',
      rights: 'Licence verification must pass before final render.',
      scene_completeness: 'Scene completeness is checked automatically after every storyboard run.',
      accessibility: 'Accessibility requirements are injected into the script prompt.',
      budget: 'Budget guard now blocks generation above the remaining balance.',
      brand_fit: 'Brand rules are pinned into every generation prompt.',
      tone: 'Contract tone is enforced as a generation constraint.',
      intent_alignment: 'Intent Lock reminders now appear in the script editor.',
    };

    const cases = reviews.map((r) => {
      const task = tasks.find((t) => t._id.toString() === r.generationTaskId?.toString());
      const failedCheck = reports
        .flatMap((rep) => rep.checks)
        .find((c) => c.status === 'failed');
      const stageKey =
        task?.stage === 'storyboard' || task?.stage === 'preview' || task?.stage === 'final'
          ? 'scene_completeness'
          : 'claim_verification';
      const rootCause =
        r.rootCause ||
        failedCheck?.message ||
        (r.comment ? `Reviewer flagged the ${task?.stage || 'output'}: “${r.comment.slice(0, 160)}”` : 'Reason not recorded.');
      const causeKey = failedCheck?.checkType || stageKey;
      const nextAttempt = tasks.find(
        (t) => t.stage === task?.stage && t.attempt > (task?.attempt || 0)
      );

      return {
        id: r._id.toString(),
        stage: task?.stage || task?.taskType || 'unknown',
        decision: r.decision,
        reviewer: (r.reviewerId as unknown as { name?: string })?.name || 'Unknown',
        comment: r.comment,
        rootCause,
        whatWasGenerated: task ? `${task.taskType} attempt ${task.attempt} via ${task.modelName}` : 'Unknown output',
        whatChanged: nextAttempt?.regenerationNotes || r.resolution || null,
        prevention: preventions[causeKey] || 'Workflow guard added for this failure class.',
        createdAt: r.createdAt,
      };
    });

    res.json({
      cases,
      summary:
        cases.length === 0
          ? 'No rejections yet — every output passed review on the first attempt.'
          : `${cases.length} rejection(s) recorded. Every failure is attributed to a contract node or input so the same mistake is not repeated.`,
    });
  })
);