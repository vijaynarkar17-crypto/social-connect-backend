import mongoose, { Schema, Document } from 'mongoose';

export type FollowRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface IFollowRequest extends Document {
  follower: mongoose.Types.ObjectId;
  following: mongoose.Types.ObjectId;
  status: FollowRequestStatus;
  createdAt: Date;
}

const followRequestSchema = new Schema<IFollowRequest>(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

followRequestSchema.index({ follower: 1, following: 1 }, { unique: true });
followRequestSchema.index({ following: 1, status: 1 });

export const FollowRequest = mongoose.model<IFollowRequest>('FollowRequest', followRequestSchema);
