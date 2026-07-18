import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { Post, IPost } from '../models/Post.js';
import { Follow } from '../models/Follow.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createNotification } from '../services/notifications.js';
import { emitToUser } from '../services/socket.js';
import { ChatRequest } from '../models/ChatRequest.js';
import { Report } from '../models/Report.js';
import { assertCanSendMessage, getChatAccess, listFollowUsers } from '../services/chatAccess.js';
import { resolvePublicUrl, resolvePublicUrls } from '../utils/publicUrl.js';

const router = Router();

function formatUser(u: { _id: mongoose.Types.ObjectId; username: string; avatar?: string; isVerified?: boolean }) {
  return { id: u._id.toString(), username: u.username, avatar: resolvePublicUrl(u.avatar), isVerified: u.isVerified };
}

function formatSharedPost(post: {
  _id: mongoose.Types.ObjectId;
  type: string;
  content: string;
  media: string[];
  author?: { username: string; avatar?: string };
}) {
  return {
    id: post._id.toString(),
    type: post.type,
    content: post.content,
    media: resolvePublicUrls(post.media || []),
    author: post.author
      ? { username: post.author.username, avatar: resolvePublicUrl(post.author.avatar) }
      : undefined,
  };
}

function defaultShareText(type: string): string {
  if (type === 'clip') return 'Sent you a reel';
  if (type === 'story') return 'Sent you a story';
  if (type === 'video') return 'Sent you a video';
  if (type === 'image') return 'Sent you a photo';
  return 'Sent you a post';
}

router.get('/contacts', authenticate, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();
  const userId = req.userId!;

  const [follows, messagePartners] = await Promise.all([
    Follow.find({ follower: userId })
      .populate('following', 'username avatar isVerified')
      .sort({ createdAt: -1 })
      .limit(50),
    Message.aggregate([
      { $match: { $or: [{ sender: new mongoose.Types.ObjectId(userId) }, { recipient: new mongoose.Types.ObjectId(userId) }] } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$sender', new mongoose.Types.ObjectId(userId)] }, '$recipient', '$sender'],
          },
        },
      },
      { $limit: 50 },
    ]),
  ]);

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
    users.push({ id, username: u.username, avatar: u.avatar, isVerified: u.isVerified });
  }

  const partnerIds = messagePartners.map((p) => p._id).filter((id) => !seen.has(id.toString()));
  if (partnerIds.length > 0) {
    const partners = await User.find({ _id: { $in: partnerIds }, isBanned: false }).select(
      'username avatar isVerified'
    );
    for (const u of partners) {
      const id = u._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      users.push(formatUser(u));
    }
  }

  if (q && q.length >= 1) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const filtered = users.filter((u) => regex.test(u.username));
    const extra = await User.find({ username: regex, isBanned: false, _id: { $ne: userId } })
      .select('username avatar isVerified')
      .limit(12)
      .lean();
    for (const u of extra) {
      const id = u._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      filtered.push(formatUser(u as typeof u & { _id: mongoose.Types.ObjectId }));
    }
    return res.json({ users: filtered.slice(0, 30) });
  }

  res.json({ users: users.slice(0, 30) });
});

router.get('/search', authenticate, async (req: AuthRequest, res) => {
  const tab = (req.query.tab as string) === 'followers' ? 'followers' : 'following';
  const q = (req.query.q as string)?.trim();
  const users = await listFollowUsers(req.userId!, tab, q);
  res.json({ users, tab });
});

router.get('/can-chat/:userId', authenticate, async (req: AuthRequest, res) => {
  const targetId = String(req.params.userId);
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const access = await getChatAccess(req.userId!, targetId);
  res.json(access);
});

router.get('/chat-requests', authenticate, async (req: AuthRequest, res) => {
  const requests = await ChatRequest.find({ recipient: req.userId, status: 'pending' })
    .populate('sender', 'username avatar isVerified')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  res.json({
    requests: requests.map((r) => ({
      id: r._id.toString(),
      sender: formatUser(r.sender as unknown as {
        _id: mongoose.Types.ObjectId;
        username: string;
        avatar?: string;
        isVerified?: boolean;
      }),
      createdAt: r.createdAt,
    })),
  });
});

