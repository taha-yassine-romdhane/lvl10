import { io, type Socket } from "socket.io-client";
import type { ClientState, GameAction } from "../src/lib/game/types";

const URL = process.env.TARGET_URL ?? "http://localhost:3000";

function connect(): Socket {
  return io(URL, { transports: ["websocket"] });
}

function emit<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextState(socket: Socket): Promise<ClientState> {
  return new Promise((resolve) => socket.once("gameState", resolve));
}

function latest(socket: Socket): { get: () => ClientState | null } {
  let s: ClientState | null = null;
  socket.on("gameState", (st: ClientState) => (s = st));
  return { get: () => s };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = connect();
  const b = connect();
  const aState = latest(a);
  const bState = latest(b);

  const created = await emit<{ roomId: string; playerId: string; token: string }>(a, "createRoom", { name: "Alice" });
  console.log("room created:", created.roomId);

  const joined = await emit<{ playerId?: string; token?: string; error?: string }>(b, "joinRoom", {
    roomId: created.roomId,
    name: "Bob",
  });
  if (!joined.playerId) throw new Error("join failed: " + joined.error);
  console.log("bob joined");

  a.emit("startGame");
  await sleep(300);

  let sa = aState.get()!;
  let sb = bState.get()!;
  if (sa.phase !== "draw") throw new Error("game did not start");
  if (sa.you.hand.length !== 10 || sb.you.hand.length !== 10)
    throw new Error("bad deal");
  console.log("game started, both have 10 cards, current:", sa.currentPlayerId);

  // play a few full turns: current player draws then discards first card
  for (let turn = 0; turn < 6; turn++) {
    await sleep(200);
    sa = aState.get()!;
    sb = bState.get()!;
    const [socket, st] =
      sa.currentPlayerId === sa.you.id ? [a, sa] : [b, sb];
    socket.emit("action", { type: "drawFromDeck" } satisfies GameAction);
    await sleep(200);
    const st2 = (socket === a ? aState : bState).get()!;
    const nonSkip = st2.you.hand.find((c) => c.kind !== "skip") ?? st2.you.hand[0];
    const action: GameAction =
      nonSkip.kind === "skip"
        ? {
            type: "discard",
            cardId: nonSkip.id,
            skipTargetId: st2.players.find((p) => p.id !== st2.you.id)!.id,
          }
        : { type: "discard", cardId: nonSkip.id };
    socket.emit("action", action);
    await sleep(200);
    console.log(
      `turn ${turn + 1} done by ${st.you.id === created.playerId ? "Alice" : "Bob"}`
    );
  }

  sa = aState.get()!;
  if (sa.phase !== "draw") throw new Error("unexpected phase " + sa.phase);
  const counts = sa.players.map((p) => p.handCount).join(",");
  console.log("hand counts after 6 turns:", counts, "(should be 10,10)");

  // reconnect test: drop Bob's socket, rejoin with playerId
  b.disconnect();
  await sleep(300);
  sa = aState.get()!;
  const bobRow = sa.players.find((p) => p.id === joined.playerId)!;
  if (bobRow.connected) throw new Error("bob should show disconnected");
  const b2 = connect();
  const b2State = latest(b2);
  const rejoin = await emit<{ playerId?: string; error?: string }>(b2, "joinRoom", {
    roomId: created.roomId,
    name: "Bob",
    token: joined.token,
  });
  if (rejoin.playerId !== joined.playerId) throw new Error("reconnect failed");
  await sleep(300);
  const sb2 = b2State.get()!;
  if (sb2.you.hand.length === 0) throw new Error("reconnected hand missing");
  console.log("reconnect works, Bob still has", sb2.you.hand.length, "cards");

  // error path: acting out of turn
  const wrong: Socket = sa.currentPlayerId === sa.you.id ? b2 : a;
  const errPromise = new Promise<string>((r) => wrong.once("errorMessage", r));
  wrong.emit("action", { type: "drawFromDeck" });
  const msg = await Promise.race([errPromise, sleep(1000).then(() => "TIMEOUT")]);
  if (msg === "TIMEOUT") throw new Error("no error for out-of-turn action");
  console.log("out-of-turn correctly rejected:", msg);

  console.log("\nE2E OK");
  a.disconnect();
  b2.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
