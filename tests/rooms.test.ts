import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  await pool.query(
    "TRUNCATE users, rooms, room_members, messages, read_receipts RESTART IDENTITY CASCADE"
  );
  const a = await request(app)
    .post("/auth/register")
    .send({ username: "roomuser_a", email: "a@test.com", password: "password123" });
  tokenA = a.body.token;
  const b = await request(app)
    .post("/auth/register")
    .send({ username: "roomuser_b", email: "b@test.com", password: "password123" });
  tokenB = b.body.token;
});

afterAll(async () => {
  await pool.end();
});

describe("rooms", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/rooms");
    expect(res.status).toBe(401);
  });

  it("creates a room and adds the creator as a member", async () => {
    const createRes = await request(app)
      .post("/rooms")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "general" });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get("/rooms").set("Authorization", `Bearer ${tokenA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].name).toBe("general");
  });

  it("does not show a room to a user who hasn't joined it", async () => {
    const listRes = await request(app).get("/rooms").set("Authorization", `Bearer ${tokenB}`);
    expect(listRes.body).toHaveLength(0);
  });

  it("lets a second user join and then see the room", async () => {
    const listBefore = await request(app).get("/rooms").set("Authorization", `Bearer ${tokenA}`);
    const roomId = listBefore.body[0].id;

    const joinRes = await request(app)
      .post(`/rooms/${roomId}/join`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(joinRes.status).toBe(204);

    const listAfter = await request(app).get("/rooms").set("Authorization", `Bearer ${tokenB}`);
    expect(listAfter.body).toHaveLength(1);
    expect(listAfter.body[0].name).toBe("general");
  });

  it("returns 404 when joining a room that doesn't exist", async () => {
    const res = await request(app)
      .post("/rooms/999999/join")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });
});
