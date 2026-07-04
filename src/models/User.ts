import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  passwordHash?: string;
  avatar?: string;
  cover?: string;
  bio?: string;
  links: string[];
  isVerified: boolean;
  emailVerified: boolean;
  emailVerifyToken?: string;
  otpCode?: string;
  otpExpires?: Date;
  role: 'user' | 'admin';
  theme: 'light' | 'dark';
  savedPosts: mongoose.Types.ObjectId[];
  refreshTokens: string[];
  isBanned: boolean;
  isSuspended: boolean;
  googleId?: string;
  privacy: {
    profileVisibility: 'public' | 'friends' | 'private';
    onlineStatus: 'everyone' | 'friends' | 'nobody';
    storyVisibility: 'public' | 'friends' | 'private';
  };
  notificationSettings: {
    likes: boolean;
    comments: boolean;
    follows: boolean;
    messages: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String },
    avatar: String,
    cover: String,
    bio: { type: String, maxlength: 500 },
    links: [String],
    isVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: String,
    otpCode: String,
    otpExpires: Date,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    savedPosts: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
    refreshTokens: [String],
    isBanned: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    googleId: String,
    privacy: {
      profileVisibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
      onlineStatus: { type: String, enum: ['everyone', 'friends', 'nobody'], default: 'everyone' },
      storyVisibility: { type: String, enum: ['public', 'friends', 'private'], default: 'friends' },
    },
    notificationSettings: {
      likes: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      follows: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
