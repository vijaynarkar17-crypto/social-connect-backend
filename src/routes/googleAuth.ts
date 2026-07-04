import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { signAccessToken, signRefreshToken, setAuthCookies } from '../utils/jwt.js';

const router = Router();

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ $or: [{ googleId: profile.id }, { email: profile.emails?.[0]?.value }] });
          if (!user) {
            const email = profile.emails?.[0]?.value || `${profile.id}@google.local`;
            const baseUsername = (profile.displayName || 'user').replace(/\s+/g, '_').toLowerCase().slice(0, 20);
            let username = baseUsername;
            let i = 1;
            while (await User.findOne({ username })) {
              username = `${baseUsername}${i++}`;
            }
            user = await User.create({
              email,
              username,
              googleId: profile.id,
              avatar: profile.photos?.[0]?.value,
              emailVerified: true,
            });
          } else if (!user.googleId) {
            user.googleId = profile.id;
            await user.save();
          }
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=google` }),
  async (req, res) => {
    const user = req.user as InstanceType<typeof User>;
    const accessToken = signAccessToken(user._id.toString());
    const refreshToken = signRefreshToken(user._id.toString());
    await Session.create({
      userId: user._id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    setAuthCookies(res, accessToken, refreshToken);
    res.redirect(`${process.env.FRONTEND_URL}/home`);
  }
);

export default router;
