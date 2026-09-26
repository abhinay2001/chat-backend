import express from "express";
import type { Request, Response, NextFunction } from "express";
import { authRouter } from "./auth/auth.routes.js";
import { roomsRouter } from "./rooms/rooms.routes.js";

export const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth", authRouter);
app.use("/rooms", roomsRouter);

// Express 5 forwards rejected promises from async handlers here automatically -
// no need for a try/catch wrapper around every controller function
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});
