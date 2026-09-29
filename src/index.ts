import { app } from "./app.js";
import { config } from "./config.js";
import { connectProducer } from "./kafka/producer.js";
import { startConsumer } from "./kafka/consumer.js";
import { setupWebSocketServer } from "./ws/server.js";

async function main() {
  await connectProducer();
  await startConsumer();

  const server = app.listen(config.port, () => {
    console.log(`chat-backend listening on port ${config.port}`);
  });

  setupWebSocketServer(server);
}

main().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
