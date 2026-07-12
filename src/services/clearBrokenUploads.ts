import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Comment } from '../models/Comment.js';

/**
 * Old uploads on Render disk are gone after redeploy.
 * Clear avatar/cover that still point at /uploads/... so users re-upload to GridFS.
 */
export async function clearBrokenLocalProfileImages(): Promise<number> {
  const [avatars, covers] = await Promise.all([
    User.updateMany({ avatar: { $regex: '/uploads/' } }, { $unset: { avatar: 1 } }),
    User.updateMany({ cover: { $regex: '/uploads/' } }, { $unset: { cover: 1 } }),
  ]);
  return (avatars.modifiedCount || 0) + (covers.modifiedCount || 0);
}

/**
 * Delete image/video/clip posts whose media only lived on ephemeral /uploads/ disk.
 * Those files 404 after Render redeploy and leave empty broken cards in the feed.
 */
export async function deleteBrokenLocalMediaPosts(): Promise<number> {
  const broken = await Post.find({
    type: { $in: ['image', 'video', 'clip'] },
    media: { $elemMatch: { $regex: '/uploads/' } },
  }).select('_id');

  if (!broken.length) return 0;

  const ids = broken.map((p) => p._id);
  await Comment.deleteMany({ post: { $in: ids } });
  await User.updateMany({ savedPosts: { $in: ids } }, { $pullAll: { savedPosts: ids } });
  const result = await Post.deleteMany({ _id: { $in: ids } });
  return result.deletedCount ?? 0;
}
