/** Public base URL for uploaded assets (Render sets RENDER_EXTERNAL_URL automatically). */
export function getPublicApiBase(): string {
  const base =
    process.env.API_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://social-connect-backend-t9nh.onrender.com'
      : `http://localhost:${process.env.PORT || 4000}`);
  return base.replace(/\/$/, '');
}

function extractUploadPath(url: string): string | undefined {
  const apiFile = url.match(/(\/api\/files\/[a-f0-9]{24})/i);
  if (apiFile) return apiFile[1];
  const upload = url.match(/(\/uploads\/[^\s?#]+)/i);
  if (upload) return upload[1];
  return undefined;
}

export function resolvePublicUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  // Ephemeral Render disk paths are gone after redeploy — do not serve them
  const isHosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER_EXTERNAL_URL;
  if (isHosted && url.includes('/uploads/')) return undefined;

  if (/^https?:\/\//i.test(url)) {
    if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) return url;
    const path = extractUploadPath(url);
    if (path) {
      if (isHosted && path.startsWith('/uploads/')) return undefined;
      const base = getPublicApiBase();
      return base ? `${base}${path}` : path;
    }
    return url;
  }

  if (url.startsWith('/')) {
    if (isHosted && url.startsWith('/uploads/')) return undefined;
    const base = getPublicApiBase();
    return base ? `${base}${url}` : url;
  }
  return url;
}

/** Store relative paths in the database; full URLs are resolved on read. */
export function normalizeStoredAssetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) return url;
  const path = extractUploadPath(url);
  return path || url;
}

export function resolvePublicUrls(urls?: string[] | null): string[] {
  if (!urls?.length) return [];
  return urls.map((u) => resolvePublicUrl(u) || u);
}

export function withPublicAvatar<T extends { avatar?: string | null }>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  return { ...obj, avatar: resolvePublicUrl(obj.avatar) };
}
