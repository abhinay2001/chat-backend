// quick manual test client — not part of the app, just for trying out the chat flow by hand
// usage: node scripts/chat-client.mjs <jwt> <roomId>
import WebSocket from "ws";
import readline from "readline";

const [, , token, roomId] = process.argv;

if (!token || !roomId) {
  console.error("usage: node scripts/chat-client.mjs <jwt> <roomId>");
  process.exit(1);
}

const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.on("open", () => {
  console.log("connected, joining room...");
  ws.send(JSON.stringify({ type: "join", roomId }));
});

ws.on("message", (data) => {
  console.log("received:", data.toString());
});

ws.on("close", (code, reason) => {
  console.log("closed", code, reason.toString());
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
});

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  ws.send(JSON.stringify({ type: "message", roomId, content: line }));
});
