/** Public base URL for uploaded assets (Render sets RENDER_EXTERNAL_URL automatically). */
export function getPublicApiBase(): string {
  const base =
    process.env.API_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV !== 'production' ? `http://localhost:${process.env.PORT || 4000}` : '');
  return base.replace(/\/$/, '');
}

export function resolvePublicUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    const base = getPublicApiBase();
    return base ? `${base}${url}` : url;
  }
  return url;
}

export function resolvePublicUrls(urls?: string[] | null): string[] {
  if (!urls?.length) return [];
  return urls.map((u) => resolvePublicUrl(u) || u);
}

export function withPublicAvatar<T extends { avatar?: string | null }>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  return { ...obj, avatar: resolvePublicUrl(obj.avatar) };
}
