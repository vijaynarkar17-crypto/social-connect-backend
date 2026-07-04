import mongoose, { Schema, Document } from 'mongoose';

export type ChatRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface IChatRequest extends Document {
  sender: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  status: ChatRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const chatRequestSchema = new Schema<IChatRequest>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

chatRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });

export const ChatRequest = mongoose.model<IChatRequest>('ChatRequest', chatRequestSchema);
