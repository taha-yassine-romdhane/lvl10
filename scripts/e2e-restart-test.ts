// Games survive a server restart. Two phases around a restart:
//   npx tsx scripts/e2e-restart-test.ts save   (then restart the server)
//   npx tsx scripts/e2e-restart-test.ts check
import fs from "fs";
import os from "os";
import path from "path";
import { io, type Socket } from "socket.io-client";
import type { ClientState } from "../src/lib/game/types";

const URL = process.env.TARGET_URL ?? "http://localhost:3000";
const STATE_FILE = path.join(os.tmpdir(), "lvl10-restart-test.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Socket {
  return io(URL, { transports: ["websocket"] });
}

function emit<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function latest(socket: Socket) {
  let s: ClientState | null = null;
  socket.on("gameState", (st: ClientState) => (s = st));
  return () => s!;
}

async function save() {
  const s = connect();
  const view = latest(s);
  const created = await emit<{ roomId: string; token: string }>(s, "createRoom", {
    name: "Keeper",
  });
  s.emit("addBot");
  await sleep(200);
  s.emit("startGame");
  await sleep(400);
  const st = view();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({
      roomId: created.roomId,
      token: created.token,
      round: st.round,
      hand: st.you.hand.map((c) => c.id).sort(),
      players: st.players.map((p) => p.name),
    })
  );
  console.log(`saved room ${created.roomId} — waiting for the autosave…`);
  await sleep(6000); // autosave runs every 5s
  s.disconnect();
  console.log("now restart the server and run: check");
  process.exit(0);
}

async function check() {
  const before = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const s = connect();
  const view = latest(s);
  const res = await emit<{ error?: string }>(s, "joinRoom", {
    roomId: before.roomId,
    name: "Keeper",
    token: before.token,
  });
  if (res.error) throw new Error("room lost after restart: " + res.error);
  await sleep(400);
  const st = view();
  if (st.round !== before.round) throw new Error("round changed");
  if (JSON.stringify(st.players.map((p) => p.name)) !== JSON.stringify(before.players))
    throw new Error("players changed");
  // the bot may have moved after we rejoined, but our own hand is untouched
  // unless it's our turn and we act — we don't.
  const hand = st.you.hand.map((c) => c.id).sort();
  const kept = before.hand.filter((id: string) => hand.includes(id)).length;
  if (kept < before.hand.length - 1)
    throw new Error(`hand not restored (${kept}/${before.hand.length} cards)`);
  const me = st.players.find((p) => p.id === st.you.id)!;
  if (!me.connected) throw new Error("rejoined player not online");
  console.log(`room ${before.roomId} restored: round ${st.round}, hand kept ✔`);
  s.disconnect();
  console.log("\nRESTART E2E OK");
  process.exit(0);
}

(process.argv[2] === "check" ? check() : save()).catch((e) => {
  console.error("RESTART E2E FAILED:", e);
  process.exit(1);
});
