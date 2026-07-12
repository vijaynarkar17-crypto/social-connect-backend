import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Report } from '../models/Report.js';
import { Comment } from '../models/Comment.js';
import { requireAdmin, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { resolvePublicUrl } from '../utils/publicUrl.js';

const router = Router();

router.use(requireAdmin);

router.get('/stats', async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [openReports, activeUsers, newPosts, bannedUsers, totalUsers, totalPosts] = await Promise.all([
    Report.countDocuments({ status: 'pending' }),
    User.countDocuments({ updatedAt: { $gte: dayAgo }, isBanned: false }),
    Post.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ isBanned: true }),
    User.countDocuments({}),
    Post.countDocuments({ isHidden: false }),
  ]);

  res.json({
    stats: {
      openReports,
      activeUsers,
      newPosts,
      bannedUsers,
      totalUsers,
      totalPosts,
    },
  });
});

router.get('/reports', async (req, res) => {
  const status = (req.query.status as string) || 'pending';
  const filter = status === 'all' ? {} : { status };
  const reports = await Report.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('reporter', 'username email')
    .lean();

  res.json({
    reports: reports.map((r) => ({
      id: r._id.toString(),
      targetType: r.targetType,
      targetId: r.targetId.toString(),
      reason: r.reason,
      description: r.description || '',
      status: r.status,
      createdAt: r.createdAt,
      reporter: r.reporter
        ? {
            id: (r.reporter as { _id: { toString(): string } })._id.toString(),
            username: (r.reporter as { username?: string }).username,
            email: (r.reporter as { email?: string }).email,
          }
        : null,
    })),
  });
});

const reportActionSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
});

router.patch('/reports/:id', validate(reportActionSchema), async (req, res) => {
  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  );
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json({ report: { id: report._id.toString(), status: report.status } });
});

router.get('/users', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const filter: Record<string, unknown> = {};
  if (q) {
    filter.$or = [
      { username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }

  const users = await User.find(filter)
    .select('username email role isBanned isSuspended isVerified createdAt avatar')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    users: users.map((u) => ({
      id: u._id.toString(),
      username: u.username,
      email: u.email,
      role: u.role,
      isBanned: u.isBanned,
      isSuspended: u.isSuspended,
      isVerified: u.isVerified,
      avatar: resolvePublicUrl(u.avatar),
      createdAt: u.createdAt,
    })),
  });
});

const userActionSchema = z.object({
  action: z.enum(['ban', 'unban', 'suspend', 'unsuspend']),
});

router.post('/users/:id/action', validate(userActionSchema), async (req: AuthRequest, res) => {
  const targetId = String(req.params.id);
  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Cannot moderate your own admin account' });
  }

  const user = await User.findById(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot moderate another admin' });
  }

  const { action } = req.body as z.infer<typeof userActionSchema>;
  if (action === 'ban') {
    user.isBanned = true;
    user.isSuspended = false;
  } else if (action === 'unban') {
    user.isBanned = false;
  } else if (action === 'suspend') {
    user.isSuspended = true;
  } else if (action === 'unsuspend') {
    user.isSuspended = false;
  }
  await user.save();

  res.json({
    user: {
      id: user._id.toString(),
      username: user.username,
      isBanned: user.isBanned,
      isSuspended: user.isSuspended,
    },
  });
});

router.get('/posts', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const filter: Record<string, unknown> = {};
  if (q) {
    filter.content = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const posts = await Post.find(filter)
    .sort({ createdAt: -1 })
    .limit(40)
    .populate('author', 'username')
    .lean();

  res.json({
    posts: posts.map((p) => ({
      id: p._id.toString(),
      type: p.type,
      content: p.content,
      isHidden: p.isHidden,
      dailyVibe: !!p.dailyVibe,
      likeCount: (p.likes || []).length,
      createdAt: p.createdAt,
      author: p.author
        ? {
            username: (p.author as { username?: string }).username,
          }
        : null,
    })),
  });
});

const postActionSchema = z.object({
  action: z.enum(['hide', 'unhide', 'delete']),
});

router.post('/posts/:id/action', validate(postActionSchema), async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { action } = req.body as z.infer<typeof postActionSchema>;
  if (action === 'delete') {
    await Comment.deleteMany({ post: post._id });
    await post.deleteOne();
    return res.json({ deleted: true, id: String(req.params.id) });
  }

  post.isHidden = action === 'hide';
  await post.save();
  res.json({ post: { id: post._id.toString(), isHidden: post.isHidden } });
});

export default router;
