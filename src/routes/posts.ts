import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Post } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { Follow } from '../models/Follow.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadBuffer } from '../services/cloudinary.js';
import { createNotification } from '../services/notifications.js';
import { Message } from '../models/Message.js';
import { notifyTaggedUsers, notifyCommentMentions } from '../services/mentions.js';
import { runExpiredPostCleanup, notExpiredFilter, DAILY_VIBE_TTL_MS } from '../services/expirePosts.js';
import { formatPostPayload } from '../utils/serializeUser.js';
import { resolvePublicUrls, withPublicAvatar } from '../utils/publicUrl.js';
import {
  getCachedJson,
  getContentCacheVersion,
  invalidateContentCache,
  setCachedJson,
} from '../services/redis.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const createPostSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'story', 'clip']).default('text'),
  content: z.string().max(5000).default(''),
  media: z.array(z.string()).default([]),
  visibility: z.enum(['public', 'friends', 'private']).default('public'),
  storyEffect: z.string().optional(),
  dailyVibe: z.boolean().optional(),
  audio: z.string().optional(),
});

function formatPost(post: Record<string, unknown>, userId?: string) {
  return formatPostPayload(post, userId);
}

router.get('/stories', optionalAuth, async (req: AuthRequest, res) => {
  await runExpiredPostCleanup();

  const baseQuery: Record<string, unknown> = {
    type: 'story',
    isHidden: false,
    expiresAt: { $gt: new Date() },
  };

  if (req.userId) {
    const follows = await Follow.find({ follower: req.userId }).select('following');
    const authorIds = follows.map((f) => f.following);
    authorIds.push(req.userId as unknown as import('mongoose').Types.ObjectId);
    baseQuery.author = { $in: authorIds };
  } else {
    return res.json({ stories: [] });
  }

  const stories = await Post.find(baseQuery)
    .populate('author', 'username avatar isVerified')
    .sort({ createdAt: -1 })
    .lean();

  const grouped: Record<string, { author: unknown; items: unknown[] }> = {};
  for (const s of stories) {
    const authorId = (s.author as unknown as { _id: mongoose.Types.ObjectId })._id?.toString() || String(s.author);
    if (!grouped[authorId]) {
      grouped[authorId] = { author: withPublicAvatar(s.author as { avatar?: string }), items: [] };
    }
    grouped[authorId].items.push({
      id: s._id,
      media: resolvePublicUrls(s.media as string[]),
      storyEffect: s.storyEffect,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    });
  }
  res.json({ stories: Object.values(grouped) });
});

