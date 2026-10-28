import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { Comment, CommentEntityType, COMMENT_ENTITY_TYPES } from '../models/Comment';
import { Conflict } from '../models/Conflict';
import { ProductionContract } from '../models/ProductionContract';
import { GenerationTask } from '../models/GenerationTask';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { User, wantsNotification } from '../models/User';
import { Notification } from '../models/Notification';

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

/** Maps an entity to its project so membership checks stay project-scoped. */
async function resolveProject(entityType: CommentEntityType, entityId: Types.ObjectId): Promise<Types.ObjectId> {
  if (entityType === 'project') return entityId;
  let projectId: Types.ObjectId | undefined;
  if (entityType === 'conflict') {
    projectId = (await Conflict.findById(entityId).select('projectId'))?.projectId;
  } else if (entityType === 'contract') {
    projectId = (await ProductionContract.findById(entityId).select('projectId'))?.projectId;
  } else {
    projectId = (await GenerationTask.findById(entityId).select('projectId'))?.projectId;
  }
  if (!projectId) throw new ApiError(404, 'Entity not found');
  return projectId;
}

async function requireProjectMembership(userId: Types.ObjectId, projectId: Types.ObjectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new ApiError(404, 'Project not found');
  const ws = await Workspace.findById(project.workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');
  const member = ws.members.find((m) => m.userId.toString() === userId.toString() && m.status === 'active');
  if (!member && !(await User.exists({ _id: userId, platformRole: 'admin' }))) {
    throw new ApiError(403, 'You are not a member of this project workspace');
  }
  return { project, ws, role: member?.role };
}

function serialize(c: {
  _id: unknown;
  authorId: unknown;
  body: string;
  parentId?: unknown;
  mentions: unknown[];
  createdAt: Date;
}, names: Map<string, { name: string; email: string }>) {
  const authorId = String(c.authorId);
  return {
    id: String(c._id),
    authorId,
    author: names.get(authorId)?.name || 'Unknown user',
    authorEmail: names.get(authorId)?.email || '',
    body: c.body,
    parentId: c.parentId ? String(c.parentId) : null,
    mentionUserIds: c.mentions.map(String),
    createdAt: c.createdAt,
  };
}

/**
 * Resolves @tokens against workspace members: email local-part or a
 * space-insensitive name match (the forms people actually type).
 */
function resolveMentions(
  body: string,
  members: Array<{ userId: Types.ObjectId; name: string; email: string }>
): Types.ObjectId[] {
  const tokens = [...body.matchAll(/@([\w.-]+)/g)].map((m) => m[1].toLowerCase());
  if (!tokens.length) return [];
  const hit = members.filter((m) => {
    const local = m.email.split('@')[0].toLowerCase();
    const compactName = m.name.toLowerCase().replace(/\s+/g, '');
    return tokens.some((t) => t === local || t === compactName || t === m.email.toLowerCase());
  });
  return hit.map((m) => m.userId);
}

commentsRouter.get(
  '/comments/:entityType/:entityId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const entityType = req.params.entityType as CommentEntityType;
    if (!COMMENT_ENTITY_TYPES.includes(entityType)) throw new ApiError(400, 'Unknown entity type');
    if (!Types.ObjectId.isValid(req.params.entityId)) throw new ApiError(400, 'Invalid id');
    const entityId = new Types.ObjectId(req.params.entityId);

    const projectId = await resolveProject(entityType, entityId);
    const { ws } = await requireProjectMembership(req.user!._id, projectId);

    const comments = await Comment.find({ entityType, entityId }).sort('createdAt');
    const memberIds = ws.members.map((m) => m.userId);
    const users = await User.find({ _id: { $in: memberIds } }).select('name email');
    const names = new Map(users.map((u) => [u._id.toString(), { name: u.name, email: u.email }]));

    res.json({ comments: comments.map((c) => serialize(c, names)) });
  })
);

const createSchema = z.object({
  body: z.string().min(1).max(4000),
  parentId: z.string().optional(),
});

commentsRouter.post(
  '/comments/:entityType/:entityId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const entityType = req.params.entityType as CommentEntityType;
    if (!COMMENT_ENTITY_TYPES.includes(entityType)) throw new ApiError(400, 'Unknown entity type');
    if (!Types.ObjectId.isValid(req.params.entityId)) throw new ApiError(400, 'Invalid id');
    const entityId = new Types.ObjectId(req.params.entityId);
    const body = validateBody(createSchema, req.body);

    const projectId = await resolveProject(entityType, entityId);
    const { ws } = await requireProjectMembership(req.user!._id, projectId);

    if (body.parentId) {
      const parent = await Comment.findById(body.parentId);
      if (!parent || parent.entityId.toString() !== entityId.toString()) {
        throw new ApiError(404, 'Parent comment not found');
      }
    }

    const members = await User.find({ _id: { $in: ws.members.filter((m) => m.status === 'active').map((m) => m.userId) } })
      .select('name email notificationPrefs');
    const mentionIds = resolveMentions(
      body.body,
      members.map((m) => ({ userId: m._id, name: m.name, email: m.email }))
    );

    const comment = await Comment.create({
      workspaceId: ws._id,
      projectId,
      entityType,
      entityId,
      authorId: req.user!._id,
      body: body.body,
      parentId: body.parentId,
      mentions: mentionIds,
    });

    // Mention notifications — muted mentions are never created (server-side prefs).
    const mentioned = members.filter(
      (m) => mentionIds.some((id) => id.toString() === m._id.toString()) && m._id.toString() !== req.user!._id.toString()
    );
    for (const m of mentioned) {
      if (!wantsNotification(m, 'mention')) continue;
      void Notification.create({
        userId: m._id,
        workspaceId: ws._id,
        projectId,
        type: 'mention',
        title: `${req.user!.name} mentioned you`,
        message: body.body.slice(0, 200),
        link: `/${entityType === 'project' ? `app/projects/${projectId}` : `app/projects/${projectId}/${entityType === 'contract' ? 'contract' : entityType === 'task' ? 'ladder' : 'conflicts'}`}`,
      }).catch(() => undefined);
    }

    audit({
      workspaceId: ws._id.toString(),
      projectId: projectId.toString(),
      actorId: req.user!._id.toString(),
      action: 'comment.create',
      entityType: 'comment',
      entityId: comment._id.toString(),
      after: { mentions: mentionIds.length },
      ipAddress: clientIp(req),
    });

    const users = await User.find({ _id: { $in: [...ws.members.map((m) => m.userId), req.user!._id] } }).select('name email');
    const names = new Map(users.map((u) => [u._id.toString(), { name: u.name, email: u.email }]));
    res.status(201).json({ comment: serialize(comment, names), mentioned: mentioned.map((m) => m.name) });
  })
);

commentsRouter.delete(
  '/comments/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw new ApiError(400, 'Invalid id');
    const comment = await Comment.findById(req.params.id);
    if (!comment) throw new ApiError(404, 'Comment not found');

    const { ws } = await requireProjectMembership(req.user!._id, comment.projectId!);
    const isAuthor = comment.authorId.toString() === req.user!._id.toString();
    const isOwner = ws.members.some((m) => m.userId.toString() === req.user!._id.toString() && m.role === 'owner');
    if (!isAuthor && !isOwner) throw new ApiError(403, 'Only the author or the workspace owner can delete a comment');

    await Comment.deleteMany({ $or: [{ _id: comment._id }, { parentId: comment._id }] });
    audit({
      workspaceId: ws._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'comment.delete',
      entityType: 'comment',
      entityId: comment._id.toString(),
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);
