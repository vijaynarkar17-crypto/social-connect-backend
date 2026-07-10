import mongoose, { Schema, Document } from 'mongoose';

export interface IPost extends Document {
  author: mongoose.Types.ObjectId;
  type: 'text' | 'image' | 'video' | 'poll' | 'story' | 'clip';
  content: string;
  media: string[];
  likes: mongoose.Types.ObjectId[];
  taggedUsers: mongoose.Types.ObjectId[];
  commentCount: number;
  viewCount: number;
  shareCount: number;
  visibility: 'public' | 'friends' | 'private';
  isPinned: boolean;
  isHidden: boolean;
  storyEffect?: string;
  expiresAt?: Date;
  dailyVibe?: boolean;
  audio?: string;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['text', 'image', 'video', 'poll', 'story', 'clip'], default: 'text' },
    content: { type: String, default: '' },
    media: [String],
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    taggedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    commentCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
    isPinned: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
    storyEffect: { type: String, default: 'normal' },
    expiresAt: { type: Date },
    dailyVibe: { type: Boolean, default: false },
    audio: { type: String },
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

export const Post = mongoose.model<IPost>('Post', postSchema);
