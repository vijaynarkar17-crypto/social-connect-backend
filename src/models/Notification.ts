import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  | 'LIKE'
  | 'COMMENT'
  | 'FOLLOW'
  | 'FOLLOW_REQUEST'
  | 'MESSAGE'
  | 'MENTION'
  | 'TAG'
  | 'MUTUAL'
  | 'STORY_VIEW'
  | 'SHARE';

export interface INotification extends Document {
  recipient: mongoose.Types.ObjectId;
  actor?: mongoose.Types.ObjectId;
  type: NotificationType;
  message: string;
  targetId?: mongoose.Types.ObjectId;
  targetType?: 'post' | 'user' | 'story' | 'message';
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: ['LIKE', 'COMMENT', 'FOLLOW', 'FOLLOW_REQUEST', 'MESSAGE', 'MENTION', 'TAG', 'MUTUAL', 'STORY_VIEW', 'SHARE'],
      required: true,
    },
    message: { type: String, required: true },
    targetId: Schema.Types.ObjectId,
    targetType: { type: String, enum: ['post', 'user', 'story', 'message'] },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
// Unread-count queries: { recipient, read: false }.
notificationSchema.index({ recipient: 1, read: 1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
