import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { validate } from '../middleware/validate.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, setAuthCookies, clearAuthCookies } from '../utils/jwt.js';
import { sendOtpEmail, sendVerifyEmail } from '../services/email.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must include uppercase, lowercase, and number'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

async function createSession(userId: string, refreshToken: string, remember = false) {
  const days = remember ? 30 : 7;
  await Session.create({
    userId,
    refreshToken,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  });
}

router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, username, password } = req.body;
  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) return res.status(400).json({ error: 'Email or username already taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const user = await User.create({ email, username, passwordHash, emailVerifyToken });
  await sendVerifyEmail(email, emailVerifyToken);

  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());
  await createSession(user._id.toString(), refreshToken);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(201).json({
    user: {
      id: user._id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      theme: user.theme,
    },
  });
});

router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password, remember } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() }).maxTimeMS(8000);
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.isBanned) return res.status(403).json({ error: 'Account banned' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = signAccessToken(user._id.toString());
    const refreshToken = signRefreshToken(user._id.toString(), remember);
    await createSession(user._id.toString(), refreshToken, remember);
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        cover: user.cover,
        bio: user.bio,
        theme: user.theme,
        isVerified: user.isVerified,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(503).json({ error: 'Server busy. Please try again.' });
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) await Session.deleteOne({ refreshToken });
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const { userId } = verifyRefreshToken(refreshToken);
    const session = await Session.findOne({ refreshToken, userId });
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const accessToken = signAccessToken(userId);
    const newRefresh = signRefreshToken(userId);
    await Session.deleteOne({ refreshToken });
    await createSession(userId, newRefresh);
    setAuthCookies(res, accessToken, newRefresh);
    res.json({ ok: true });
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  res.json({ user: req.authUser });
});

const forgotSchema = z.object({ email: z.string().email() });
router.post('/forgot-password', validate(forgotSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.json({ ok: true }); // don't reveal

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otpCode = otp;
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  await sendOtpEmail(user.email, otp);
  res.json({ ok: true });
});

const verifyOtpSchema = z.object({ email: z.string().email(), otp: z.string().length(6) });
router.post('/verify-otp', validate(verifyOtpSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || user.otpCode !== req.body.otp || !user.otpExpires || user.otpExpires < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  res.json({ ok: true, resetToken: user._id.toString() });
});

const resetSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
});
router.post('/reset-password', validate(resetSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || user.otpCode !== req.body.otp || !user.otpExpires || user.otpExpires < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.otpCode = undefined;
  user.otpExpires = undefined;
  await user.save();
  res.json({ ok: true });
});

router.get('/verify-email/:token', async (req, res) => {
  const user = await User.findOne({ emailVerifyToken: req.params.token });
  if (!user) return res.status(400).json({ error: 'Invalid token' });
  user.emailVerified = true;
  user.emailVerifyToken = undefined;
  await user.save();
  res.redirect(`${process.env.FRONTEND_URL}/login?verified=1`);
});

export default router;
