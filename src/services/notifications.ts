import { Notification, NotificationType } from '../models/Notification.js';
import mongoose from 'mongoose';

export async function createNotification(opts: {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  message: string;
  targetId?: string;
  targetType?: 'post' | 'user' | 'story' | 'message';
}) {
  if (opts.actorId && opts.actorId === opts.recipientId) return;
  await Notification.create({
    recipient: opts.recipientId,
    actor: opts.actorId,
    type: opts.type,
    message: opts.message,
    targetId: opts.targetId,
    targetType: opts.targetType,
  });
}

export async function removeDemoAccounts() {
  const { User } = await import('../models/User.js');
  const { Post } = await import('../models/Post.js');
  const { Follow } = await import('../models/Follow.js');
  const { Session } = await import('../models/Session.js');

  const demoPatterns = [
    /^test@/i,
    /^demo@/i,
    /gmaill\.com$/i,
    /^demouser/i,
    /^testuser/i,
  ];

  const users = await User.find({});
  const demoUsers = users.filter(
    (u) => demoPatterns.some((p) => p.test(u.email) || p.test(u.username))
  );

  if (demoUsers.length === 0) return;

  const ids = demoUsers.map((u) => u._id);
  await Post.deleteMany({ author: { $in: ids } });
  await Follow.deleteMany({ $or: [{ follower: { $in: ids } }, { following: { $in: ids } }] });
  await Notification.deleteMany({ $or: [{ recipient: { $in: ids } }, { actor: { $in: ids } }] });
  await Session.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  console.log(`✓ Removed ${demoUsers.length} demo account(s)`);
}
