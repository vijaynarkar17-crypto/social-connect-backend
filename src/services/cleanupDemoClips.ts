import { Post } from '../models/Post.js';
import { invalidateContentCache } from './redis.js';

const DEMO_VIDEO_HOST = 'commondatastorage.googleapis.com/gtv-videos-bucket/sample/';

/** Remove legacy sample clips so the feed contains only user uploads. */
export async function removeDemoClips(): Promise<number> {
  const result = await Post.deleteMany({
    type: 'clip',
    media: { $elemMatch: { $regex: DEMO_VIDEO_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
  });

  const removed = result.deletedCount ?? 0;
  if (removed > 0) {
    await invalidateContentCache();
    console.log(`Removed ${removed} legacy demo clip(s)`);
  }
  return removed;
}