router.get('/clips', optionalAuth, async (req: AuthRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor as string | undefined;
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `clips:v${cacheVersion}:u${req.userId || 'guest'}:l${limit}:c${cursor || 'first'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  const query: Record<string, unknown> = {
    type: 'clip',
    isHidden: false,
    visibility: 'public',
    'media.0': { $exists: true },
  };
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
  await setCachedJson(cacheKey, payload, 45);
  res.json(payload);
});

router.get('/feed', optionalAuth, async (req: AuthRequest, res) => {
  await runExpiredPostCleanup();

  const tab = (req.query.tab as string) || 'latest';
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const cursor = req.query.cursor as string | undefined;
  const cacheVersion = await getContentCacheVersion();
  const cacheKey = `feed:v${cacheVersion}:u${req.userId || 'guest'}:t${tab}:l${limit}:c${cursor || 'first'}`;
  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) return res.json(cached);

  let query: Record<string, unknown> = {
    isHidden: false,
    visibility: 'public',
    type: { $nin: ['story', 'clip'] },
    ...notExpiredFilter(),
  };

  if (tab === 'following' && req.userId) {
    const follows = await Follow.find({ follower: req.userId }).select('following');
    const ids = follows.map((f) => f.following);
    query.author = { $in: ids };
  }

  if (cursor) query.createdAt = { $lt: new Date(cursor) };

  const posts = await Post.find(query)
    .sort({ isPinned: -1, createdAt: -1 })
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
  await setCachedJson(cacheKey, payload, 45);
  res.json(payload);
});

router.post('/', authenticate, validate(createPostSchema), async (req: AuthRequest, res) => {
  const payload: Record<string, unknown> = { ...req.body, author: req.userId, taggedUsers: [] };
  delete payload.dailyVibe;

  if (req.body.type === 'story') {
    payload.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    payload.storyEffect = req.body.storyEffect || 'normal';
    payload.dailyVibe = true;
  } else if (
    req.body.dailyVibe &&
    req.body.type === 'text' &&
    (!Array.isArray(req.body.media) || req.body.media.length === 0)
  ) {
    payload.expiresAt = new Date(Date.now() + DAILY_VIBE_TTL_MS);
    payload.dailyVibe = true;
    if (req.body.audio) payload.audio = req.body.audio;
  }
  const post = await Post.create(payload);
  const taggedIds = await notifyTaggedUsers({
    content: req.body.content,
    authorId: req.userId!,
    postId: post._id.toString(),
  });
  if (taggedIds.length) {
    post.taggedUsers = taggedIds as unknown as import('mongoose').Types.ObjectId[];
    await post.save();
  }
  await post.populate('author', 'username avatar isVerified');
  await post.populate('taggedUsers', 'username avatar');
  await invalidateContentCache();
  res.status(201).json({ post: formatPost(post.toObject() as unknown as Record<string, unknown>, req.userId) });
});

router.post('/upload', authenticate, upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const folder = (req.body.folder as string) || 'posts';
  const url = await uploadBuffer(req.file.buffer, folder, req.file.mimetype);
  res.json({ url, type: req.file.mimetype.startsWith('video/') ? 'video' : 'image' });
});

router.post('/:id/view', optionalAuth, async (req, res) => {
  const post = await Post.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } }, { new: true });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ viewCount: post.viewCount });
});

router.post('/:id/share', authenticate, async (req: AuthRequest, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { recipientId, message } = req.body as { recipientId?: string; message?: string };

  if (recipientId) {
    if (recipientId === req.userId) {
      return res.status(400).json({ error: 'Cannot share with yourself' });
    }
    const recipient = await User.findById(recipientId);
    if (!recipient) return res.status(404).json({ error: 'User not found' });

    await Message.create({
      sender: req.userId,
      recipient: recipientId,
      content: message?.trim() || (post.type === 'clip' ? 'Sent you a clip' : 'Sent you a post'),
      sharedPost: post._id,
    });

    await createNotification({
      recipientId,
      actorId: req.userId,
      type: 'MESSAGE',
      message: post.type === 'clip' ? 'sent you a clip' : 'sent you a post',
      targetId: post._id.toString(),
      targetType: 'message',
    });
  }

  post.shareCount += 1;
  await post.save();
  await invalidateContentCache();

  if (post.author.toString() !== req.userId && recipientId) {
    await createNotification({
      recipientId: post.author.toString(),
      actorId: req.userId,
      type: 'SHARE',
      message: post.type === 'clip' ? 'shared your clip' : 'shared your post',
      targetId: post._id.toString(),
      targetType: 'post',
    });
  }

  res.json({ shareCount: post.shareCount, sent: !!recipientId });
});

router.post('/:id/like', authenticate, async (req: AuthRequest, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const idx = post.likes.findIndex((id) => id.toString() === req.userId);
  const wasLiked = idx >= 0;
  if (wasLiked) post.likes.splice(idx, 1);
  else {
    post.likes.push(req.userId! as unknown as import('mongoose').Types.ObjectId);
    if (post.author.toString() !== req.userId) {
      await createNotification({
        recipientId: post.author.toString(),
        actorId: req.userId,
        type: 'LIKE',
        message: 'liked your post',
        targetId: post._id.toString(),
        targetType: 'post',
      });
    }
  }
  await post.save();
  await invalidateContentCache();
  res.json({ likeCount: post.likes.length, isLiked: !wasLiked });
});

router.post('/:id/comment', authenticate, async (req: AuthRequest, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const comment = await Comment.create({ post: post._id, author: req.userId, content: content.trim() });
  post.commentCount += 1;
  await post.save();
  await invalidateContentCache();
  if (post.author.toString() !== req.userId) {
    await createNotification({
      recipientId: post.author.toString(),
      actorId: req.userId,
      type: 'COMMENT',
      message: 'commented on your post',
      targetId: post._id.toString(),
      targetType: 'post',
    });
  }
  await notifyCommentMentions({
    content: content.trim(),
    authorId: req.userId!,
    postId: post._id.toString(),
  });

  await comment.populate('author', 'username avatar');
  res.status(201).json({ comment, commentCount: post.commentCount });
});

router.get('/:id/comments', async (req, res) => {
  const comments = await Comment.find({ post: req.params.id })
    .populate('author', 'username avatar')
    .sort({ createdAt: 1 })
    .limit(50);
  res.json({ comments });
});

router.get('/:id', optionalAuth, async (req: AuthRequest, res) => {
  const post = await Post.findOne({ _id: req.params.id, isHidden: false })
    .populate('author', 'username avatar isVerified')
    .populate('taggedUsers', 'username avatar')
    .lean();
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post: formatPost(post as Record<string, unknown>, req.userId) });
});

router.post('/:id/save', authenticate, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const postId = req.params.id;
  const idx = user.savedPosts.findIndex((id) => id.toString() === postId);
  if (idx >= 0) user.savedPosts.splice(idx, 1);
  else user.savedPosts.push(postId as unknown as import('mongoose').Types.ObjectId);
  await user.save();
  res.json({ saved: idx < 0 });
});

const reportSchema = z.object({
  reason: z.enum(['spam', 'abuse', 'fake', 'other']),
  description: z.string().min(10, 'Please explain why (at least 10 characters)').max(500),
});
router.post('/:id/report', authenticate, validate(reportSchema), async (req: AuthRequest, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = await Report.findOne({
    reporter: req.userId,
    targetType: 'post',
    targetId: post._id,
  });
  if (existing) return res.status(409).json({ error: 'Already reported' });

  await Report.create({
    reporter: req.userId,
    targetType: 'post',
    targetId: post._id,
    reason: req.body.reason,
    description: req.body.description,
  });
  res.json({ ok: true });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.author.toString() !== req.userId) {
    return res.status(403).json({ error: 'Not your post' });
  }
  await Comment.deleteMany({ post: post._id });
  await post.deleteOne();
  await invalidateContentCache();
  res.json({ ok: true });
});

const editPostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
});
router.put('/:id', authenticate, validate(editPostSchema), async (req: AuthRequest, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.author.toString() !== req.userId) {
    return res.status(403).json({ error: 'Not your post' });
  }
  const { content, visibility } = req.body as z.infer<typeof editPostSchema>;
  if (content !== undefined) {
    post.content = content;
    const taggedIds = await notifyTaggedUsers({
      content,
      authorId: req.userId!,
      postId: post._id.toString(),
    });
    if (taggedIds.length) {
      post.taggedUsers = taggedIds as unknown as import('mongoose').Types.ObjectId[];
    }
  }
  if (visibility !== undefined) post.visibility = visibility;
  await post.save();
  await invalidateContentCache();
  await post.populate('author', 'username avatar isVerified');
  await post.populate('taggedUsers', 'username avatar');
  res.json({ post: formatPost(post.toObject() as unknown as Record<string, unknown>, req.userId) });
});

export default router;
