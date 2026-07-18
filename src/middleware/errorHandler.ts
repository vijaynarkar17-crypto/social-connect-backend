import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Log full details server-side only.
  console.error(err);
  // Never leak internal error messages, stack traces, or DB errors to clients
  // in production — return a generic message instead.
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProd ? 'Internal server error' : err.message || 'Internal server error',
  });
}
