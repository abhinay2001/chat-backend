import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { createRoom, joinRoom, listMyRooms } from "./rooms.controller.js";

export const roomsRouter = Router();
roomsRouter.use(requireAuth);
roomsRouter.post("/", createRoom);
roomsRouter.post("/:roomId/join", joinRoom);
roomsRouter.get("/", listMyRooms);
