// Run the server with a short idle limit: TURN_IDLE_MS=2000 npm run dev
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

type Seat = { name: string; socket: Socket; view: ReturnType<typeof track> };

async function main() {
  const seats: Seat[] = [];
  const host = connect();
  const created = await emit<{ roomId: string; playerId: string; token: string }>(
    host,
    "createRoom",
    { name: "Host" }
  );
  seats.push({ name: "Host", socket: host, view: track(host) });
  const tokens: Record<string, string> = { Host: created.token };
  for (const name of ["Bea", "Cy"]) {
    const s = connect();
    const view = track(s);
    const res = await emit<{ token: string }>(s, "joinRoom", {
      roomId: created.roomId,
      name,
    });
    tokens[name] = res.token;
    seats.push({ name, socket: s, view });
  }
  host.emit("startGame");
  await sleep(300);

  const hostView = seats[0].view;
  const idOf = (name: string) =>
    hostView.get().players.find((p) => p.name === name)!.id;
  const seatOf = (id: string) => seats.find((s) => idOf(s.name) === id)!;

  // 1) clock runs for the current player
  let st = hostView.get();
  if (!st.turnClock || st.turnClock.playerId !== st.currentPlayerId)
    throw new Error("no turn clock for the current player");
  console.log("turn clock running ✔");

  // 2) a non-host can't skip before the player is idle
  const idleId = st.currentPlayerId!;
  const bystander = seats.find(
    (s) => idOf(s.name) !== idleId && s.name !== "Host"
  )!;
  bystander.socket.emit("skipTurn");
  await sleep(200);
  if (hostView.get().currentPlayerId !== idleId)
    throw new Error("non-host skipped an active player");
  console.log("early skip by non-host refused ✔");

  // 3) after the idle limit everyone sees the stall
  await sleep(IDLE_MS + 300);
  for (const s of seats) {
    if (!s.view.get().turnClock?.stalled)
      throw new Error(`${s.name} did not see the stall`);
  }
  console.log("idle warning broadcast to everyone ✔");

  // 4) keep waiting resets the clock
  bystander.socket.emit("keepWaiting");
  await sleep(200);
  if (hostView.get().turnClock?.stalled) throw new Error("wait did not reset");
  console.log("keep waiting resets the clock ✔");

  // 5) stall again, then skip
  await sleep(IDLE_MS + 300);
  bystander.socket.emit("skipTurn");
  await sleep(200);
  st = hostView.get();
  if (st.currentPlayerId === idleId) throw new Error("skip did not advance");
  if (!st.log.some((l) => l.includes("turn was skipped")))
    throw new Error("skip not logged");
  const idleHand = seatOf(idleId).view.get().you.hand.length;
  if (idleHand !== 10) throw new Error(`idle hand changed: ${idleHand}`);
  console.log("skip after idle advances the turn ✔");

  // 6) host can skip any time (after the current player drew — hand stays 10)
  const cur = hostView.get().currentPlayerId!;
  if (cur !== idOf("Host")) {
    seatOf(cur).socket.emit("action", { type: "drawFromDeck" });
    await sleep(200);
    host.emit("skipTurn");
    await sleep(200);
    if (hostView.get().currentPlayerId === cur)
      throw new Error("host skip failed");
    if (seatOf(cur).view.get().you.hand.length !== 10)
      throw new Error("drawn card was not returned on forfeit");
    console.log("host skip (after a draw) works ✔");
  }

  // 7) public ids can't be used to hijack a seat
  const thief = connect();
  const hijack = await emit<{ error?: string }>(thief, "joinRoom", {
    roomId: created.roomId,
    name: "Thief",
    token: idOf("Bea"),
  });
  if (!hijack.error) throw new Error("seat hijacked with a public id!");
  thief.disconnect();
  console.log("seat hijack with public id refused ✔");

  // 8) a stale socket disconnecting must not knock out the new one
  const bea = seats.find((s) => s.name === "Bea")!;
  const bea2 = connect();
  const bea2View = track(bea2);
  await emit(bea2, "joinRoom", {
    roomId: created.roomId,
    name: "Bea",
    token: tokens.Bea,
  });
  bea.socket.disconnect();
  await sleep(300);
  if (!hostView.get().players.find((p) => p.name === "Bea")!.connected)
    throw new Error("stale disconnect marked Bea offline");
  host.emit("skipTurn"); // any change → broadcast
  await sleep(300);
  if (!bea2View.get()) throw new Error("new socket gets no updates");
  bea.socket = bea2;
  bea.view = bea2View;
  console.log("stale socket disconnect ignored ✔");

  // 8b) presence: backgrounding the app shows "away" to everyone, live
  bea.socket.emit("presence", { away: true });
  await sleep(300);
  if (!hostView.get().players.find((p) => p.name === "Bea")!.away)
    throw new Error("away presence not broadcast");
  bea.socket.emit("presence", { away: false });
  await sleep(300);
  if (hostView.get().players.find((p) => p.name === "Bea")!.away)
    throw new Error("back-to-foreground not broadcast");
  console.log("away/online presence is live ✔");

  // 9) host kicks Cy mid-game
  const cy = seats.find((s) => s.name === "Cy")!;
  const kicked = new Promise<string>((r) => cy.socket.once("kicked", r));
  host.emit("kickPlayer", { playerId: idOf("Cy") });
  const kickedRoom = await Promise.race([kicked, sleep(1000).then(() => "")]);
  if (kickedRoom !== created.roomId) throw new Error("Cy was not told");
  await sleep(200);
  st = hostView.get();
  if (st.players.length !== 2) throw new Error("Cy still seated");
  if (!st.players.some((p) => p.id === st.currentPlayerId))
    throw new Error("turn points at a missing player");
  const rejoin = await emit<{ error?: string }>(cy.socket, "joinRoom", {
    roomId: created.roomId,
    name: "Cy",
    token: tokens.Cy,
  });
  if (!rejoin.error) throw new Error("kicked player rejoined");
  console.log("host kick works, kicked player can't rejoin ✔");

  // 10) can't kick below 2 players
  host.emit("kickPlayer", { playerId: idOf("Bea") });
  await sleep(200);
  if (hostView.get().players.length !== 2)
    throw new Error("kicked down to 1 player");
  console.log("kick refused at 2 players ✔");

  for (const s of seats) s.socket.disconnect();
  console.log("\nIDLE/KICK E2E OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("IDLE/KICK E2E FAILED:", e);
  process.exit(1);
});
