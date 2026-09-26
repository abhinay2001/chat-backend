import type { Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";

const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function createRoom(req: AuthedRequest, res: Response) {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const roomResult = await client.query(
      "INSERT INTO rooms (name, created_by) VALUES ($1, $2) RETURNING id, name, created_by, created_at",
      [parsed.data.name, req.userId]
    );
    const room = roomResult.rows[0];
    await client.query("INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)", [
      room.id,
      req.userId,
    ]);
    await client.query("COMMIT");
    res.status(201).json(room);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function joinRoom(req: AuthedRequest, res: Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId)) {
    res.status(400).json({ error: "invalid room id" });
    return;
  }

  const roomResult = await pool.query("SELECT id FROM rooms WHERE id = $1", [roomId]);
  if (roomResult.rows.length === 0) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  await pool.query(
    "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [roomId, req.userId]
  );
  res.status(204).send();
}

export async function listMyRooms(req: AuthedRequest, res: Response) {
  const result = await pool.query(
    `SELECT r.id, r.name, r.created_by, r.created_at
     FROM rooms r
     JOIN room_members m ON m.room_id = r.id
     WHERE m.user_id = $1
     ORDER BY r.created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
}
