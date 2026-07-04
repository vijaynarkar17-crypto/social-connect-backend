import { User } from '../models/User.js';
import { Message } from '../models/Message.js';
import { Post } from '../models/Post.js';
import { createNotification } from './notifications.js';

const MENTION_REGEX = /@([a-zA-Z0-9_]{3,30})/g;

export function extractMentions(text: string): string[] {
  const matches = [...text.matchAll(MENTION_REGEX)];
  return [...new Set(matches.map((m) => m[1].toLowerCase()))];
}

export async function resolveMentionedUsers(text: string) {
  const usernames = extractMentions(text);
  if (usernames.length === 0) return [];
  const users = await User.find({ username: { $in: usernames } }).select('_id username');
  return users;
}

export async function notifyTaggedUsers(opts: {
  content: string;
  authorId: string;
  postId: string;
  source?: 'post' | 'comment';
}) {
  const users = await resolveMentionedUsers(opts.content);
  const source = opts.source || 'post';
  const author = await User.findById(opts.authorId).select('username');
  const authorName = author?.username || 'Someone';

  for (const user of users) {
    if (user._id.toString() === opts.authorId) continue;

    const notifMsg =
      source === 'comment'
        ? 'mentioned you in a comment'
        : 'tagged you in a post';

    await createNotification({
      recipientId: user._id.toString(),
      actorId: opts.authorId,
      type: source === 'comment' ? 'MENTION' : 'TAG',
      message: notifMsg,
      targetId: opts.postId,
      targetType: 'post',
    });

    const post = await Post.findById(opts.postId);
    const messageText =
      source === 'comment'
        ? `@${authorName} mentioned you in a comment: "${opts.content.slice(0, 200)}"`
        : `@${authorName} tagged you in a post`;

    await Message.create({
      sender: opts.authorId,
      recipient: user._id,
      content: messageText,
      sharedPost: post?._id,
    });
  }

  return users.map((u) => u._id);
}

export async function notifyCommentMentions(opts: {
  content: string;
  authorId: string;
  postId: string;
}) {
  return notifyTaggedUsers({ ...opts, source: 'comment' });
}
