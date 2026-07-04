import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { IUser } from '../models/User.js';
import { User } from '../models/User.js';

export interface AuthRequest extends Request {
  userId?: string;
  authUser?: IUser;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { userId } = verifyAccessToken(token);
    const user = await User.findById(userId).select('-passwordHash -refreshTokens');
    if (!user || user.isBanned) return res.status(401).json({ error: 'Unauthorized' });

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
