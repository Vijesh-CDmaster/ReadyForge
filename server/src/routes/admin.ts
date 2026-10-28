import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { asyncHandler, ApiError } from '../http';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project, PROJECT_STATUSES } from '../models/Project';
import { AiUsageLog } from '../models/AiUsageLog';
import { AuditLog } from '../models/AuditLog';

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** Platform-admin gate — spec §26.1. */
function requireAdmin(req: AuthedRequest) {
  if (req.user!.platformRole !== 'admin') throw new ApiError(403, 'Platform admin access required');
}

adminRouter.get(
  '/stats',
  asyncHandler(async (req: AuthedRequest, res) => {
    requireAdmin(req);

    const [users, workspaces, projects, spend, auditTail] = await Promise.all([
      User.countDocuments(),
      Workspace.countDocuments(),
      Project.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      AiUsageLog.aggregate([
        { $group: { _id: null, totalCost: { $sum: '$cost' }, runs: { $sum: 1 }, failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
      ]),
      AuditLog.find().sort('-createdAt').limit(25).select('action entityType actorId createdAt'),
    ]);

    const actorIds = auditTail.map((a) => a.actorId).filter(Boolean);
    const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select('name') : [];
    const nameBy = new Map(actors.map((a) => [a._id.toString(), a.name]));

    const byStatus = new Map(PROJECT_STATUSES.map((s) => [s, 0]));
    for (const row of projects) byStatus.set(row._id, row.count);

    res.json({
      users,
      workspaces,
      projects: { total: projects.reduce((s, p) => s + p.count, 0), byStatus: Object.fromEntries(byStatus) },
      ai: {
        runs: spend[0]?.runs ?? 0,
        failures: spend[0]?.failures ?? 0,
        totalCost: Math.round((spend[0]?.totalCost ?? 0) * 100) / 100,
      },
      recentActivity: auditTail.map((a) => ({
        id: a._id.toString(),
        action: a.action,
        entityType: a.entityType,
        actor: nameBy.get(String(a.actorId)) || a.actorType || 'system',
        at: a.createdAt,
      })),
      note: 'Platform admin view — read-only. Billing and feature flags are roadmap items (see ROADMAP.md).',
    });
  })
);
