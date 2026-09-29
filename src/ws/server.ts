import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db.js";
import { publishMessage } from "../kafka/producer.js";
import { subscribeToBroadcasts } from "../redis/pubsub.js";
import { addPresence, removePresence, listPresence } from "../redis/presence.js";
import { isRateLimited } from "../redis/rateLimit.js";

interface AuthedSocket extends WebSocket {
  userId?: string;
  rooms?: Set<string>;
}

// roomId -> sockets currently joined to that room, on THIS instance only
const roomClients = new Map<string, Set<AuthedSocket>>();

export function broadcastToRoom(roomId: string, payload: unknown) {
  const clients = roomClients.get(roomId);
  if (!clients) return;

  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function joinRoom(socket: AuthedSocket, roomId: string) {
  if (!socket.rooms) socket.rooms = new Set();
  socket.rooms.add(roomId);

  if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
  roomClients.get(roomId)!.add(socket);
}

async function leaveAllRooms(socket: AuthedSocket) {
  if (!socket.rooms || !socket.userId) return;

  for (const roomId of socket.rooms) {
    roomClients.get(roomId)?.delete(socket);
    await removePresence(roomId, socket.userId);
    broadcastToRoom(roomId, { type: "presence", event: "leave", userId: socket.userId });
  }
}

export function setupWebSocketServer(server: Server) {
  // redis pub/sub delivers every published message to every instance, so
  // each instance just broadcasts to whichever clients it has locally
  subscribeToBroadcasts((roomId, payload) => broadcastToRoom(roomId, payload));

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: AuthedSocket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "missing token");
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: string };
      ws.userId = payload.sub;
    } catch {
      ws.close(4001, "invalid token");
      return;
    }

    ws.on("message", async (raw) => {
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "join") {
        const member = await pool.query(
          `select 1 from room_members where room_id = $1 and user_id = $2`,
          [data.roomId, ws.userId]
        );
        if (member.rowCount === 0) {
          ws.send(JSON.stringify({ type: "error", message: "not a member of this room" }));
          return;
        }

        joinRoom(ws, data.roomId);
        await addPresence(data.roomId, ws.userId!);

        const online = await listPresence(data.roomId);
        ws.send(JSON.stringify({ type: "joined", roomId: data.roomId, online }));
        broadcastToRoom(data.roomId, { type: "presence", event: "join", userId: ws.userId });
        return;
      }

      if (data.type === "message") {
        if (!ws.rooms?.has(data.roomId)) {
          ws.send(JSON.stringify({ type: "error", message: "join the room first" }));
          return;
        }
        if (typeof data.content !== "string" || data.content.trim().length === 0) {
          return;
        }

        if (await isRateLimited(ws.userId!)) {
          ws.send(JSON.stringify({ type: "error", message: "you're sending messages too fast" }));
          return;
        }

        await publishMessage(data.roomId, {
          roomId: data.roomId,
          userId: ws.userId,
          content: data.content,
        });
        return;
      }

      if (data.type === "read") {
        if (!ws.rooms?.has(data.roomId)) {
          ws.send(JSON.stringify({ type: "error", message: "join the room first" }));
          return;
        }

        // only move the read pointer forward, never backward
        await pool.query(
          `insert into read_receipts (room_id, user_id, last_read_message_id)
           values ($1, $2, $3)
           on conflict (room_id, user_id)
           do update set last_read_message_id = $3, updated_at = now()
           where read_receipts.last_read_message_id is null
              or read_receipts.last_read_message_id < $3`,
          [data.roomId, ws.userId, data.messageId]
        );

        broadcastToRoom(data.roomId, {
          type: "read",
          roomId: data.roomId,
          userId: ws.userId,
          messageId: data.messageId,
        });
        return;
      }

      if (data.type === "unread") {
        const result = await pool.query(
          `select count(*)::int as count
           from messages m
           left join read_receipts r
             on r.room_id = m.room_id and r.user_id = $2
           where m.room_id = $1
             and (r.last_read_message_id is null or m.id > r.last_read_message_id)`,
          [data.roomId, ws.userId]
        );

        ws.send(JSON.stringify({ type: "unread", roomId: data.roomId, count: result.rows[0].count }));
        return;
      }
    });

    ws.on("close", () => {
      leaveAllRooms(ws);
    });
  });

  return wss;
}
