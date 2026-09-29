import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db.js";
import { publishMessage } from "../kafka/producer.js";

interface AuthedSocket extends WebSocket {
  userId?: string;
  rooms?: Set<string>;
}

// roomId -> sockets currently joined to that room
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

function leaveAllRooms(socket: AuthedSocket) {
  if (!socket.rooms) return;
  for (const roomId of socket.rooms) {
    roomClients.get(roomId)?.delete(socket);
  }
}

export function setupWebSocketServer(server: Server) {
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
        ws.send(JSON.stringify({ type: "joined", roomId: data.roomId }));
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
        await publishMessage(data.roomId, {
          roomId: data.roomId,
          userId: ws.userId,
          content: data.content,
        });
        return;
      }
    });

    ws.on("close", () => {
      leaveAllRooms(ws);
    });
  });

  return wss;
}
