import mongoose, { Schema, Document } from 'mongoose';

export interface IReport extends Document {
  reporter: mongoose.Types.ObjectId;
  targetType: 'post' | 'user' | 'message';
  targetId: mongoose.Types.ObjectId;
  reason: 'spam' | 'abuse' | 'fake' | 'other';
  description?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['post', 'user', 'message'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: ['spam', 'abuse', 'fake', 'other'], required: true },
    description: String,
    status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
  },
  { timestamps: true }
);

export const Report = mongoose.model<IReport>('Report', reportSchema);
