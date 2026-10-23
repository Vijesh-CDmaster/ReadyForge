import { Router } from 'express';
import { Notification } from '../models/Notification';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { asyncHandler, ApiError } from '../http';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

function serialize(n: { _id: unknown; type: string; title: string; message: string; isRead: boolean; link?: string; projectId?: unknown; createdAt: Date }) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    link: n.link,
    projectId: n.projectId ? String(n.projectId) : null,
    createdAt: n.createdAt,
  };
}

notificationsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await Notification.find({ userId: req.user!._id }).sort('-createdAt').limit(100);
    const unread = await Notification.countDocuments({ userId: req.user!._id, isRead: false });
    res.json({ notifications: list.map(serialize), unread });
  })
);

notificationsRouter.patch(
  '/:id/read',
  asyncHandler(async (req: AuthedRequest, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id },
      { isRead: true },
      { new: true }
    );
    if (!n) throw new ApiError(404, 'Notification not found');
    res.json({ notification: serialize(n) });
  })
);

notificationsRouter.patch(
  '/read-all',
  asyncHandler(async (req: AuthedRequest, res) => {
    await Notification.updateMany({ userId: req.user!._id, isRead: false }, { isRead: true });
    res.json({ ok: true });
  })
);
