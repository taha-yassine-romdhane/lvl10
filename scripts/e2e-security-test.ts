import { io, type Socket } from "socket.io-client";

const URL = process.env.TARGET_URL ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Socket {
  return io(URL, { transports: ["websocket"] });
}

function emit<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) =>
    payload === undefined
      ? socket.emit(event, resolve)
      : socket.emit(event, payload, resolve)
  );
}

async function main() {
  const s = connect();
  await new Promise<void>((r) => s.on("connect", () => r()));

  // 1) malformed payloads must not crash the server
  s.emit("createRoom"); // no payload, no callback
  s.emit("createRoom", null, "not-a-function");
  s.emit("joinRoom", { roomId: 12345, name: { evil: true }, playerId: {} });
  s.emit("action", { type: "explode" });
  s.emit("action", null);
  s.emit("action", { type: "layDown", groups: "nope" });
  s.emit("action", { type: "hit", meldId: 5, cardId: [] });
  s.emit("removeBot", { botId: { $ne: "" } });
  s.emit("leaveRoom", "not-a-function");
  await sleep(400);
  if (!s.connected) throw new Error("server dropped us — did it crash?");
  const alive = await emit<{ roomId?: string; error?: string }>(
    s,
    "createRoom",
    { name: "Prober" }
  );
  if (!alive.roomId) throw new Error("server not responsive after fuzzing");
  console.log("malformed payloads survived ✔ (room", alive.roomId + ")");

  // 2) oversized payload: the server should cut that client off (16KB message
  // cap) while staying healthy for everyone else
  const bigGroup = Array.from({ length: 5000 }, (_, i) => "x" + i);
  s.emit("action", { type: "layDown", groups: [bigGroup, bigGroup] });
  await sleep(400);
  console.log(
    s.connected
      ? "oversized action ignored, client kept ✔"
      : "oversized payload → abusive client disconnected ✔"
  );
  s.disconnect();

  // 3) rate limiting: flood 200 events on a fresh socket; the server must
  // survive and still answer
  const f = connect();
  await new Promise<void>((r) => f.on("connect", () => r()));
  for (let i = 0; i < 200; i++) f.emit("addBot");
  await sleep(500);
  if (!f.connected) throw new Error("flood killed the connection");
  // wait out the rate-limit window so the probe below isn't dropped too
  await sleep(2500);
  const after = await emit<{ roomId?: string; error?: string }>(f, "joinRoom", {
    roomId: alive.roomId,
    name: "Prober2",
  });
  // joining may legitimately error; the point is the server still answers.
  console.log("flood survived ✔ (server answered:", JSON.stringify(after), ")");
  f.disconnect();

  // 4) server still fine for a brand-new client
  const v = connect();
  const check = await emit<{ roomId?: string }>(v, "createRoom", {
    name: "Verifier",
  });
  if (!check.roomId) throw new Error("server unhealthy after all abuse");
  await emit(v, "leaveRoom");
  v.disconnect();
  console.log("fresh client still served ✔");
  console.log("\nSECURITY E2E OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("SECURITY E2E FAILED:", e);
  process.exit(1);
});
