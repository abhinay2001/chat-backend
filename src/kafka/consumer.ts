import { kafka } from "./client.js";
import { TOPIC } from "./producer.js";
import { pool } from "../db.js";
import { publishToRoom } from "../redis/pubsub.js";

const consumer = kafka.consumer({ groupId: "chat-backend-workers" });

export async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      try {
        const { roomId, userId, content } = JSON.parse(message.value.toString());

        const result = await pool.query(
          `insert into messages (room_id, user_id, content)
           values ($1, $2, $3)
           returning id, created_at`,
          [roomId, userId, content]
        );

        // publish to redis instead of broadcasting directly - that way every
        // backend instance hears about the message, not just whichever one's
        // kafka consumer happened to pick it up
        await publishToRoom(roomId, {
          type: "message",
          roomId,
          userId,
          content,
          id: result.rows[0].id,
          createdAt: result.rows[0].created_at,
        });
      } catch (err) {
        // a message we can't process (bad json, a room/user that no longer
        // exists, etc) should never be allowed to wedge the whole partition -
        // log it and move on instead of crash-looping on the same offset forever
        console.error("skipping unprocessable kafka message", err);
      }
    },
  });
}