router.post('/chat-request', authenticate, async (req: AuthRequest, res) => {
  const { recipientId } = req.body as { recipientId?: string };
  if (!recipientId || recipientId === req.userId) {
    return res.status(400).json({ error: 'Invalid recipient' });
  }

  const recipient = await User.findById(recipientId);
  if (!recipient) return res.status(404).json({ error: 'User not found' });

  const access = await getChatAccess(req.userId!, recipientId);
  if (access.canChat) {
    return res.json({ ok: true, canChat: true, message: 'You can already message this user' });
  }

  if (access.isPublic) {
    return res.json({ ok: true, canChat: true, message: 'Public account — start chatting' });
  }

  const existing = await ChatRequest.findOne({
    sender: req.userId,
    recipient: recipientId,
  });

  if (existing?.status === 'pending') {
    return res.json({ ok: true, status: 'pending', message: 'Request already sent' });
  }

  if (existing?.status === 'rejected') {
    existing.status = 'pending';
    await existing.save();
  } else {
    await ChatRequest.findOneAndUpdate(
      { sender: req.userId, recipient: recipientId },
      { sender: req.userId, recipient: recipientId, status: 'pending' },
      { upsert: true, new: true }
    );
  }

  await createNotification({
    recipientId,
    actorId: req.userId!,
    type: 'MESSAGE',
    message: 'requested to chat with you',
    targetType: 'user',
  });

  res.status(201).json({ ok: true, status: 'pending' });
});

router.post('/chat-request/:id/accept', authenticate, async (req: AuthRequest, res) => {
  const request = await ChatRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.recipient.toString() !== req.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  request.status = 'accepted';
  await request.save();

  await createNotification({
    recipientId: request.sender.toString(),
    actorId: req.userId!,
    type: 'MESSAGE',
    message: 'accepted your chat request',
    targetType: 'user',
  });

  res.json({ ok: true, status: 'accepted' });
});

router.post('/chat-request/:id/reject', authenticate, async (req: AuthRequest, res) => {
  const request = await ChatRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.recipient.toString() !== req.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  request.status = 'rejected';
  await request.save();

  res.json({ ok: true, status: 'rejected' });
});

router.get('/conversations', authenticate, async (req: AuthRequest, res) => {
  const userId = new mongoose.Types.ObjectId(req.userId!);

  const rows = await Message.aggregate([
    { $match: { $or: [{ sender: userId }, { recipient: userId }] } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: {
          $cond: [{ $eq: ['$sender', userId] }, '$recipient', '$sender'],
        },
        lastMessage: { $first: '$$ROOT' },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$recipient', userId] }, { $eq: ['$read', false] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { 'lastMessage.createdAt': -1 } },
    { $limit: 50 },
  ]);

  const partnerIds = rows.map((r) => r._id);
  const sharedPostIds = rows
    .map((r) => r.lastMessage.sharedPost)
    .filter(Boolean);

  const [users, sharedPosts] = await Promise.all([
    User.find({ _id: { $in: partnerIds } }).select('username avatar isVerified'),
    sharedPostIds.length
      ? Post.find({ _id: { $in: sharedPostIds } }).select('type content')
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u._id.toString(), u]));
  const postMap = new Map(sharedPosts.map((p) => [p._id.toString(), p]));

  const conversations = rows.map((row) => {
    const partner = userMap.get(row._id.toString());
    const msg = row.lastMessage;
    const shared = msg.sharedPost ? postMap.get(msg.sharedPost.toString()) : null;
    return {
      partner: partner ? formatUser(partner) : { id: row._id.toString(), username: 'Unknown' },
      lastMessage: {
        id: msg._id.toString(),
        content: msg.content,
        read: msg.read,
        createdAt: msg.createdAt,
        isMine: msg.sender.toString() === req.userId,
        sharedPost: shared ? { type: shared.type, content: shared.content } : undefined,
      },
      unreadCount: row.unreadCount,
    };
  });

  res.json({ conversations });
});

