import { kafka } from "./client.js";

const TOPIC = "chat-messages";

export const producer = kafka.producer();

export async function connectProducer() {
  await producer.connect();

  // make sure the topic exists before anyone tries to publish to it
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    topics: [{ topic: TOPIC, numPartitions: 3 }],
  });
  await admin.disconnect();
}

export async function publishMessage(roomId: string, payload: unknown) {
  await producer.send({
    topic: TOPIC,
    messages: [{ key: roomId, value: JSON.stringify(payload) }],
  });
}

export { TOPIC };
