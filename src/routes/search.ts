import { Router } from 'express';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Follow } from '../models/Follow.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { resolvePublicUrl, resolvePublicUrls, withPublicAvatar } from '../utils/publicUrl.js';
import { CACHE_TTL, getCachedJson, getContentCacheVersion, setCachedJson } from '../services/redis.js';

const router = Router();

router.get('/', optionalAuth, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) {
    return res.json({ users: [], posts: [], hashtags: [] });
  }

  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `search:v${cacheVersion}:q${q.toLowerCase()}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User.find({
    $or: [{ username: regex }, { bio: regex }],
    isBanned: false,
  })
    .select('username avatar bio isVerified')
    .limit(10)
    .lean();

  const posts = await Post.find({ content: regex, isHidden: false })
    .populate('author', 'username avatar')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const payload = {
    users: users.map((u) => ({ ...u, id: u._id, avatar: resolvePublicUrl(u.avatar) })),
    posts: posts.map((p) => ({
      id: p._id,
      content: p.content,
      media: resolvePublicUrls(p.media),
      author: withPublicAvatar(p.author as { avatar?: string }),
      createdAt: p.createdAt,
    })),
    hashtags: [`#${q}`, `#${q}Trending`].slice(0, 5),
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.search);
  res.json(payload);
});

router.get('/recommendations', authenticate, async (req: AuthRequest, res) => {
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `recommend:v${cacheVersion}:u${req.userId}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const following = await Follow.find({ follower: req.userId }).select('following');
  const followingIds = following.map((f) => f.following);
  followingIds.push(req.userId! as unknown as import('mongoose').Types.ObjectId);

  const suggestedUsers = await User.find({
    _id: { $nin: followingIds },
    isBanned: false,
  })
    .select('username avatar bio isVerified')
    .limit(8)
    .lean();

  const trendingPosts = await Post.find({ isHidden: false })
    .populate('author', 'username avatar isVerified')
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();

  const trendingTags = ['#TechNews', '#SocialConnect', '#WeekendVibes', '#Creators', '#Clips'];

  const payload = {
    suggestedUsers: suggestedUsers.map((u) => ({ ...u, id: u._id, avatar: resolvePublicUrl(u.avatar) })),
    trendingPosts: trendingPosts.map((p) => ({
      id: p._id,
      content: p.content,
      media: resolvePublicUrls(p.media),
      author: withPublicAvatar(p.author as { avatar?: string }),
      likeCount: p.likes?.length || 0,
    })),
    trendingTags,
  };
  await setCachedJson(cacheKey, payload, CACHE_TTL.trending);
  res.json(payload);
});

export default router;
