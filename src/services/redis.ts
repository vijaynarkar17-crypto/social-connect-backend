import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let ready = false;

/** Cache lifetimes in seconds. Content mutations bump a global version so these
 *  can be generous without serving stale data on writes. */
export const CACHE_TTL = {
  feed: 300, // 5 min
  clips: 300, // 5 min
  profile: 600, // 10 min
  stories: 120, // 2 min
  followers: 120, // 2 min
  search: 60, // 1 min
  trending: 120, // 2 min
  notifications: 20, // 20 s (per-user, separately invalidated)
} as const;

export async function connectRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('Redis cache disabled (REDIS_URL not set)');
    return;
  }

  try {
    client = createClient({
      url,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries) =>
          retries > 5 ? new Error('Redis reconnect limit reached') : Math.min(retries * 250, 2_000),
      },
    });
    client.on('error', (error) => {
      ready = false;
      console.warn('Redis cache error:', error.message);
    });
    client.on('ready', () => {
      ready = true;
    });
    client.on('end', () => {
      ready = false;
    });
    await client.connect();
    ready = true;
    console.log('Redis cache connected');
  } catch (error) {
    ready = false;
    console.warn(
      'Redis unavailable; continuing without cache:',
      error instanceof Error ? error.message : error
    );
  }
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  if (!client || !ready) return null;
  try {
    const value = await client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!client || !ready) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Cache failures must never fail an API request.
  }
}

export async function deleteCached(key: string): Promise<void> {
  if (!client || !ready) return;
  try {
    await client.del(key);
  } catch {
    // Cache failures must never fail an API request.
  }
}

/** Per-user notification cache is invalidated directly (not via content version)
 *  since notifications change independently of global content mutations. */
export function notificationsCacheKey(userId: string): string {
  return `notif:u${userId}`;
}

export async function invalidateUserNotifications(userId: string): Promise<void> {
  await deleteCached(notificationsCacheKey(userId));
}

/** Short-lived cache of the authenticated user doc to avoid a User.findById on
 *  every authenticated request. Invalidated on profile edits and bans. */
export function authUserCacheKey(userId: string): string {
  return `authuser:u${userId}`;
}

export async function invalidateAuthUser(userId: string): Promise<void> {
  await deleteCached(authUserCacheKey(userId));
}

export const AUTH_USER_TTL = 60;

export async function getContentCacheVersion(): Promise<string> {
  if (!client || !ready) return '0';
  try {
    return (await client.get('content:version')) || '0';
  } catch {
    return '0';
  }
}

export async function invalidateContentCache(): Promise<void> {
  if (!client || !ready) return;
  try {
    await client.incr('content:version');
  } catch {
    // Database mutations remain successful when Redis is unavailable.
  }
}
