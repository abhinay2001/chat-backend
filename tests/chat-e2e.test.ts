// end-to-end tests against the REAL running stack (postgres, redis,
// redpanda, backend) - these need `docker compose up -d` first, unlike
// auth.test.ts / rooms.test.ts which just import the express app in-process
import { describe, it, expect, beforeAll } from "vitest";
import WebSocket from "ws";

const BASE_URL = "http://localhost:3000";

async function registerUser(username: string) {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@e2e-test.com`,
      password: "password123",
    }),
  });
  return res.json();
}

async function createRoom(token: string, name: string) {
  const res = await fetch(`${BASE_URL}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

async function joinRoom(token: string, roomId: string) {
  await fetch(`${BASE_URL}/rooms/${roomId}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function connect(token: string, roomId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "join", roomId }));
      resolve(ws);
    });
    ws.once("error", reject);
  });
}

function waitFor(ws: WebSocket, matches: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (matches(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("chat end-to-end (requires docker compose up)", () => {
  let aliceToken: string;
  let bobToken: string;
  let roomId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const alice = await registerUser(`e2e-alice-${suffix}`);
    const bob = await registerUser(`e2e-bob-${suffix}`);
    aliceToken = alice.token;
    bobToken = bob.token;

    const room = await createRoom(aliceToken, `e2e-room-${suffix}`);
    roomId = room.id;
    await joinRoom(bobToken, roomId);
  });

  it(
    "delivers a message sent over websocket to every room member",
    async () => {
      const aliceWs = await connect(aliceToken, roomId);
      const bobWs = await connect(bobToken, roomId);
      await wait(500); // let both finish joining before sending

      // generous timeout - a Kafka consumer rebalance after a restart can
      // take a while on a single-node dev broker, this isn't instant
      const received = waitFor(
        bobWs,
        (m) => m.type === "message" && m.content === "hello from test",
        20000
      );
      aliceWs.send(JSON.stringify({ type: "message", roomId, content: "hello from test" }));

      const msg = await received;
      expect(msg.content).toBe("hello from test");
      expect(msg.userId).toBeDefined();

      aliceWs.close();
      bobWs.close();
    },
    25000
  );

  it("rejects a message from someone who hasn't joined the room", async () => {
    const outsider = await registerUser(`e2e-outsider-${Date.now()}`);
    const ws = new WebSocket(`ws://localhost:3000/ws?token=${outsider.token}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const errorReceived = waitFor(ws, (m) => m.type === "error");
    ws.send(JSON.stringify({ type: "message", roomId, content: "sneaky" }));

    const err = await errorReceived;
    expect(err.message).toMatch(/join the room first/);

    ws.close();
  });

  it(
    "marks a message read and reports zero unread afterward",
    async () => {
      const aliceWs = await connect(aliceToken, roomId);
      const bobWs = await connect(bobToken, roomId);
      await wait(500);

      const delivered = waitFor(bobWs, (m) => m.type === "message", 20000);
      aliceWs.send(JSON.stringify({ type: "message", roomId, content: "read me" }));
      const msg = await delivered;

      bobWs.send(JSON.stringify({ type: "read", roomId, messageId: msg.id }));
      await wait(300);

      bobWs.send(JSON.stringify({ type: "unread", roomId }));
      const unread = await waitFor(bobWs, (m) => m.type === "unread");
      expect(unread.count).toBe(0);

      aliceWs.close();
      bobWs.close();
    },
    25000
  );
});
