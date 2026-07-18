import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  sender: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  content: string;
  sharedPost?: mongoose.Types.ObjectId;
  read: boolean;
  deletedFor: mongoose.Types.ObjectId[];
  createdAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 2000 },
    sharedPost: { type: Schema.Types.ObjectId, ref: 'Post' },
    read: { type: Boolean, default: false },
    deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
// Reverse-direction lookups (conversations aggregation / inbox scans on recipient).
messageSchema.index({ recipient: 1, sender: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
