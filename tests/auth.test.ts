import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

beforeAll(async () => {
  await pool.query(
    "TRUNCATE users, rooms, room_members, messages, read_receipts RESTART IDENTITY CASCADE"
  );
});

afterAll(async () => {
  await pool.end();
});

describe("POST /auth/register", () => {
  it("creates a user and returns a token", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "carol",
      email: "carol@test.com",
      password: "password123",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("carol");
    expect(typeof res.body.token).toBe("string");
  });

  it("rejects a duplicate username with 409", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "carol",
      email: "different@test.com",
      password: "password123",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a short password with 400", async () => {
    const res = await request(app).post("/auth/register").send({
      username: "dave",
      email: "dave@test.com",
      password: "short",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/auth/login").send({
      username: "carol",
      password: "password123",
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });

  it("rejects wrong password with 401", async () => {
    const res = await request(app).post("/auth/login").send({
      username: "carol",
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
  });

  it("rejects unknown username with 401", async () => {
    const res = await request(app).post("/auth/login").send({
      username: "nobody",
      password: "password123",
    });
    expect(res.status).toBe(401);
  });
});
