import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { IUser } from '../models/User.js';
import { User } from '../models/User.js';
import {
  AUTH_USER_TTL,
  authUserCacheKey,
  getCachedJson,
  setCachedJson,
} from '../services/redis.js';

export interface AuthRequest extends Request {
  userId?: string;
  authUser?: IUser;
}

/** Loads the user for a request, using a short-lived Redis cache to avoid a
 *  User.findById on every authenticated call. Returns null if missing/banned. */
async function loadRequestUser(userId: string): Promise<IUser | null> {
  const cacheKey = authUserCacheKey(userId);
  const cached = await getCachedJson<IUser & { isBanned?: boolean }>(cacheKey);
  if (cached) {
    return cached.isBanned ? null : (cached as IUser);
  }

  const user = await User.findById(userId).select('-passwordHash -refreshTokens').lean<IUser>();
  if (!user) return null;
  await setCachedJson(cacheKey, user, AUTH_USER_TTL);
  return user.isBanned ? null : user;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { userId } = verifyAccessToken(token);
    const user = await loadRequestUser(userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    req.userId = userId;
    req.authUser = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();
  try {
    const { userId } = verifyAccessToken(token);
    req.userId = userId;
  } catch {
    // ignore
  }
  next();
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { userId } = verifyAccessToken(token);
    const user = await loadRequestUser(userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });

    req.userId = userId;
    req.authUser = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
