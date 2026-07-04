import { Post } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { User } from '../models/User.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const PERMANENT_TYPES = ['image', 'video', 'clip'] as const;

/** Posts with expiresAt in the past (Daily Vibe / stories) */
export function notExpiredFilter() {
  return {
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  };
}

/** Photos, videos, and clips are permanent — clear mistaken expiry flags */
export async function restorePermanentPosts(): Promise<number> {
  const result = await Post.updateMany(
    { type: { $in: PERMANENT_TYPES } },
    { $unset: { expiresAt: '' }, $set: { dailyVibe: false } }
  );
  return result.modifiedCount;
}

/** Backfill expiry only for legacy text daily vibes missing expiresAt */
export async function backfillEphemeralExpiry(): Promise<number> {
  const posts = await Post.find({
    dailyVibe: true,
    type: { $nin: [...PERMANENT_TYPES, 'story'] },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }],
  }).select('_id createdAt');

  if (!posts.length) return 0;

  const ops = posts.map((post) => ({
    updateOne: {
      filter: { _id: post._id },
      update: {
        $set: {
          expiresAt: new Date(new Date(post.createdAt).getTime() + TWENTY_FOUR_HOURS_MS),
          dailyVibe: true,
        },
      },
    },
  }));

  const result = await Post.bulkWrite(ops);
  return result.modifiedCount;
}

export async function deleteExpiredPosts(): Promise<number> {
  const now = new Date();

  const expired = await Post.find({
    expiresAt: { $exists: true, $ne: null, $lte: now },
    $or: [{ dailyVibe: true }, { type: 'story' }],
    type: { $nin: PERMANENT_TYPES },
  }).select('_id');

  if (!expired.length) return 0;

  const ids = expired.map((p) => p._id);
  await Comment.deleteMany({ post: { $in: ids } });
  await User.updateMany({ savedPosts: { $in: ids } }, { $pullAll: { savedPosts: ids } });
  const result = await Post.deleteMany({ _id: { $in: ids } });
  return result.deletedCount ?? 0;
}

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export function startExpiredPostCleanup() {
  const run = async () => {
    try {
      await restorePermanentPosts();
      await backfillEphemeralExpiry();
      const count = await deleteExpiredPosts();
      if (count > 0) console.log(`Removed ${count} expired daily-vibe/story post(s)`);
    } catch (err) {
      console.error('Expired post cleanup failed:', err);
    }
  };

  run();
  return setInterval(run, CLEANUP_INTERVAL_MS);
}
