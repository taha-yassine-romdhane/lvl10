import { io, type Socket } from "socket.io-client";
import type { ClientState, GameAction } from "../src/lib/game/types";

const URL = process.env.TARGET_URL ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emit<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function main() {
  const a = io(URL, { transports: ["websocket"] });
  let state: ClientState | null = null;
  a.on("gameState", (s: ClientState) => (state = s));

  const created = await emit<{ roomId: string; playerId: string }>(
    a,
    "createRoom",
    { name: "Human" }
  );
  console.log("room:", created.roomId);

  a.emit("addBot");
  a.emit("addBot");
  await sleep(300);
  let s = state!;
  const bots = s.players.filter((p) => p.isBot);
  if (bots.length !== 2) throw new Error("expected 2 bots, got " + bots.length);
  console.log("bots added:", bots.map((b) => b.name).join(", "));

  // remove one bot, re-add
  a.emit("removeBot", { botId: bots[0].id });
  await sleep(300);
  if (state!.players.filter((p) => p.isBot).length !== 1)
    throw new Error("bot removal failed");
  a.emit("addBot");
  await sleep(300);
  console.log("remove/re-add bot works");

  a.emit("startGame");
  await sleep(400);
  s = state!;
  if (s.phase !== "draw") throw new Error("game did not start");
  console.log("game started with", s.players.length, "players");

  // Play ~60 seconds: whenever it's the human's turn, draw + discard.
  // Bots play on their own timers.
  const deadline = Date.now() + 60_000;
  let humanTurns = 0;
  let botMoves = 0;
  let lastLogLen = 0;
  while (Date.now() < deadline) {
    await sleep(300);
    s = state!;
    if (s.log.length !== lastLogLen) {
      botMoves++;
      lastLogLen = s.log.length;
    }
    if (s.phase === "roundEnd") {
      a.emit("nextRound");
      continue;
    }
    if (s.phase === "gameOver") break;
    if (s.currentPlayerId !== s.you.id || s.phase !== "draw") continue;
    a.emit("action", { type: "drawFromDeck" } satisfies GameAction);
    await sleep(250);
    s = state!;
    if (s.currentPlayerId !== s.you.id || s.phase !== "play") continue;
    const card =
      s.you.hand.find((c) => c.kind !== "skip" && c.kind !== "wild") ??
      s.you.hand[0];
    const action: GameAction =
      card.kind === "skip"
        ? {
            type: "discard",
            cardId: card.id,
            skipTargetId: s.players.find((p) => p.id !== s.you.id)!.id,
          }
        : { type: "discard", cardId: card.id };
    a.emit("action", action);
    humanTurns++;
  }

  s = state!;
  console.log(
    `after 60s: phase=${s.phase}, round=${s.round}, human turns=${humanTurns}, state updates=${botMoves}`
  );
  console.log("levels:", s.players.map((p) => `${p.name}:${p.level}`).join(" "));
  if (humanTurns < 3) throw new Error("human never got turns — bots stuck?");
  const anyBotProgress = s.players.some(
    (p) => p.isBot && (p.level > 1 || p.laidDown || p.handCount !== 10)
  );
  if (s.round === 1 && !anyBotProgress)
    throw new Error("bots made no visible progress");

  console.log("\nE2E BOT OK");
  a.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("E2E BOT FAILED:", e);
  process.exit(1);
});
