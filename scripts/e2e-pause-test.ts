import { io, type Socket } from "socket.io-client";
import type { ClientState } from "../src/lib/game/types";

const URL = "http://localhost:3000";
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

function track(socket: Socket): { get: () => ClientState | null } {
  let s: ClientState | null = null;
  socket.on("gameState", (st: ClientState) => (s = st));
  return { get: () => s };
}

async function main() {
  // --- Test 1: solo game pauses while the human is away ---
  const a = connect();
  const aState = track(a);
  const created = await emit<{ roomId: string; playerId: string; token: string }>(
    a,
    "createRoom",
    { name: "Solo" }
  );
  a.emit("addBot");
  a.emit("addBot");
  await sleep(200);
  a.emit("startGame");
  await sleep(3000); // let bots make a few moves
  const before = aState.get()!;
  const logBefore = before.log.join("|");
  a.disconnect();
  console.log("human disconnected; waiting 5s...");
  await sleep(5000);

  const a2 = connect();
  const a2State = track(a2);
  await emit(a2, "joinRoom", {
    roomId: created.roomId,
    name: "Solo",
    token: created.token,
  });
  await sleep(400);
  const after = a2State.get()!;
  const logAfter = after.log.join("|");
  // Bots may finish at most the single already-scheduled step; the log should
  // be nearly unchanged after 5s away (not ~5 more moves).
  const newEntries = after.log.filter((l) => !before.log.includes(l)).length;
  console.log(`log entries added while away: ${newEntries}`);
  if (newEntries > 2) throw new Error("solo game did NOT pause while away");
  console.log("solo pause works ✔");

  // resume: bots should start moving again now
  const logNow = a2State.get()!.log.join("|");
  await sleep(3000);
  if (a2State.get()!.log.join("|") === logNow)
    throw new Error("game did not resume after reconnect");
  console.log("resume after reconnect works ✔");
  await emit(a2, "leaveRoom");
  a2.disconnect();

  // --- Test 2: lobby leave with host handover ---
  const h = connect();
  const g = connect();
  const gState = track(g);
  const room2 = await emit<{ roomId: string; playerId: string; token: string }>(
    h,
    "createRoom",
    { name: "Host" }
  );
  const guest = await emit<{ playerId?: string }>(g, "joinRoom", {
    roomId: room2.roomId,
    name: "Guest",
  });
  await sleep(200);
  const res = await emit<{ removedSeat: boolean }>(h, "leaveRoom");
  if (!res.removedSeat) throw new Error("lobby leave should remove the seat");
  await sleep(300);
  const s2 = gState.get()!;
  if (s2.players.length !== 1) throw new Error("host seat not removed");
  if (s2.hostId !== guest.playerId)
    throw new Error("host was not handed over to the guest");
  console.log("lobby leave + host handover works ✔");

  h.disconnect();
  g.disconnect();
  console.log("\nPAUSE/LEAVE E2E OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("PAUSE/LEAVE E2E FAILED:", e);
  process.exit(1);
});
