import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Follow } from '../models/Follow.js';
import { FollowRequest } from '../models/FollowRequest.js';
import { getChatAccess } from '../services/chatAccess.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createNotification } from '../services/notifications.js';
import { Notification } from '../models/Notification.js';
import { notExpiredFilter } from '../services/expirePosts.js';
import { Report } from '../models/Report.js';
import { formatPostPayload, serializeUser } from '../utils/serializeUser.js';
import { resolvePublicUrl, normalizeStoredAssetUrl } from '../utils/publicUrl.js';
import { uploadBuffer } from '../services/cloudinary.js';
import {
  CACHE_TTL,
  getCachedJson,
  getContentCacheVersion,
  invalidateAuthUser,
  invalidateContentCache,
  setCachedJson,
} from '../services/redis.js';

const router = Router();
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function getUserStats(userId: string) {
  const [posts, followers, following] = await Promise.all([
    Post.countDocuments({
      author: userId,
      isHidden: false,
      dailyVibe: { $ne: true },
      type: { $in: ['image', 'clip'] },
    }),
    Follow.countDocuments({ following: userId }),
    Follow.countDocuments({ follower: userId }),
  ]);
  return { posts, followers, following };
}

function formatPost(p: Record<string, unknown>, userId?: string) {
  return formatPostPayload(p, userId);
}

const updateSchema = z.object({
  bio: z.string().max(500).optional(),
  links: z.array(z.string().url()).max(5).optional(),
  avatar: z.string().optional(),
  cover: z.string().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  privacy: z.object({
    profileVisibility: z.enum(['public', 'friends', 'private']).optional(),
    onlineStatus: z.enum(['everyone', 'friends', 'nobody']).optional(),
    storyVisibility: z.enum(['public', 'friends', 'private']).optional(),
  }).optional(),
  notificationSettings: z.object({
    likes: z.boolean().optional(),
    comments: z.boolean().optional(),
    follows: z.boolean().optional(),
    messages: z.boolean().optional(),
  }).optional(),
});

router.put('/me', authenticate, validate(updateSchema), async (req: AuthRequest, res) => {
  const body = { ...req.body } as Record<string, unknown>;
  if (typeof body.avatar === 'string') body.avatar = normalizeStoredAssetUrl(body.avatar);
  if (typeof body.cover === 'string') body.cover = normalizeStoredAssetUrl(body.cover);
  const user = await User.findByIdAndUpdate(req.userId, body, { new: true }).select('-passwordHash -refreshTokens');
  await invalidateContentCache();
  await invalidateAuthUser(req.userId!);
  res.json({ user: serializeUser(user!) });
});

router.post('/me/avatar', authenticate, profileUpload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are allowed' });
  }

  const url = await uploadBuffer(req.file.buffer, 'avatars', req.file.mimetype);
  const user = await User.findByIdAndUpdate(req.userId, { avatar: url }, { new: true }).select(
    '-passwordHash -refreshTokens'
  );
  await invalidateContentCache();
  await invalidateAuthUser(req.userId!);
  res.json({ user: serializeUser(user!), url: resolvePublicUrl(url) || url });
});

router.post('/me/cover', authenticate, profileUpload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are allowed' });
  }

  const url = await uploadBuffer(req.file.buffer, 'covers', req.file.mimetype);
  const user = await User.findByIdAndUpdate(req.userId, { cover: url }, { new: true }).select(
    '-passwordHash -refreshTokens'
  );
  await invalidateContentCache();
  await invalidateAuthUser(req.userId!);
  res.json({ user: serializeUser(user!), url: resolvePublicUrl(url) || url });
});

router.get('/mentions/search', authenticate, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 1) return res.json({ users: [] });
  const regex = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const users = await User.find({ username: regex, isBanned: false, _id: { $ne: req.userId } })
    .select('username avatar')
    .limit(8)
    .lean();
  res.json({ users: users.map((u) => ({ id: u._id, username: u.username, avatar: resolvePublicUrl(u.avatar) })) });
});

