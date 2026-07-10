import { User } from '../models/User.js';

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
