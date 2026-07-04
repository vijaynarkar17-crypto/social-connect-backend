import { Router } from 'express';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Follow } from '../models/Follow.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) {
    return res.json({ users: [], posts: [], hashtags: [] });
  }

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

  res.json({
    users: users.map((u) => ({ ...u, id: u._id })),
    posts: posts.map((p) => ({
      id: p._id,
      content: p.content,
      media: p.media,
      author: p.author,
      createdAt: p.createdAt,
    })),
    hashtags: [`#${q}`, `#${q}Trending`].slice(0, 5),
  });
});

router.get('/recommendations', authenticate, async (req: AuthRequest, res) => {
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

  res.json({
    suggestedUsers: suggestedUsers.map((u) => ({ ...u, id: u._id })),
    trendingPosts: trendingPosts.map((p) => ({
      id: p._id,
      content: p.content,
      media: p.media,
      author: p.author,
      likeCount: p.likes?.length || 0,
    })),
    trendingTags,
  });
});

export default router;
