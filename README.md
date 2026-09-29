# Real-Time Chat & Notification Backend

A multi-room chat backend where messages survive server restarts and reach recipients regardless of which server instance they're connected to - the two problems that actually justify using Kafka and Redis instead of just broadcasting over a WebSocket.

**Status: all 4 weeks done - auth, rooms, WebSocket + Kafka message delivery, Redis pub/sub fan-out, presence, rate limiting, read receipts, and an end-to-end test suite that runs against the real stack.**

## Why this design

- **Why a message broker at all:** a naive chat backend broadcasts a message directly from the sender's WebSocket connection to recipients' connections. That breaks the moment you run more than one server instance (a common real deployment) - the recipient might be connected to a different instance entirely. Publishing to Kafka instead means *any* instance can pick up the message, not just the one the sender happened to connect to.
- **Why Redpanda instead of Kafka:** same wire protocol - KafkaJS (the client library) doesn't know or care which one it's talking to. Redpanda is a single container with no ZooKeeper, which matters a lot for a project meant to run on a laptop.
- **Why Redis on top of Kafka, not instead of it:** Kafka gives durability (a message isn't lost, and it's the single writer to Postgres). Redis pub/sub is what actually bridges "message arrived on instance A, recipient is connected to instance B" in real time - every instance subscribes to the same channel, so whichever instance is holding the recipient's WebSocket connection can push to it, regardless of which instance's Kafka consumer processed the message.
- **Why presence and read receipts don't go through Kafka:** they're broadcast directly to whichever clients are connected to the same instance. That's an intentional, documented tradeoff - "who's online" and "read up to message X" are ephemeral/best-effort, not data that needs Kafka's durability guarantees. Chat messages get the full durable pipeline because losing one is a real problem; presence flickering for a moment on a multi-instance deployment isn't.
- **Why Express 5, specifically:** it forwards rejected promises from `async` route handlers to the error-handling middleware automatically. Every controller in this project is `async` with no try/catch boilerplate around it, and that's not an accident.
- **Why the Kafka consumer catches its own errors:** a single malformed or orphaned message (e.g. one referencing a room that no longer exists) used to crash the consumer, and KafkaJS would retry the exact same offset forever since it never got committed - a permanent, self-inflicted outage from one bad message. The consumer now logs and skips a message it can't process instead.

## Architecture

```
Client ──WebSocket──▶ Backend instance (1 of N) ──▶ Kafka topic (partitioned by room)
                                                          │
                              ┌───────────────────────────┴────────────────────────┐
                              ▼                                                    ▼
                    Consumer: writes durable                          Redis pub/sub: fans out
                    message log to Postgres                           to whichever instance(s)
                                                                       have that room's clients
                                                                       connected right now
```

Presence and read receipts skip the Kafka hop entirely - they're written straight to Postgres/Redis and broadcast to the local instance's connected clients.

**Note on multi-instance testing:** the Redis pub/sub layer is what makes message delivery correct across more than one backend instance, but `docker-compose.yml` maps a fixed host port (`3000:3000`), so it only runs a single instance locally. Actually load-testing cross-instance delivery would need a load balancer in front of multiple instances, which is out of scope here - the architecture supports it, but it hasn't been exercised beyond a single instance.

## Running it

```bash
cp .env.example .env
docker compose up -d
```

- Backend: http://localhost:3000
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Redpanda (Kafka API): `localhost:19092` from your host, `redpanda:9092` from inside the Docker network

## WebSocket protocol

Connect to `ws://localhost:3000/ws?token=<jwt>` (the JWT from `/auth/register` or `/auth/login`). Messages are JSON with a `type` field.

**Client → server:**

| Type | Fields | What it does |
|---|---|---|
| `join` | `roomId` | Joins a room you're already a member of. Rejected if you're not. |
| `message` | `roomId`, `content` | Sends a chat message. Rate-limited to 5 messages per 5 seconds per user. |
| `read` | `roomId`, `messageId` | Marks messages up to `messageId` as read (the pointer only moves forward). |
| `unread` | `roomId` | Asks for your current unread count in that room. |

**Server → client:**

| Type | Fields | When |
|---|---|---|
| `joined` | `roomId`, `online` | Confirms your join, with the list of currently-online user ids. |
| `message` | `roomId`, `userId`, `content`, `id`, `createdAt` | A new message in a room you're in. |
| `presence` | `roomId`, `event` (`join`/`leave`), `userId` | Someone joined or left a room you're in. |
| `read` | `roomId`, `userId`, `messageId` | Someone marked messages as read. |
| `unread` | `roomId`, `count` | Response to an `unread` request. |
| `error` | `message` | Something went wrong (not a member, rate limited, etc). |

## Running the tests

```bash
npm install
DATABASE_URL=postgresql://chat:chat@localhost:5432/chat JWT_SECRET=test-secret npm test
```

There are two kinds of tests here, and both run against real infrastructure - nothing is mocked:

- `tests/auth.test.ts`, `tests/rooms.test.ts` - import the Express app in-process and hit it with `supertest`. Only need Postgres running.
- `tests/chat-e2e.test.ts` - a genuine end-to-end suite that talks to the actual running backend container over real WebSocket connections: register real users, create and join a real room, send a message, and confirm it round-trips through Kafka → Postgres → Redis → back out over the socket. **Requires `docker compose up -d` first**, since it needs the whole stack, not just Postgres.

`vitest.config.ts` turns off file-level parallelism (`fileParallelism: false`). All three test files share one live database rather than an isolated one per worker, and running them concurrently let one file's setup/cleanup race another's and corrupt shared state - a real bug that showed up while building this, not a hypothetical.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | - | Create an account, returns a JWT |
| POST | `/auth/login` | - | Returns a JWT |
| POST | `/rooms` | required | Create a room (creator is auto-joined) |
| POST | `/rooms/:roomId/join` | required | Join an existing room |
| GET | `/rooms` | required | List rooms you're a member of |

Everything about sending/receiving messages, presence, and read receipts happens over the WebSocket protocol above, not REST.

## Project layout

```
src/
  auth/       registration, login, JWT middleware
  rooms/      room creation and membership
  kafka/      producer (publishes + creates the topic), consumer (writes to Postgres, publishes to Redis)
  redis/      pub/sub fan-out, presence tracking, rate limiting
  ws/         the WebSocket server itself - join/message/read/unread handling
  db/         schema.sql
  app.ts      Express app assembly
  index.ts    entry point - wires producer, consumer, and the WS server together on startup
tests/        vitest + supertest (in-process) and a real end-to-end suite (tests/chat-e2e.test.ts)
docker-compose.yml
Dockerfile
```

## Roadmap

- [x] Docker Compose infra (Postgres, Redis, Redpanda)
- [x] Schema: users, rooms, room_members, messages, read_receipts
- [x] JWT auth (register/login) + room creation/membership, with tests
- [x] WebSocket server + Kafka producer (send a message)
- [x] Kafka consumer writing durable message log to Postgres
- [x] Redis pub/sub fanout across multiple backend instances (the core hard problem)
- [x] Presence tracking (who's online, per room)
- [x] Redis-backed rate limiting on message sending
- [x] Unread/delivery tracking via `read_receipts`
- [x] End-to-end test suite against the real running stack
