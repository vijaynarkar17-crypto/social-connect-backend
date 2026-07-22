import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { Server } from 'socket.io';
import passport from 'passport';
import { connectDB } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import googleAuthRoutes from './routes/googleAuth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import gifRoutes from './routes/gifs.js';
import messageRoutes from './routes/messages.js';
import fileRoutes from './routes/files.js';
import adminRoutes from './routes/admin.js';
import { removeDemoAccounts } from './services/notifications.js';
import { startExpiredPostCleanup } from './services/expirePosts.js';
import { seedAdminUser } from './services/seedAdmin.js';
import { clearBrokenLocalProfileImages, deleteBrokenLocalMediaPosts } from './services/clearBrokenUploads.js';
import { connectRedis } from './services/redis.js';
import { removeDemoClips } from './services/cleanupDemoClips.js';
import { setIo } from './services/socket.js';

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
// Optional: deployed admin panel origin (Vercel). Comma-separated list also supported via ADMIN_URLS.
const adminUrls = [
  process.env.ADMIN_URL,
  ...(process.env.ADMIN_URLS || '').split(',').map((s) => s.trim()),
].filter(Boolean) as string[];

const allowedOrigins = [
  frontendUrl,
  ...adminUrls,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
].filter(Boolean) as string[];

function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (/^https:\/\/[\w-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
  callback(null, false);
}

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

app.use(compression());
// Concise request logging: 'dev' locally, 'tiny' in production to limit noise.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many attempts. Wait a minute and try again.' } });
// Stricter limit for admin login to reduce brute-force risk on the public admin URL.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many admin login attempts. Try again in 15 minutes.' },
});

/** Per-route limiters (shared instance was exhausting all APIs when messages/notifications polled). */
function makeApiLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again.' },
  });
}

const usersLimiter = makeApiLimiter(200);
const postsLimiter = makeApiLimiter(200);
const messagesLimiter = makeApiLimiter(180);
const notificationsLimiter = makeApiLimiter(120);
const searchLimiter = makeApiLimiter(100);
const gifsLimiter = makeApiLimiter(60);
const adminLimiter = makeApiLimiter(100);

app.use(passport.initialize());
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Social Connect Backend is Running',
    health: '/health',
  });
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth/admin/login', adminLoginLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth', authLimiter, googleAuthRoutes);
app.use('/api/users', usersLimiter, userRoutes);
app.use('/api/posts', postsLimiter, postRoutes);
app.use('/api/notifications', notificationsLimiter, notificationRoutes);
app.use('/api/search', searchLimiter, searchRoutes);
app.use('/api/gifs', gifsLimiter, gifRoutes);
app.use('/api/messages', messagesLimiter, messageRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);

app.use(errorHandler);

setIo(io);
io.on('connection', (socket) => {
  socket.on('join', (room: string) => socket.join(room));
});

/**
 * Render's free tier spins the service down after ~15 min idle, causing slow
 * cold starts. When KEEP_WARM=true, self-ping /health every 14 min to stay warm.
 */
function startKeepWarm() {
  if (process.env.KEEP_WARM !== 'true') return;
  const base = process.env.RENDER_EXTERNAL_URL || process.env.API_PUBLIC_URL;
  if (!base) return;
  const url = `${base.replace(/\/$/, '')}/health`;
  setInterval(() => {
    fetch(url).catch(() => {
      // Best-effort keep-alive; failures are non-fatal.
    });
  }, 14 * 60 * 1000);
}

connectDB()
  .then(async () => {
    // Redis is an optional cache and must never delay API startup.
    void connectRedis();
    if (process.env.CLEANUP_DEMO_ACCOUNTS === 'true') {
      await removeDemoAccounts();
    }
    const cleared = await clearBrokenLocalProfileImages();
    if (cleared > 0) {
      console.log(`Cleared ${cleared} broken local avatar/cover URL(s) — re-upload required`);
    }
    const removedPosts = await deleteBrokenLocalMediaPosts();
    if (removedPosts > 0) {
      console.log(`Removed ${removedPosts} post(s) with dead /uploads/ media`);
    }
    startExpiredPostCleanup();
    await seedAdminUser();
    await removeDemoClips();
    server.listen(PORT, () => {
      console.log(`SocialConnect API running on http://localhost:${PORT}`);
    });
    startKeepWarm();
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

export { io };
