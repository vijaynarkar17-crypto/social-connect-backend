import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

const DEFAULT_ADMIN_EMAIL = 'vijaynarkar17@gmail.com';
const DEFAULT_ADMIN_PASSWORD = '12345678';
const DEFAULT_ADMIN_USERNAME = 'admin';

/**
 * Ensure the configured admin account exists with the given password and role.
 */
export async function seedAdminUser(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const username = (process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim();

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    existing.emailVerified = true;
    existing.isBanned = false;
    existing.isSuspended = false;
    await existing.save();
    console.log(`Admin account ready: ${email}`);
    return;
  }

  const usernameTaken = await User.findOne({ username });
  const finalUsername = usernameTaken ? `admin_${Date.now().toString(36)}` : username;

  await User.create({
    email,
    username: finalUsername,
    passwordHash,
    role: 'admin',
    emailVerified: true,
    isVerified: true,
  });
  console.log(`Admin account created: ${email} / ${finalUsername}`);
}
