// Room settings, auto-skip of offline players, timer off, rematch guard.
// Run the server with a short idle limit: TURN_IDLE_MS=2000
import { io, type Socket } from "socket.io-client";
import type { ClientState } from "../src/lib/game/types";

const URL = process.env.TARGET_URL ?? "http://localhost:3000";
const IDLE_MS = parseInt(process.env.TURN_IDLE_MS ?? "2000", 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Socket {
  return io(URL, { transports: ["websocket"] });
}

function emit<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function track(socket: Socket) {
  let s: ClientState | null = null;
  const errors: string[] = [];
  socket.on("gameState", (st: ClientState) => (s = st));
  socket.on("errorMessage", (m: string) => errors.push(m));
  return { get: () => s!, errors };
}

async function main() {
  const host = connect();
  const hostView = track(host);
  const created = await emit<{ roomId: string; token: string }>(
    host,
    "createRoom",
    { name: "Host" }
  );
  const guest = connect();
  const guestView = track(guest);
  await emit(guest, "joinRoom", { roomId: created.roomId, name: "Gus" });
  await sleep(200);

  // 1) only the host may change settings; invalid values are ignored
  guest.emit("updateSettings", { botLevel: "hard" });
  await sleep(200);
  if (hostView.get().settings.botLevel !== "normal")
    throw new Error("guest changed settings");
  if (!guestView.errors.some((e) => e.includes("Only the host")))
    throw new Error("guest got no error");
  host.emit("updateSettings", {
    botLevel: "hard",
    turnSeconds: 7, // not an allowed option
    autoSkipOffline: true,
  });
  await sleep(200);
  const st = guestView.get().settings;
  if (st.botLevel !== "hard" || !st.autoSkipOffline)
    throw new Error("host settings not applied: " + JSON.stringify(st));
  if (st.turnSeconds === 7) throw new Error("invalid turnSeconds accepted");
  console.log("settings: host-only, validated, broadcast ✔");

  // 2) rematch is refused before game over
  host.emit("rematch");
  await sleep(200);
  if (!hostView.errors.some((e) => e.includes("isn't over")))
    throw new Error("rematch not refused mid-lobby");
  console.log("rematch guarded until game over ✔");

  // 3) auto-skip: the idle player is offline → skipped with nobody asked
  host.emit("startGame");
  await sleep(300);
  const guestId = guestView.get().you.id;
  if (hostView.get().currentPlayerId !== guestId) {
    // make it Gus's turn: host draws + discards
    host.emit("action", { type: "drawFromDeck" });
    await sleep(150);
    const card = hostView.get().you.hand.find((c) => c.kind !== "skip")!;
    host.emit("action", { type: "discard", cardId: card.id });
    await sleep(200);
  }
  if (hostView.get().currentPlayerId !== guestId)
    throw new Error("could not hand the turn to Gus");
  guest.disconnect();
  await sleep(IDLE_MS + 800);
  const after = hostView.get();
  if (after.currentPlayerId === guestId)
    throw new Error("offline idle player was not auto-skipped");
  if (after.turnClock?.stalled)
    throw new Error("others were asked although auto-skip is on");
  console.log("offline idle player auto-skipped ✔");

  // 4) timer off → no clock at all
  host.emit("updateSettings", { turnSeconds: 0 });
  await sleep(300);
  if (hostView.get().turnClock !== null)
    throw new Error("turn clock still running with timer off");
  host.emit("updateSettings", { turnSeconds: 30 });
  await sleep(300);
  const clock = hostView.get().turnClock;
  if (!clock || clock.msLeft < 25000)
    throw new Error("clock not re-armed with the new limit");
  console.log("timer off / change re-arms the clock ✔");

  host.disconnect();
  console.log("\nFEATURES E2E OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("FEATURES E2E FAILED:", e);
  process.exit(1);
});
