/* eslint-disable no-console */
const { io } = require("socket.io-client");

const SERVER_URL = process.env.LOADTEST_SERVER_URL || "http://localhost:3000";
const TOKEN = process.env.LOADTEST_TOKEN || "";
const CHAT_ID = process.env.LOADTEST_CHAT_ID || "user1@example.com_user2@example.com";
const CLIENTS = Number(process.env.LOADTEST_CLIENTS || 100);
const DURATION_MS = Number(process.env.LOADTEST_DURATION_MS || 30000);

if (!TOKEN) {
  console.error("Missing LOADTEST_TOKEN");
  process.exit(1);
}

const sockets = [];
let sent = 0;
let ackOk = 0;
let ackErr = 0;
let timeouts = 0;
const latencies = [];

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

async function runClient(index) {
  return new Promise((resolve) => {
    const socket = io(SERVER_URL, {
      auth: { token: TOKEN },
      transports: ["websocket"],
      reconnection: true,
    });
    sockets.push(socket);
    socket.on("connect", () => {
      socket.timeout(3000).emit("joinChat", CHAT_ID, () => {
        resolve(socket);
      });
    });
    socket.on("connect_error", () => resolve(socket));
    setTimeout(() => resolve(socket), 5000 + index * 5);
  });
}

async function main() {
  console.log(`Starting load test with ${CLIENTS} clients`);
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => runClient(i)));

  const timer = setInterval(() => {
    sockets.forEach((socket, idx) => {
      if (!socket.connected) return;
      sent += 1;
      const started = Date.now();
      socket.timeout(2200).emit(
        "whiteboardAction",
        {
          chatId: CHAT_ID,
          senderName: `LT-${idx}`,
          action: {
            id: `${Date.now()}_${idx}`,
            type: "stroke",
            mode: "draw",
            color: "#2563eb",
            size: 3,
            points: [{ x: 5, y: 5 }, { x: 50 + (idx % 30), y: 30 + (idx % 40) }],
          },
        },
        (err, ack) => {
          if (err) {
            timeouts += 1;
            return;
          }
          if (ack && ack.ok) {
            ackOk += 1;
            latencies.push(Date.now() - started);
          } else {
            ackErr += 1;
          }
        }
      );
    });
  }, 350);

  setTimeout(() => {
    clearInterval(timer);
    sockets.forEach((s) => s.disconnect());
    const avg = latencies.length
      ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
      : 0;
    console.log("Load test summary:");
    console.log(JSON.stringify({
      clients: CLIENTS,
      durationMs: DURATION_MS,
      sent,
      ackOk,
      ackErr,
      timeouts,
      errorRate: sent ? Math.round((((ackErr + timeouts) / sent) * 100) * 100) / 100 : 0,
      latencyMs: {
        avg,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      },
    }, null, 2));
    process.exit(0);
  }, DURATION_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