router.get('/me/share-contacts', authenticate, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();

  const follows = await Follow.find({ follower: req.userId })
    .populate('following', 'username avatar isVerified')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const users: { id: string; username: string; avatar?: string; isVerified?: boolean }[] = [];
  const seen = new Set<string>();

  for (const f of follows) {
    const u = f.following as unknown as {
      _id?: { toString: () => string };
      username: string;
      avatar?: string;
      isVerified?: boolean;
    };
    if (!u?.username) continue;
    const id = u._id?.toString?.() || String(u._id);
    if (seen.has(id)) continue;
    seen.add(id);
    users.push({ id, username: u.username, avatar: resolvePublicUrl(u.avatar), isVerified: u.isVerified });
  }

  if (q && q.length >= 1) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const filtered = users.filter((u) => regex.test(u.username));
    const extra = await User.find({ username: regex, isBanned: false, _id: { $ne: req.userId } })
      .select('username avatar isVerified')
      .limit(12)
      .lean();
    for (const u of extra) {
      const id = u._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        filtered.push({ id, username: u.username, avatar: resolvePublicUrl(u.avatar), isVerified: u.isVerified });
      }
    }
    return res.json({ users: filtered });
  }

  res.json({ users });
});

router.get('/me/saved', authenticate, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId)
    .select('savedPosts')
    .populate({
      path: 'savedPosts',
      match: { isHidden: false },
      populate: [
        { path: 'author', select: 'username avatar isVerified' },
        { path: 'taggedUsers', select: 'username avatar' },
      ],
      options: { sort: { createdAt: -1 } },
    })
    .lean();

  const posts = ((user?.savedPosts as unknown as Record<string, unknown>[]) || [])
    .filter((p) => p && typeof p === 'object' && '_id' in p)
    .map((p) => formatPost(p, req.userId));

  res.json({ posts });
});

