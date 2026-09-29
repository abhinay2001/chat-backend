import { redis } from "./client.js";

const WINDOW_SECONDS = 5;
const MAX_MESSAGES = 5;

// fixed-window counter - not perfectly smooth at window edges but simple,
// cheap, and good enough to stop someone from flooding a room
export async function isRateLimited(userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const redisKey = `ratelimit:${userId}:${window}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, WINDOW_SECONDS);
  }

  return count > MAX_MESSAGES;
}
