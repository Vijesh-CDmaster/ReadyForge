import { Router } from 'express';
import { asyncHandler } from '../http';
import { AuthedRequest, requireAuth, requireProject, requireWorkspace } from '../middleware/auth';
import { Project } from '../models/Project';
import { GenerationTask } from '../models/GenerationTask';
import { AiUsageLog } from '../models/AiUsageLog';
import { Conflict } from '../models/Conflict';
import { VerificationReport } from '../models/VerificationReport';
import { Review } from '../models/Review';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

/** Aggregates the analytics the dashboard needs (spec §13). */
async function aggregate(workspaceId: unknown, projectId?: unknown) {
  const projectFilter = projectId ? { projectId } : {};
  const projects = await Project.find(projectId ? { _id: projectId } : { workspaceId });
  const projectIds = projects.map((p) => p._id);

  const [tasks, usage, conflicts, reports, reviews] = await Promise.all([
    GenerationTask.find({ projectId: { $in: projectIds } }).sort('createdAt'),
    AiUsageLog.find({ workspaceId, ...(projectId ? { projectId } : {}) }).sort('createdAt'),
    Conflict.find({ projectId: { $in: projectIds } }),
    VerificationReport.find({ projectId: { $in: projectIds } }).sort('-createdAt'),
    Review.find({ projectId: { $in: projectIds } }),
  ]);
  void projectFilter;

  const byStatus: Record<string, number> = {};
  projects.forEach((p) => {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  });

  const avgReadiness = projects.length
    ? Math.round(projects.reduce((s, p) => s + (p.readinessScore || 0), 0) / projects.length)
    : 0;

  const totalSpend = usage.reduce((s, u) => s + (u.cost || 0), 0);

  const spendByModelMap = new Map<string, { cost: number; calls: number }>();
  usage.forEach((u) => {
    const key = u.model;
    const cur = spendByModelMap.get(key) || { cost: 0, calls: 0 };
    cur.cost += u.cost || 0;
    cur.calls += 1;
    spendByModelMap.set(key, cur);
  });

  // spend over the last 14 days (line chart)
  const days: Array<{ date: string; spend: number; tasks: number }> = [];
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    days.push({ date: d.toISOString().slice(0, 10), spend: 0, tasks: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  usage.forEach((u) => {
    const i = dayIndex.get(u.createdAt.toISOString().slice(0, 10));
    if (i !== undefined) days[i].spend += u.cost || 0;
  });
  tasks.forEach((t) => {
    const i = dayIndex.get(t.createdAt.toISOString().slice(0, 10));
    if (i !== undefined) days[i].tasks += 1;
  });

  const genTasks = tasks.filter((t) => t.taskType !== 'verification');
  const approved = genTasks.filter((t) => t.reviewStatus === 'approved');
  const rejected = genTasks.filter((t) => t.reviewStatus === 'rejected' || t.reviewStatus === 'changes_requested');
  const failed = genTasks.filter((t) => t.status === 'failed');
  const firstPass = approved.filter((t) => t.attempt === 1);
  const completedOrReviewed = genTasks.filter((t) => t.status !== 'running' && t.status !== 'queued');

  const conflictTypeCounts: Record<string, number> = {};
  conflicts.forEach((c) => {
    conflictTypeCounts[c.conflictType] = (conflictTypeCounts[c.conflictType] || 0) + 1;
  });

  const modelPerformance = Array.from(spendByModelMap.entries()).map(([model, v]) => {
    const modelTasks = genTasks.filter((t) => t.modelName === model);
    const modelApproved = modelTasks.filter((t) => t.reviewStatus === 'approved');
    const latencies = modelTasks.filter((t) => t.latencyMs > 0).map((t) => t.latencyMs);
    return {
      model,
      calls: v.calls,
      cost: v.cost,
      tasks: modelTasks.length,
      firstPassRate: modelApproved.length
        ? Math.round((modelApproved.filter((t) => t.attempt === 1).length / modelApproved.length) * 100)
        : null,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    };
  });

  const verifyStatuses: Record<string, number> = {};
  reports.forEach((r) => {
    verifyStatuses[r.status] = (verifyStatuses[r.status] || 0) + 1;
  });

  const reviewDecisions: Record<string, number> = {};
  reviews.forEach((r) => {
    reviewDecisions[r.decision] = (reviewDecisions[r.decision] || 0) + 1;
  });

  return {
    projects: {
      total: projects.length,
      byStatus,
      avgReadiness,
      readyToGenerate: projects.filter((p) => p.status === 'ready').length,
    },
    ai: {
      totalSpend,
      currency: projects[0]?.budget.currency || 'INR',
      calls: usage.length,
      spendByModel: Array.from(spendByModelMap.entries()).map(([model, v]) => ({ model, ...v })),
      spendByDay: days,
      modelPerformance,
      failedCalls: usage.filter((u) => u.status === 'failed').length,
    },
    generation: {
      tasks: genTasks.length,
      approved: approved.length,
      rejected: rejected.length,
      failed: failed.length,
      firstPassRate: approved.length ? Math.round((firstPass.length / approved.length) * 100) : null,
      regenerationRate: completedOrReviewed.length
        ? Math.round((genTasks.filter((t) => t.attempt > 1).length / completedOrReviewed.length) * 100)
        : 0,
      avgLatencyMs: genTasks.filter((t) => t.latencyMs > 0).length
        ? Math.round(
            genTasks.filter((t) => t.latencyMs > 0).reduce((s, t) => s + t.latencyMs, 0) /
              genTasks.filter((t) => t.latencyMs > 0).length
          )
        : 0,
    },
    conflicts: {
      total: conflicts.length,
      open: conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision').length,
      resolved: conflicts.filter((c) => c.status === 'resolved').length,
      byType: conflictTypeCounts,
    },
    verification: { runs: reports.length, byStatus: verifyStatuses },
    reviews: reviewDecisions,
  };
}

/* workspace-level analytics */
analyticsRouter.get(
  '/workspaces/:id/analytics',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await aggregate(req.workspace!._id));
  })
);

/* project-level analytics */
analyticsRouter.get(
  '/projects/:id/analytics',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await aggregate(req.workspace!._id, req.project!._id));
  })
);

/* AI usage log (spec page 30: AI usage and cost) */
analyticsRouter.get(
  '/workspaces/:id/ai-usage',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const logs = await AiUsageLog.find({ workspaceId: req.workspace!._id }).sort('-createdAt').limit(100);
    res.json(
      logs.map((l) => ({
        id: l._id.toString(),
        projectId: l.projectId?.toString() || null,
        provider: l.provider,
        model: l.model,
        taskType: l.taskType,
        cost: l.cost,
        currency: l.currency,
        status: l.status,
        latencyMs: l.latencyMs,
        outputTokens: l.outputTokens,
        createdAt: l.createdAt,
      }))
    );
  })
);