router.get('/with/:userId', authenticate, async (req: AuthRequest, res) => {
  const partnerId = String(req.params.userId);
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
  const before = typeof req.query.before === 'string' ? req.query.before.trim() : '';

  const baseFilter: Record<string, unknown> = {
    $or: [
      { sender: req.userId, recipient: partnerId },
      { sender: partnerId, recipient: req.userId },
    ],
    deletedFor: { $nin: [req.userId] },
  };

  if (before && mongoose.Types.ObjectId.isValid(before)) {
    const beforeMsg = await Message.findById(before).select('createdAt');
    if (beforeMsg) {
      baseFilter.createdAt = { $lt: beforeMsg.createdAt };
    }
  }

  const fetched = await Message.find(baseFilter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('sender', 'username avatar')
    .populate({
      path: 'sharedPost',
      select: 'type content media author',
      populate: { path: 'author', select: 'username avatar' },
    })
    .lean();

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;
  const messages = page.reverse();

  if (!before) {
    await Message.updateMany(
      { sender: partnerId, recipient: req.userId, read: false },
      { $set: { read: true } }
    );
  }

  res.json({
    messages: messages.map((m) => {
      const shared = m.sharedPost as unknown as {
        _id: mongoose.Types.ObjectId;
        type: string;
        content: string;
        media: string[];
        author?: { username: string; avatar?: string };
      } | null;

      return {
        id: m._id.toString(),
        content: m.content,
        createdAt: m.createdAt,
        read: m.read,
        isMine: m.sender._id.toString() === req.userId,
        sharedPost: shared ? formatSharedPost(shared) : undefined,
      };
    }),
    hasMore,
    oldestId: messages[0]?._id.toString() ?? null,
  });
});

const sendSchema = z
  .object({
    recipientId: z.string().min(1),
    content: z.string().max(2000).optional(),
    sharedPostId: z.string().optional(),
  })
  .refine((d) => (d.content && d.content.trim().length > 0) || d.sharedPostId, {
    message: 'Message content or shared post required',
  });

router.post('/', authenticate, validate(sendSchema), async (req: AuthRequest, res) => {
  const { recipientId, content, sharedPostId } = req.body as z.infer<typeof sendSchema>;

  if (recipientId === req.userId) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }

  const recipient = await User.findById(recipientId);
  if (!recipient) return res.status(404).json({ error: 'User not found' });

  try {
    await assertCanSendMessage(req.userId!, recipientId);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'CANNOT_MESSAGE';
    if (code === 'CHAT_REQUEST_REQUIRED') {
      return res.status(403).json({ error: 'Send a chat request first', code });
    }
    if (code === 'CHAT_REQUEST_PENDING') {
      return res.status(403).json({ error: 'Chat request pending approval', code });
    }
    if (code === 'CHAT_REQUEST_REJECTED') {
      return res.status(403).json({ error: 'Chat request was declined', code });
    }
    return res.status(403).json({ error: 'Cannot message this user', code });
  }

  let sharedPost: IPost | null = null;
  let messageContent = content?.trim() || '';

  if (sharedPostId) {
    if (!mongoose.Types.ObjectId.isValid(sharedPostId)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    sharedPost = await Post.findById(sharedPostId).populate('author', 'username avatar');
    if (!sharedPost) return res.status(404).json({ error: 'Post not found' });
    if (!messageContent) messageContent = defaultShareText(sharedPost.type);
  }

  if (!messageContent) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const message = await Message.create({
    sender: req.userId,
    recipient: recipientId,
    content: messageContent,
    sharedPost: sharedPost?._id,
  });

  const notifText =
    sharedPost?.type === 'clip'
      ? 'sent you a reel'
      : sharedPost
        ? 'sent you a post'
        : 'sent you a message';

  await createNotification({
    recipientId,
    actorId: req.userId!,
    type: 'MESSAGE',
    message: notifText,
    targetId: message._id.toString(),
    targetType: 'message',
  });

  emitToUser(recipientId, 'message', { from: req.userId });

  const shared = sharedPost as unknown as {
    _id: mongoose.Types.ObjectId;
    type: string;
    content: string;
    media: string[];
    author?: { username: string; avatar?: string };
  } | null;

  res.status(201).json({
    message: {
      id: message._id.toString(),
      content: message.content,
      createdAt: message.createdAt,
      read: false,
      isMine: true,
      sharedPost: shared ? formatSharedPost(shared) : undefined,
    },
  });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const userId = req.userId!;
  const isSender = message.sender.toString() === userId;
  const isRecipient = message.recipient.toString() === userId;

  if (!isSender && !isRecipient) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  if (isSender) {
    await message.deleteOne();
  } else {
    if (!message.deletedFor.some((id) => id.toString() === userId)) {
      message.deletedFor.push(userId as unknown as mongoose.Types.ObjectId);
      await message.save();
    }
  }

  res.json({ ok: true });
});

const reportMessageSchema = z.object({
  reason: z.enum(['spam', 'abuse', 'fake', 'other']),
  description: z.string().min(10, 'Please explain why (at least 10 characters)').max(500),
});

const editMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

router.put('/:id', authenticate, validate(editMessageSchema), async (req: AuthRequest, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.sender.toString() !== req.userId) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  message.content = req.body.content.trim();
  await message.save();

  res.json({
    message: {
      id: message._id.toString(),
      content: message.content,
      createdAt: message.createdAt,
      read: message.read,
      isMine: true,
    },
  });
});

router.post('/:id/report', authenticate, validate(reportMessageSchema), async (req: AuthRequest, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const userId = req.userId!;
  const isParticipant =
    message.sender.toString() === userId || message.recipient.toString() === userId;
  if (!isParticipant) return res.status(403).json({ error: 'Not allowed' });

  const existing = await Report.findOne({
    reporter: userId,
    targetType: 'message',
    targetId: message._id,
  });
  if (existing) return res.status(409).json({ error: 'Already reported' });

  await Report.create({
    reporter: userId,
    targetType: 'message',
    targetId: message._id,
    reason: req.body.reason,
    description: req.body.description,
  });

  res.json({ ok: true });
});

export default router;
