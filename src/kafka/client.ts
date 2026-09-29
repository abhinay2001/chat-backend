import { Kafka } from "kafkajs";
import { config } from "../config.js";

export const kafka = new Kafka({
  clientId: "chat-backend",
  brokers: config.kafkaBrokers,
});
