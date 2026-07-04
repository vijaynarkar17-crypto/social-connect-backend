import Redis from 'ioredis';
import { config } from '../config';

export const redis = new Redis(config.redisUrl);

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

export const FEED_CACHE_TTL = 300;

export async function getFeedCache(key: string): Promise<string | null> {
  return redis.get(`feed:${key}`);
}

export async function setFeedCache(key: string, value: string): Promise<void> {
  await redis.setex(`feed:${key}`, FEED_CACHE_TTL, value);
}

export async function invalidateFeedCache(userId: string): Promise<void> {
  const keys = await redis.keys(`feed:${userId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function blacklistRefreshToken(token: string, ttlSeconds: number): Promise<void> {
  await redis.setex(`blacklist:${token}`, ttlSeconds, '1');
}

export async function isRefreshTokenBlacklisted(token: string): Promise<boolean> {
  const result = await redis.get(`blacklist:${token}`);
  return result === '1';
}

export async function setUserOnline(userId: string): Promise<void> {
  await redis.setex(`online:${userId}`, 60, '1');
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const result = await redis.get(`online:${userId}`);
  return result === '1';
}
