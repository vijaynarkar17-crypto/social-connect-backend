import { Post } from '../models/Post.js';
import { User } from '../models/User.js';

const DEMO_CLIP_VIDEOS = [
  {
    content: 'Sunset vibes 🌅 #travel #clips',
    media: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    shareCount: 34,
    commentCount: 89,
  },
  {
    content: 'Weekend mood ✨ Swipe up for more!',
    media: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    shareCount: 21,
    commentCount: 56,
  },
  {
    content: 'New clip drop 🎬 #socialconnect',
    media: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    shareCount: 67,
    commentCount: 142,
  },
  {
    content: 'POV: scrolling clips all day 📱',
    media: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    shareCount: 12,
    commentCount: 31,
  },
  {
    content: 'Pull down to refresh · Swipe up for next ↓',
    media: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    shareCount: 9,
    commentCount: 28,
  },
];

export async function seedDemoClips() {
  const existing = await Post.countDocuments({ type: 'clip', isHidden: false });
  if (existing > 0) return;

  const users = await User.find().sort({ createdAt: 1 }).limit(3);
  if (users.length === 0) {
    console.log('⊘ No users yet — demo clips will load from the app when the feed is empty');
    return;
  }

  for (let i = 0; i < DEMO_CLIP_VIDEOS.length; i++) {
    const demo = DEMO_CLIP_VIDEOS[i];
    const author = users[i % users.length];
    await Post.create({
      author: author._id,
      type: 'clip',
      content: demo.content,
      media: [demo.media],
      visibility: 'public',
      shareCount: demo.shareCount,
      commentCount: demo.commentCount,
      viewCount: 120 + i * 80,
    });
  }

  console.log(`✓ Seeded ${DEMO_CLIP_VIDEOS.length} demo clips`);
}
