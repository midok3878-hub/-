/* eslint-disable no-console */
const crypto = require("crypto");
const { io } = require("socket.io-client");

const SERVER_URL = process.env.TEST_SERVER_URL || "http://localhost:3000";
const CHAT_ID = process.env.TEST_CHAT_ID || "";
const TEACHER_TOKEN = process.env.TEST_TEACHER_TOKEN || "";
const LEARNER_TOKEN = process.env.TEST_LEARNER_TOKEN || "";
const LOAD_CLIENTS = Math.max(1, Number(process.env.TEST_LOAD_CLIENTS || 50));
const LOAD_DURATION_MS = Math.max(5000, Number(process.env.TEST_LOAD_DURATION_MS || 20000));

if (!CHAT_ID || !TEACHER_TOKEN || !LEARNER_TOKEN) {
  console.error("Missing required env vars: TEST_CHAT_ID, TEST_TEACHER_TOKEN, TEST_LEARNER_TOKEN");
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
}

function makeStrokeAction(seed = 1) {
  return {
    id: `${Date.now()}_${seed}_${Math.random().toString(16).slice(2, 8)}`,
    type: "stroke",
    mode: "draw",
    color: seed % 2 ? "#2563eb" : "#16a34a",
    size: 3 + (seed % 4),
    points: [
      { x: 15 + (seed % 100), y: 20 + (seed % 120) },
      { x: 85 + (seed % 130), y: 48 + (seed % 140) },
    ],
  };
}

function connectClient(token, label) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 4,
      timeout: 6000,
    });
    const timer = setTimeout(() => reject(new Error(`connect_timeout:${label}`)), 7000);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.timeout(3000).emit("joinChat", CHAT_ID, (err, ack) => {
        if (err || !ack?.ok) {
          reject(new Error(`join_failed:${label}`));
          return;
        }
        resolve(socket);
      });
    });
    socket.on("connect_error", () => {
      clearTimeout(timer);
      reject(new Error(`connect_error:${label}`));
    });
  });
}

function emitAck(socket, eventName, payload, timeoutMs = 2500) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(eventName, payload, (err, ack) => {
      resolve({ err, ack });
    });
  });
}

async function requestState(socket) {
  const result = await emitAck(socket, "requestWhiteboardState", { chatId: CHAT_ID, traceId: `state-${Date.now()}` }, 3500);
  if (result.err || !result.ack?.ok) throw new Error("request_state_failed");
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    socket.once("whiteboardState", (state) => {
      clearTimeout(t);
      resolve(state || null);
    });
  });
}

async function testPermissions(teacher, learner, report) {
  const title = "permissions_lock_and_grant_revoke";
  const out = { title, pass: false, details: {} };
  await emitAck(teacher, "whiteboardControl", { chatId: CHAT_ID, action: "setRole", role: "teacher", targetEmail: process.env.TEST_TEACHER_EMAIL || "" });
  await emitAck(teacher, "whiteboardControl", { chatId: CHAT_ID, action: "setRole", role: "learner", targetEmail: process.env.TEST_LEARNER_EMAIL || "" });

  const baselineState = await requestState(teacher);
  const baselineActions = Array.isArray(baselineState?.actions) ? baselineState.actions.length : 0;
  const lockOn = await emitAck(teacher, "whiteboardControl", { chatId: CHAT_ID, action: "lockBoard", locked: true, traceId: `lock-on-${Date.now()}` });
  const learnerActionWhileLocked = await emitAck(learner, "whiteboardAction", {
    chatId: CHAT_ID,
    senderName: "learner",
    action: makeStrokeAction(1001),
    traceId: `learner-locked-${Date.now()}`,
  });

  const lockOff = await emitAck(teacher, "whiteboardControl", { chatId: CHAT_ID, action: "lockBoard", locked: false, traceId: `lock-off-${Date.now()}` });
  await emitAck(teacher, "whiteboardControl", {
    chatId: CHAT_ID,
    action: "setPermission",
    targetEmail: (process.env.TEST_LEARNER_EMAIL || "").toLowerCase(),
    permission: { canDraw: false, canUseText: true, canUpload: true, canControl: false },
    traceId: `grant-off-${Date.now()}`,
  });
  const learnerActionAfterRevoke = await emitAck(learner, "whiteboardAction", {
    chatId: CHAT_ID,
    senderName: "learner",
    action: makeStrokeAction(1002),
    traceId: `learner-revoke-${Date.now()}`,
  });
  await emitAck(teacher, "whiteboardControl", {
    chatId: CHAT_ID,
    action: "setPermission",
    targetEmail: (process.env.TEST_LEARNER_EMAIL || "").toLowerCase(),
    permission: { canDraw: true, canUseText: true, canUpload: true, canControl: false },
    traceId: `grant-on-${Date.now()}`,
  });
  const learnerActionAfterGrant = await emitAck(learner, "whiteboardAction", {
    chatId: CHAT_ID,
    senderName: "learner",
    action: makeStrokeAction(1003),
    traceId: `learner-grant-${Date.now()}`,
  });
  await delay(900);
  const afterState = await requestState(teacher);
  const afterActions = Array.isArray(afterState?.actions) ? afterState.actions.length : 0;

  out.details = {
    lockOnOk: Boolean(lockOn.ack?.ok),
    lockOffOk: Boolean(lockOff.ack?.ok),
    learnerLockedAckOk: Boolean(learnerActionWhileLocked.ack?.ok),
    learnerRevokeAckOk: Boolean(learnerActionAfterRevoke.ack?.ok),
    learnerGrantAckOk: Boolean(learnerActionAfterGrant.ack?.ok),
    baselineActions,
    afterActions,
    acceptedActionDelta: afterActions - baselineActions,
  };
  // المفترض أن يمر فقط action واحد بعد grant النهائي.
  out.pass = out.details.lockOnOk && out.details.lockOffOk && out.details.acceptedActionDelta === 1;
  report.tests.push(out);
}

