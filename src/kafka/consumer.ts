import { kafka } from "./client.js";
import { TOPIC } from "./producer.js";
import { pool } from "../db.js";
import { broadcastToRoom } from "../ws/server.js";

const consumer = kafka.consumer({ groupId: "chat-backend-workers" });

export async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      const { roomId, userId, content } = JSON.parse(message.value.toString());

      const result = await pool.query(
        `insert into messages (room_id, user_id, content)
         values ($1, $2, $3)
         returning id, created_at`,
        [roomId, userId, content]
      );

      broadcastToRoom(roomId, {
        type: "message",
        roomId,
        userId,
        content,
        id: result.rows[0].id,
        createdAt: result.rows[0].created_at,
      });
    },
  });
}
