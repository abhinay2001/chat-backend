import { redis, redisSub } from "./client.js";

const CHANNEL = "chat:broadcast";

// every backend instance subscribes to this channel, so publishing here
// is what makes message delivery work across multiple instances -
// whichever instance's Kafka consumer handles a message doesn't matter,
// every instance still hears about it and can push to its own local sockets
export async function publishToRoom(roomId: string, payload: unknown) {
  await redis.publish(CHANNEL, JSON.stringify({ roomId, payload }));
}

type BroadcastHandler = (roomId: string, payload: unknown) => void;

export function subscribeToBroadcasts(handler: BroadcastHandler) {
  redisSub.subscribe(CHANNEL);
  redisSub.on("message", (_channel, raw) => {
    const { roomId, payload } = JSON.parse(raw);
    handler(roomId, payload);
  });
}