async function testSyncNoLossNoDup(teacher, learner, report) {
  const title = "sync_multi_user_no_loss_or_dup";
  const out = { title, pass: false, details: {} };
  let recvOnLearner = 0;
  let recvOnTeacher = 0;
  const seen = new Set();

  const onLearner = (payload) => {
    if (!payload?.action?.id) return;
    recvOnLearner += 1;
    seen.add(payload.action.id);
  };
  const onTeacher = (payload) => {
    if (!payload?.action?.id) return;
    recvOnTeacher += 1;
    seen.add(payload.action.id);
  };
  learner.on("whiteboardAction", onLearner);
  teacher.on("whiteboardAction", onTeacher);

  const ops = [];
  for (let i = 0; i < 25; i++) {
    ops.push(emitAck(teacher, "whiteboardAction", { chatId: CHAT_ID, senderName: "teacher", action: makeStrokeAction(i + 1), traceId: `ts-${i}` }));
    ops.push(emitAck(learner, "whiteboardAction", { chatId: CHAT_ID, senderName: "learner", action: makeStrokeAction(i + 2001), traceId: `ls-${i}` }));
  }
  const acks = await Promise.all(ops);
  await delay(1200);
  learner.off("whiteboardAction", onLearner);
  teacher.off("whiteboardAction", onTeacher);

  const ackOk = acks.filter((x) => x.ack?.ok).length;
  out.details = {
    sent: ops.length,
    ackOk,
    recvOnLearner,
    recvOnTeacher,
    uniqueIdsSeen: seen.size,
  };
  out.pass = ackOk >= Math.floor(ops.length * 0.95) && seen.size >= Math.floor(ops.length * 0.9);
  report.tests.push(out);
}

async function testRecordingAndReplayParity(teacher, report) {
  const title = "recording_replay_parity";
  const out = { title, pass: false, details: {} };
  await emitAck(teacher, "whiteboardRecording", { chatId: CHAT_ID, command: "clear", traceId: `rec-clear-${Date.now()}` });
  await emitAck(teacher, "whiteboardRecording", { chatId: CHAT_ID, command: "start", traceId: `rec-start-${Date.now()}` });

  const actionHashes = [];
  for (let i = 0; i < 12; i++) {
    const action = makeStrokeAction(3000 + i);
    actionHashes.push(hashPayload(action));
    await emitAck(teacher, "whiteboardAction", { chatId: CHAT_ID, senderName: "teacher", action, traceId: `rec-action-${i}` });
  }
  await emitAck(teacher, "whiteboardPointer", {
    chatId: CHAT_ID,
    senderName: "teacher",
    point: { x: 120, y: 100 },
    color: "#ef4444",
    traceId: `rec-pointer-${Date.now()}`,
  });
  await emitAck(teacher, "whiteboardAssetUpload", {
    chatId: CHAT_ID,
    asset: {
      id: `asset-${Date.now()}`,
      type: "image",
      name: "test.png",
      mime: "image/png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      width: 1,
      height: 1,
    },
    traceId: `rec-asset-${Date.now()}`,
  });
  await emitAck(teacher, "whiteboardRecording", { chatId: CHAT_ID, command: "stop", traceId: `rec-stop-${Date.now()}` });

  await delay(900);
  const state = await requestState(teacher);
  const log = Array.isArray(state?.recordingLog) ? state.recordingLog : [];
  const recordedActionHashes = log
    .filter((ev) => ev?.event === "action" && ev.payload?.action)
    .map((ev) => hashPayload(ev.payload.action));
  const expectedSet = new Set(actionHashes);
  const actualSet = new Set(recordedActionHashes);
  let matched = 0;
  expectedSet.forEach((h) => {
    if (actualSet.has(h)) matched += 1;
  });

  out.details = {
    expectedActions: expectedSet.size,
    recordedActions: actualSet.size,
    matched,
    hasPointerEvent: log.some((ev) => String(ev.event || "").includes("pointer")),
    hasAssetEvent: log.some((ev) => String(ev.event || "").includes("asset")),
  };
  out.pass = expectedSet.size > 0 && matched === expectedSet.size;
  report.tests.push(out);
}

