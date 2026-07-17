import { Post } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { User } from '../models/User.js';
import { invalidateContentCache } from './redis.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const DAILY_VIBE_TTL_MS = TWENTY_FOUR_HOURS_MS;

/** Permanent content — never auto-deleted */
const PERMANENT_TYPES = ['image', 'video', 'clip'] as const;

function cutoff24h(): Date {
  return new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
}

/**
 * Hide expired Daily Vibes / stories from feeds.
 * Also hides legacy text posts older than 24h even if flags were never set.
 */
export function notExpiredFilter() {
  const cutoff = cutoff24h();
  return {
    $and: [
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } },
        ],
      },
      {
        $or: [
          { type: { $in: [...PERMANENT_TYPES] } },
          { type: { $nin: ['text', 'story'] } },
          { createdAt: { $gt: cutoff } },
        ],
      },
    ],
  };
}

/** Photos, videos, and clips are permanent — clear mistaken expiry flags */
export async function restorePermanentPosts(): Promise<number> {
  const result = await Post.updateMany(
    { type: { $in: [...PERMANENT_TYPES] } },
    { $unset: { expiresAt: '' }, $set: { dailyVibe: false } }
  );
  return result.modifiedCount;
}

/**
 * Mark every text-only post as a Daily Vibe and set expiresAt = createdAt + 24h.
 * Covers legacy posts that were never flagged.
 */
export async function backfillEphemeralExpiry(): Promise<number> {
  const posts = await Post.find({
    type: 'text',
    $or: [
      { dailyVibe: { $ne: true } },
      { expiresAt: { $exists: false } },
      { expiresAt: null },
    ],
  }).select('_id createdAt');

  if (!posts.length) return 0;

  const ops = posts.map((post) => ({
    updateOne: {
      filter: { _id: post._id },
      update: {
        $set: {
          dailyVibe: true,
          expiresAt: new Date(new Date(post.createdAt).getTime() + TWENTY_FOUR_HOURS_MS),
        },
      },
    },
  }));

  const result = await Post.bulkWrite(ops);
  return result.modifiedCount;
}

/**
 * Delete Daily Vibes / stories that are past expiry OR older than 24 hours.
 * Does NOT touch photos, videos, or clips.
 */
export async function deleteExpiredPosts(): Promise<number> {
  const now = new Date();
  const cutoff = cutoff24h();

  const expired = await Post.find({
    type: { $nin: [...PERMANENT_TYPES] },
    $or: [
      // Flagged ephemeral with past expiresAt
      {
        expiresAt: { $exists: true, $ne: null, $lte: now },
        $or: [{ dailyVibe: true }, { type: 'story' }, { type: 'text' }],
      },
      // Any text Daily Vibe older than 24h (legacy + current)
      {
        type: 'text',
        createdAt: { $lte: cutoff },
      },
      // Stories older than 24h
      {
        type: 'story',
        createdAt: { $lte: cutoff },
      },
    ],
  }).select('_id');

  if (!expired.length) return 0;

  const ids = expired.map((p) => p._id);
  await Comment.deleteMany({ post: { $in: ids } });
  await User.updateMany({ savedPosts: { $in: ids } }, { $pullAll: { savedPosts: ids } });
  const result = await Post.deleteMany({ _id: { $in: ids } });
  return result.deletedCount ?? 0;
}

/** Full cleanup pass — call on feed load and on a timer */
export async function runExpiredPostCleanup(): Promise<number> {
  const restored = await restorePermanentPosts();
  const backfilled = await backfillEphemeralExpiry();
  const deleted = await deleteExpiredPosts();
  if (restored + backfilled + deleted > 0) {
    await invalidateContentCache();
  }
  return deleted;
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function startExpiredPostCleanup() {
  const run = async () => {
    try {
      const count = await runExpiredPostCleanup();
      if (count > 0) console.log(`Removed ${count} expired daily-vibe/story post(s)`);
    } catch (err) {
      console.error('Expired post cleanup failed:', err);
    }
  };

  run();
  return setInterval(run, CLEANUP_INTERVAL_MS);
}
