import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Follow } from '../models/Follow.js';
import { Message } from '../models/Message.js';
import { ChatRequest } from '../models/ChatRequest.js';

export type ChatAccess = {
  canChat: boolean;
  needsRequest: boolean;
  requestStatus: 'none' | 'pending' | 'accepted' | 'rejected';
  isPublic: boolean;
  hasConversation: boolean;
  isFollowing: boolean;
  isFollower: boolean;
  pendingOutgoing: boolean;
  pendingIncoming: boolean;
};

export async function getChatAccess(viewerId: string, targetUserId: string): Promise<ChatAccess> {
  const empty: ChatAccess = {
    canChat: false,
    needsRequest: false,
    requestStatus: 'none',
    isPublic: false,
    hasConversation: false,
    isFollowing: false,
    isFollower: false,
    pendingOutgoing: false,
    pendingIncoming: false,
  };

  if (viewerId === targetUserId) return empty;

  const target = await User.findById(targetUserId).select('privacy.profileVisibility');
  if (!target) return empty;

  const isPublic = target.privacy?.profileVisibility !== 'private';

  const [hasConversation, isFollowing, isFollower, chatRequest] = await Promise.all([
    Message.exists({
      $or: [
        { sender: viewerId, recipient: targetUserId },
        { sender: targetUserId, recipient: viewerId },
      ],
    }),
    Follow.exists({ follower: viewerId, following: targetUserId }),
    Follow.exists({ follower: targetUserId, following: viewerId }),
    ChatRequest.findOne({
      $or: [
        { sender: viewerId, recipient: targetUserId },
        { sender: targetUserId, recipient: viewerId },
      ],
    }),
  ]);

  const pendingOutgoing =
    chatRequest?.status === 'pending' && chatRequest.sender.toString() === viewerId;
  const pendingIncoming =
    chatRequest?.status === 'pending' && chatRequest.recipient.toString() === viewerId;
  const accepted = chatRequest?.status === 'accepted';
  const rejected = chatRequest?.status === 'rejected';

  const canChat = !!hasConversation || isPublic || accepted;

  const needsRequest = !canChat && !pendingOutgoing && !rejected;

  let requestStatus: ChatAccess['requestStatus'] = 'none';
  if (accepted) requestStatus = 'accepted';
  else if (pendingOutgoing || pendingIncoming) requestStatus = 'pending';
  else if (rejected) requestStatus = 'rejected';

  return {
    canChat,
    needsRequest,
    requestStatus,
    isPublic,
    hasConversation: !!hasConversation,
    isFollowing: !!isFollowing,
    isFollower: !!isFollower,
    pendingOutgoing,
    pendingIncoming,
  };
}

export async function assertCanSendMessage(senderId: string, recipientId: string) {
  const access = await getChatAccess(senderId, recipientId);
  if (access.canChat) return access;

  if (access.pendingOutgoing) {
    const err = new Error('CHAT_REQUEST_PENDING');
    throw err;
  }

  if (access.needsRequest) {
    const err = new Error('CHAT_REQUEST_REQUIRED');
    throw err;
  }

  if (access.requestStatus === 'rejected') {
    const err = new Error('CHAT_REQUEST_REJECTED');
    throw err;
  }

  const err = new Error('CANNOT_MESSAGE');
  throw err;
}

export async function listFollowUsers(
  userId: string,
  tab: 'following' | 'followers',
  q?: string
) {
  const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

  if (tab === 'following') {
    const follows = await Follow.find({ follower: userId })
      .populate('following', 'username avatar isVerified privacy.profileVisibility')
      .sort({ createdAt: -1 })
      .limit(50);

    return follows
      .map((f) => f.following as unknown as {
        _id: mongoose.Types.ObjectId;
        username: string;
        avatar?: string;
        isVerified?: boolean;
        privacy?: { profileVisibility?: string };
      })
      .filter((u) => u?.username && (!regex || regex.test(u.username)))
      .map((u) => ({
        id: u._id.toString(),
        username: u.username,
        avatar: u.avatar,
        isVerified: u.isVerified,
        isPrivate: u.privacy?.profileVisibility === 'private',
      }));
  }

  const follows = await Follow.find({ following: userId })
    .populate('follower', 'username avatar isVerified privacy.profileVisibility')
    .sort({ createdAt: -1 })
    .limit(50);

  return follows
    .map((f) => f.follower as unknown as {
      _id: mongoose.Types.ObjectId;
      username: string;
      avatar?: string;
      isVerified?: boolean;
      privacy?: { profileVisibility?: string };
    })
    .filter((u) => u?.username && (!regex || regex.test(u.username)))
    .map((u) => ({
      id: u._id.toString(),
      username: u.username,
      avatar: u.avatar,
      isVerified: u.isVerified,
      isPrivate: u.privacy?.profileVisibility === 'private',
    }));
}
