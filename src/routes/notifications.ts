import { Router } from 'express';
import { Notification } from '../models/Notification.js';
import { FollowRequest } from '../models/FollowRequest.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { resolvePublicUrl } from '../utils/publicUrl.js';
import {
  CACHE_TTL,
  getCachedJson,
  invalidateUserNotifications,
  notificationsCacheKey,
  setCachedJson,
} from '../services/redis.js';

const router = Router();

function mapActor(actor: unknown) {
  if (!actor || typeof actor !== 'object') return undefined;
  const a = actor as { _id?: { toString(): string }; username?: string; avatar?: string; isVerified?: boolean };
  if (!a._id || !a.username) return undefined;
  return {
    id: a._id.toString(),
    username: a.username,
    avatar: resolvePublicUrl(a.avatar),
    isVerified: a.isVerified,
  };
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const cacheKey = notificationsCacheKey(req.userId!);
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const notifications = await Notification.find({ recipient: req.userId })
    .populate('actor', 'username avatar isVerified')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const unreadCount = await Notification.countDocuments({ recipient: req.userId, read: false });

  const followRequestActors = notifications
    .filter((n) => n.type === 'FOLLOW_REQUEST' && n.actor)
    .map((n) => {
      const actor = n.actor as { _id?: { toString(): string } };
      return actor._id?.toString();
    })
    .filter(Boolean) as string[];

  const pendingRequests = followRequestActors.length
    ? await FollowRequest.find({
        following: req.userId,
        follower: { $in: followRequestActors },
        status: 'pending',
      }).lean()
    : [];

  const pendingSet = new Set(pendingRequests.map((r) => r.follower.toString()));

  const payload = {
    notifications: notifications.map((n) => {
      const actor = mapActor(n.actor);
      const actorId =
        n.actor && typeof n.actor === 'object'
          ? (n.actor as { _id?: { toString(): string } })._id?.toString()
          : undefined;

      return {
        id: n._id,
        type: n.type,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt,
        actor,
        targetId: n.targetId?.toString(),
        targetType: n.targetType,
        followRequestPending:
          n.type === 'FOLLOW_REQUEST' && actorId ? pendingSet.has(actorId) : false,
      };
    }),
    unreadCount,
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.notifications);
  res.json(payload);
});

router.post('/:id/read', authenticate, async (req: AuthRequest, res) => {
  await Notification.updateOne({ _id: req.params.id, recipient: req.userId }, { read: true });
  await invalidateUserNotifications(req.userId!);
  res.json({ ok: true });
});

router.post('/read-all', authenticate, async (req: AuthRequest, res) => {
  await Notification.updateMany({ recipient: req.userId, read: false }, { read: true });
  await invalidateUserNotifications(req.userId!);
  res.json({ ok: true });
});

export default router;
