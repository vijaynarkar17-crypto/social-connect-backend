import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
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
import { seedDemoClips } from './services/seedDemoClips.js';
import { seedAdminUser } from './services/seedAdmin.js';
import { clearBrokenLocalProfileImages, deleteBrokenLocalMediaPosts } from './services/clearBrokenUploads.js';
import { connectRedis } from './services/redis.js';

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

const allowedOrigins = [
  frontendUrl,
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

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many attempts. Wait a minute and try again.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100 });

app.use(passport.initialize());
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Social Connect Backend is Running',
    health: '/health',
  });
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth', authLimiter, googleAuthRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/posts', apiLimiter, postRoutes);
app.use('/api/notifications', apiLimiter, notificationRoutes);
app.use('/api/search', apiLimiter, searchRoutes);
app.use('/api/gifs', apiLimiter, gifRoutes);
app.use('/api/messages', apiLimiter, messageRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);

app.use(errorHandler);

io.on('connection', (socket) => {
  socket.on('join', (room: string) => socket.join(room));
});

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
    await seedDemoClips();
    server.listen(PORT, () => {
      console.log(`SocialConnect API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

export { io };
