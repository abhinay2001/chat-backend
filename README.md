# Real-Time Chat & Notification Backend

A multi-room chat backend where messages survive server restarts and reach recipients regardless of which server instance they're connected to - the two problems that actually justify using Kafka and Redis instead of just broadcasting over a WebSocket.

**Status: Week 1 of 4 - infra, auth, and room management are done and tested. WebSocket + Kafka producer/consumer are next.**

## Why this design

- **Why a message broker at all:** a naive chat backend broadcasts a message directly from the sender's WebSocket connection to recipients' connections. That breaks the moment you run more than one server instance (a common real deployment) - the recipient might be connected to a different instance entirely. Publishing to Kafka instead means *any* instance can pick up the message, not just the one the sender happened to connect to.
- **Why Redpanda instead of Kafka:** same wire protocol - KafkaJS (the client library) doesn't know or care which one it's talking to. Redpanda is a single container with no ZooKeeper, which matters a lot for a project meant to run on a laptop.
- **Why Redis on top of Kafka, not instead of it:** Kafka gives durability (a message isn't lost). Redis pub/sub is what actually bridges "message arrived on instance A, recipient is connected to instance B" in real time - Kafka consumers don't inherently know which WebSocket server is holding which connection.
- **Why Express 5, specifically:** it forwards rejected promises from `async` route handlers to the error-handling middleware automatically. Every controller in this project is `async` with no try/catch boilerplate around it, and that's not an accident.

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

## Running it

```bash
cp .env.example .env
docker compose up -d
```

- Backend: http://localhost:3000
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Redpanda (Kafka API): `localhost:19092` from your host, `redpanda:9092` from inside the Docker network

## Running the tests

```bash
npm install
DATABASE_URL=postgresql://chat:chat@localhost:5432/chat JWT_SECRET=test-secret npm test
```

These are integration tests against a real Postgres, not mocks - they truncate the relevant tables before running and verify actual HTTP behavior through `supertest` (auth, duplicate-user rejection, room membership, cross-user visibility).

## API (so far)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | - | Create an account, returns a JWT |
| POST | `/auth/login` | - | Returns a JWT |
| POST | `/rooms` | required | Create a room (creator is auto-joined) |
| POST | `/rooms/:roomId/join` | required | Join an existing room |
| GET | `/rooms` | required | List rooms you're a member of |

## Project layout

```
src/
  auth/       registration, login, JWT middleware
  rooms/      room creation and membership
  db/         schema.sql
  app.ts      Express app assembly
  index.ts    entry point
tests/        vitest + supertest, run against real Postgres
docker-compose.yml
Dockerfile
```

## Roadmap

- [x] Docker Compose infra (Postgres, Redis, Redpanda)
- [x] Schema: users, rooms, room_members, messages, read_receipts
- [x] JWT auth (register/login) + room creation/membership, with tests
- [ ] WebSocket server + Kafka producer (send a message)
- [ ] Kafka consumer writing durable message log to Postgres
- [ ] Redis pub/sub fanout across multiple backend instances (the core hard problem)
- [ ] Presence tracking (who's online, per room)
- [ ] Redis-backed rate limiting on message sending
- [ ] Unread/delivery tracking via `read_receipts`
