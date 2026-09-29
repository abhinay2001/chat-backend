import Redis from "ioredis";
import { config } from "../config.js";

// a connection that's SUBSCRIBEd to a channel can't run normal commands
// anymore, so pub/sub needs its own dedicated connection
export const redis = new Redis(config.redisUrl);
export const redisSub = new Redis(config.redisUrl);
