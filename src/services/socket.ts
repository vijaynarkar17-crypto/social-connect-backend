import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server): void {
  io = server;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Emit a real-time event to a specific user's room. No-op if sockets are not
 *  ready, so callers never need to guard. */
export function emitToUser(userId: string, event: string, payload?: unknown): void {
  if (!io) return;
  try {
    io.to(userRoom(userId)).emit(event, payload ?? {});
  } catch {
    // Real-time delivery is best-effort and must not break the request.
  }
}
