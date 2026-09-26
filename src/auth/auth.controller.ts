import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";
import { config } from "../config.js";

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { username, email, password } = parsed.data;

  const existing = await pool.query("SELECT id FROM users WHERE username = $1 OR email = $2", [
    username,
    email,
  ]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: "username or email already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at",
    [username, email, passwordHash]
  );
  const user = result.rows[0];
  const token = jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  res.status(201).json({ user, token });
}

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { username, password } = parsed.data;

  const result = await pool.query(
    "SELECT id, username, email, password_hash FROM users WHERE username = $1",
    [username]
  );
  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: "invalid username or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "invalid username or password" });
    return;
  }

  const token = jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  res.json({ user: { id: user.id, username: user.username, email: user.email }, token });
}