router.get('/:username', optionalAuth, async (req: AuthRequest, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `profile:v${cacheVersion}:u${usernameKey}:v${req.userId || 'guest'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username }).select('-passwordHash -refreshTokens -otpCode');
  if (!user) return res.status(404).json({ error: 'User not found' });

  const stats = await getUserStats(user._id.toString());
  let isFollowing = false;
  let followRequestPending = false;
  let chatAccess = null;
  if (req.userId) {
    const follow = await Follow.findOne({ follower: req.userId, following: user._id });
    isFollowing = !!follow;
    if (!isFollowing) {
      const pending = await FollowRequest.findOne({
        follower: req.userId,
        following: user._id,
        status: 'pending',
      });
      followRequestPending = !!pending;
    }
    if (req.userId !== user._id.toString()) {
      chatAccess = await getChatAccess(req.userId, user._id.toString());
    }
  }

  const payload = {
    user: {
      id: user._id,
      username: user.username,
      avatar: resolvePublicUrl(user.avatar),
      cover: resolvePublicUrl(user.cover),
      bio: user.bio,
      links: user.links,
      isVerified: user.isVerified,
      profileVisibility: user.privacy?.profileVisibility || 'public',
      stats,
      isFollowing,
      followRequestPending,
      isOwnProfile: req.userId === user._id.toString(),
      chatAccess,
    },
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.profile);
  res.json(payload);
});

router.get('/:username/posts', optionalAuth, async (req: AuthRequest, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const cursor = req.query.cursor as string | undefined;
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `uprofiles:v${cacheVersion}:u${usernameKey}:posts:v${req.userId || 'guest'}:l${limit}:c${cursor || 'first'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const query: Record<string, unknown> = {
    author: user._id,
    isHidden: false,
    dailyVibe: { $ne: true },
    type: { $in: ['image', 'video'] },
    ...notExpiredFilter(),
  };
  if (cursor) query.createdAt = { $lt: new Date(cursor) };

  const posts = await Post.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('author', 'username avatar isVerified')
    .populate('taggedUsers', 'username avatar')
    .lean();

  const hasMore = posts.length > limit;
  if (hasMore) posts.pop();

  const payload = {
    posts: posts.map((p) => formatPost(p as Record<string, unknown>, req.userId)),
    nextCursor: hasMore ? posts[posts.length - 1]?.createdAt : null,
    hasMore,
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.profile);
  res.json(payload);
});

router.get('/:username/clips', optionalAuth, async (req: AuthRequest, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor as string | undefined;
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `uprofiles:v${cacheVersion}:u${usernameKey}:clips:v${req.userId || 'guest'}:l${limit}:c${cursor || 'first'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const query: Record<string, unknown> = { author: user._id, isHidden: false, type: 'clip' };
  if (cursor) query.createdAt = { $lt: new Date(cursor) };

  const clips = await Post.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('author', 'username avatar isVerified')
    .populate('taggedUsers', 'username avatar')
    .lean();

  const hasMore = clips.length > limit;
  if (hasMore) clips.pop();

  const payload = {
    clips: clips.map((p) => formatPost(p as Record<string, unknown>, req.userId)),
    nextCursor: hasMore ? clips[clips.length - 1]?.createdAt : null,
    hasMore,
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.profile);
  res.json(payload);
});

router.get('/:username/tagged', optionalAuth, async (req: AuthRequest, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const cursor = req.query.cursor as string | undefined;
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `uprofiles:v${cacheVersion}:u${usernameKey}:tagged:v${req.userId || 'guest'}:l${limit}:c${cursor || 'first'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const query: Record<string, unknown> = {
    taggedUsers: user._id,
    isHidden: false,
    type: { $nin: ['story', 'clip'] },
    ...notExpiredFilter(),
  };
  if (cursor) query.createdAt = { $lt: new Date(cursor) };

  const posts = await Post.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('author', 'username avatar isVerified')
    .populate('taggedUsers', 'username avatar')
    .lean();

  const hasMore = posts.length > limit;
  if (hasMore) posts.pop();

  const payload = {
    posts: posts.map((p) => formatPost(p as Record<string, unknown>, req.userId)),
    nextCursor: hasMore ? posts[posts.length - 1]?.createdAt : null,
    hasMore,
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.profile);
  res.json(payload);
});

router.get('/:username/followers', async (req, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `followers:v${cacheVersion}:u${usernameKey}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const follows = await Follow.find({ following: user._id })
    .populate('follower', 'username avatar isVerified bio')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const payload = { users: follows.map((f) => f.follower) };
  await setCachedJson(cacheKey, payload, CACHE_TTL.followers);
  res.json(payload);
});

router.get('/:username/following', async (req, res) => {
  const usernameKey = String(req.params.username || '').toLowerCase();
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `following:v${cacheVersion}:u${usernameKey}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const follows = await Follow.find({ follower: user._id })
    .populate('following', 'username avatar isVerified bio')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const payload = { users: follows.map((f) => f.following) };
  await setCachedJson(cacheKey, payload, CACHE_TTL.followers);
  res.json(payload);
});

router.post('/follow/:userId', authenticate, async (req: AuthRequest, res) => {
  const targetUserId = String(req.params.userId);
  if (targetUserId === req.userId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const target = await User.findById(targetUserId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existingFollow = await Follow.findOne({ follower: req.userId, following: targetUserId });
  if (existingFollow) return res.json({ ok: true, following: true });

  const isPrivate = target.privacy?.profileVisibility === 'private';

  if (isPrivate) {
    const request = await FollowRequest.findOneAndUpdate(
      { follower: req.userId, following: targetUserId },
      { follower: req.userId, following: targetUserId, status: 'pending' },
      { upsert: true, new: true }
    );

    await createNotification({
      recipientId: targetUserId,
      actorId: req.userId,
      type: 'FOLLOW_REQUEST',
      message: 'requested to follow you',
      targetId: request._id.toString(),
      targetType: 'user',
    });

    await invalidateContentCache();
    return res.json({ ok: true, pending: true });
  }

  await Follow.findOneAndUpdate(
    { follower: req.userId, following: targetUserId },
    { follower: req.userId, following: targetUserId },
    { upsert: true }
  );
  await createNotification({
    recipientId: targetUserId,
    actorId: req.userId,
    type: 'FOLLOW',
    message: 'started following you',
    targetId: targetUserId,
    targetType: 'user',
  });
  await invalidateContentCache();
  res.json({ ok: true, following: true });
});

router.post('/follow-requests/:requesterId/accept', authenticate, async (req: AuthRequest, res) => {
  const requesterId = String(req.params.requesterId);
  const request = await FollowRequest.findOne({
    follower: requesterId,
    following: req.userId,
    status: 'pending',
  });

  if (request) {
    request.status = 'accepted';
    await request.save();
  }

  await Follow.findOneAndUpdate(
    { follower: requesterId, following: req.userId },
    { follower: requesterId, following: req.userId },
    { upsert: true }
  );

  await Notification.updateMany(
    {
      recipient: req.userId,
      actor: requesterId,
      type: 'FOLLOW_REQUEST',
    },
    { read: true, message: 'is now following you' }
  );

  await invalidateContentCache();
  res.json({ ok: true });
});

router.post('/follow-requests/:requesterId/follow-back', authenticate, async (req: AuthRequest, res) => {
  const requesterId = String(req.params.requesterId);

  const request = await FollowRequest.findOne({
    follower: requesterId,
    following: req.userId,
    status: 'pending',
  });

  if (request) {
    request.status = 'accepted';
    await request.save();
  }

  await Follow.findOneAndUpdate(
    { follower: requesterId, following: req.userId },
    { follower: requesterId, following: req.userId },
    { upsert: true }
  );

  const alreadyFollowing = await Follow.findOne({ follower: req.userId, following: requesterId });
  if (!alreadyFollowing) {
    await Follow.create({ follower: req.userId, following: requesterId });
    await createNotification({
      recipientId: requesterId,
      actorId: req.userId,
      type: 'FOLLOW',
      message: 'started following you',
      targetId: req.userId,
      targetType: 'user',
    });
  }

  await Notification.updateMany(
    {
      recipient: req.userId,
      actor: requesterId,
      type: 'FOLLOW_REQUEST',
    },
    { read: true, message: 'is now following you' }
  );

  await invalidateContentCache();
  res.json({ ok: true, followedBack: true });
});

router.delete('/follow/:userId', authenticate, async (req: AuthRequest, res) => {
  const targetUserId = String(req.params.userId);
  await Follow.deleteOne({ follower: req.userId, following: targetUserId });
  await FollowRequest.deleteOne({ follower: req.userId, following: targetUserId, status: 'pending' });
  await invalidateContentCache();
  res.json({ ok: true });
});

const reportUserSchema = z.object({
  reason: z.enum(['spam', 'abuse', 'fake', 'other']),
  description: z.string().min(10, 'Please explain why (at least 10 characters)').max(500),
});

router.post('/report/:userId', authenticate, validate(reportUserSchema), async (req: AuthRequest, res) => {
  const targetUserId = String(req.params.userId);
  if (targetUserId === req.userId) {
    return res.status(400).json({ error: 'Cannot report yourself' });
  }

  const target = await User.findById(targetUserId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = await Report.findOne({
    reporter: req.userId,
    targetType: 'user',
    targetId: target._id,
  });
  if (existing) return res.status(409).json({ error: 'Already reported' });

  await Report.create({
    reporter: req.userId,
    targetType: 'user',
    targetId: target._id,
    reason: req.body.reason,
    description: req.body.description,
  });

  res.json({ ok: true });
});

export default router;