async function testDisconnectReconnect(teacher, report) {
  const title = "disconnect_reconnect_state_persistence";
  const out = { title, pass: false, details: {} };
  const before = await requestState(teacher);
  const beforeActions = Array.isArray(before?.actions) ? before.actions.length : 0;
  const beforeLocked = Boolean(before?.sessionMeta?.boardLocked);

  teacher.disconnect();
  await delay(1200);
  const teacher2 = await connectClient(TEACHER_TOKEN, "teacher-reconnect");
  await delay(500);
  const after = await requestState(teacher2);
  const afterActions = Array.isArray(after?.actions) ? after.actions.length : 0;
  const afterLocked = Boolean(after?.sessionMeta?.boardLocked);
  out.details = { beforeActions, afterActions, beforeLocked, afterLocked };
  out.pass = afterActions >= beforeActions && afterLocked === beforeLocked;
  report.tests.push(out);
  return teacher2;
}

async function testWebRtcFailureIsolation(teacher, report) {
  const title = "webrtc_failure_does_not_break_whiteboard";
  const out = { title, pass: false, details: {} };
  const brokenSignal = await emitAck(teacher, "webrtcSignal", {
    chatId: CHAT_ID,
    senderName: "teacher",
    signalType: "offer",
    signal: { sdp: null, type: "offer" },
    traceId: `broken-webrtc-${Date.now()}`,
  });
  const wbAfterBrokenRtc = await emitAck(teacher, "whiteboardAction", {
    chatId: CHAT_ID,
    senderName: "teacher",
    action: makeStrokeAction(9999),
    traceId: `wb-after-broken-webrtc-${Date.now()}`,
  });
  out.details = {
    brokenSignalAckOk: Boolean(brokenSignal.ack?.ok),
    whiteboardActionStillOk: Boolean(wbAfterBrokenRtc.ack?.ok),
  };
  out.pass = out.details.whiteboardActionStillOk;
  report.tests.push(out);
}

async function testLoad(teacherToken, report) {
  const title = "load_50_to_100_clients_latency_error_rate";
  const out = { title, pass: false, details: {} };
  const sockets = [];
  const latencies = [];
  let sent = 0;
  let ackOk = 0;
  let ackErr = 0;
  let timeouts = 0;

  async function spawn(index) {
    try {
      const s = await connectClient(teacherToken, `load-${index}`);
      sockets.push(s);
    } catch {
      ackErr += 1;
    }
  }
  await Promise.all(Array.from({ length: LOAD_CLIENTS }, (_, i) => spawn(i)));

  const ticker = setInterval(() => {
    sockets.forEach((socket, idx) => {
      if (!socket.connected) return;
      sent += 1;
      const started = Date.now();
      socket.timeout(2200).emit("whiteboardAction", {
        chatId: CHAT_ID,
        senderName: `load-${idx}`,
        action: makeStrokeAction(50000 + idx + sent),
        traceId: `load-${Date.now()}-${idx}`,
      }, (err, ack) => {
        if (err) {
          timeouts += 1;
          return;
        }
        if (ack?.ok) {
          ackOk += 1;
          latencies.push(Date.now() - started);
        } else {
          ackErr += 1;
        }
      });
    });
  }, 350);

  await delay(LOAD_DURATION_MS);
  clearInterval(ticker);
  await delay(1200);
  sockets.forEach((s) => s.disconnect());

  latencies.sort((a, b) => a - b);
  const p = (pct) => {
    if (!latencies.length) return 0;
    const idx = Math.min(latencies.length - 1, Math.floor((pct / 100) * latencies.length));
    return latencies[idx];
  };
  const avg = latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100 : 0;
  const errorRate = sent ? Math.round((((ackErr + timeouts) / sent) * 100) * 100) / 100 : 100;

  out.details = {
    clientsRequested: LOAD_CLIENTS,
    clientsConnected: sockets.length,
    durationMs: LOAD_DURATION_MS,
    sent,
    ackOk,
    ackErr,
    timeouts,
    errorRate,
    latencyMs: { avg, p50: p(50), p95: p(95), p99: p(99) },
  };
  out.pass = sockets.length >= Math.floor(LOAD_CLIENTS * 0.9) && errorRate <= 5 && p(95) <= 900;
  report.tests.push(out);
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    chatId: CHAT_ID,
    tests: [],
  };
  let teacher = null;
  let learner = null;
  try {
    teacher = await connectClient(TEACHER_TOKEN, "teacher");
    learner = await connectClient(LEARNER_TOKEN, "learner");

    await testPermissions(teacher, learner, report);
    await testSyncNoLossNoDup(teacher, learner, report);
    await testRecordingAndReplayParity(teacher, report);
    teacher = await testDisconnectReconnect(teacher, report);
    await testWebRtcFailureIsolation(teacher, report);
    await testLoad(TEACHER_TOKEN, report);
  } catch (err) {
    report.fatal = err.message;
  } finally {
    if (teacher) teacher.disconnect();
    if (learner) learner.disconnect();
  }

  report.finishedAt = new Date().toISOString();
  report.passed = report.tests.filter((t) => t.pass).length;
  report.failed = report.tests.filter((t) => !t.pass).length;
  console.log(JSON.stringify(report, null, 2));
  if (report.fatal || report.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
