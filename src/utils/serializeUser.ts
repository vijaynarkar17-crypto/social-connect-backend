import { resolvePublicUrl, resolvePublicUrls, withPublicAvatar } from './publicUrl.js';

export function serializeUser(user: {
  _id?: { toString(): string };
  id?: string;
  email?: string;
  username?: string;
  avatar?: string | null;
  cover?: string | null;
  bio?: string;
  links?: string[];
  theme?: string;
  isVerified?: boolean;
  role?: string;
  privacy?: unknown;
  notificationSettings?: unknown;
}) {
  return {
    id: user._id?.toString() || user.id,
    email: user.email,
    username: user.username,
    avatar: resolvePublicUrl(user.avatar),
    cover: resolvePublicUrl(user.cover),
    bio: user.bio,
    links: user.links,
    theme: user.theme,
    isVerified: user.isVerified,
    role: user.role || 'user',
    privacy: user.privacy,
    notificationSettings: user.notificationSettings,
  };
}

export function formatPostPayload(post: Record<string, unknown>, userId?: string) {
  const likes = (post.likes as string[]) || [];
  const author = post.author as { username: string; avatar?: string; isVerified?: boolean };
  const tagged = (post.taggedUsers as { _id?: string; username?: string; avatar?: string }[]) || [];
  return {
    id: String(post._id ?? post.id ?? ''),
    type: post.type,
    content: post.content,
    media: resolvePublicUrls(post.media as string[]),
    likeCount: likes.length,
    commentCount: post.commentCount ?? 0,
    viewCount: post.viewCount ?? 0,
    shareCount: post.shareCount ?? 0,
    isLiked: userId ? likes.some((id) => id.toString() === userId) : false,
    isPinned: post.isPinned,
    visibility: post.visibility,
    expiresAt: post.expiresAt || null,
    dailyVibe: !!post.dailyVibe,
    audio: resolvePublicUrl(post.audio as string | undefined),
    createdAt: post.createdAt,
    author: withPublicAvatar(author),
    taggedUsers: tagged.map((u) =>
      typeof u === 'object' && u !== null && 'username' in u
        ? { id: u._id, username: u.username, avatar: resolvePublicUrl(u.avatar) }
        : u
    ),
  };
}
