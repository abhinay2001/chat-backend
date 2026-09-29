import { redis } from "./client.js";

function key(roomId: string) {
  return `presence:room:${roomId}`;
}

export async function addPresence(roomId: string, userId: string) {
  await redis.sadd(key(roomId), userId);
}

export async function removePresence(roomId: string, userId: string) {
  await redis.srem(key(roomId), userId);
}

export async function listPresence(roomId: string): Promise<string[]> {
  return redis.smembers(key(roomId));
}
