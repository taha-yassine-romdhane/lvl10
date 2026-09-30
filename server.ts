import { createServer } from "http";
import next from "next";
import { Server, type Socket } from "socket.io";
import {
  act,
  addBot,
  autoSkipIfOffline,
  leaveRoom,
  cleanupRooms,
  createRoom,
  getRoom,
  joinRoom,
  keepWaiting,
  kickPlayer,
  markDirty,
  markDisconnected,
  nextRound,
  rematch,
  removeBot,
  restoreRooms,
  roomCount,
  setAway,
  skipTurn,
  snapshotRooms,
  startGame,
  stateFor,
  takeDirty,
  updateSettings,
  type Room,
} from "./src/server/rooms";
import { botStep } from "./src/server/bots";
import { loadSavedRooms, saveRooms } from "./src/server/persist";
import { DEFAULT_SETTINGS } from "./src/lib/game/engine";
import type { GameAction } from "./src/lib/game/types";

const dev =
  !process.argv.includes("--prod") && process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const MAX_ROOMS = 500;
const RATE_LIMIT_WINDOW_MS = 2000;
const RATE_LIMIT_MAX_EVENTS = 30;
/**
 * Default idle limit for new rooms (the host can change it per room).
 * TURN_IDLE_MS overrides it, e.g. for fast end-to-end tests.
 */
const DEFAULT_TURN_SECONDS = process.env.TURN_IDLE_MS
  ? parseInt(process.env.TURN_IDLE_MS, 10) / 1000
  : DEFAULT_SETTINGS.turnSeconds;

/** Callbacks arrive from untrusted clients — never call them unchecked. */
function safeCb(cb: unknown): (arg: unknown) => void {
  return typeof cb === "function"
    ? (cb as (arg: unknown) => void)
    : () => undefined;
}

function isValidAction(a: unknown): a is GameAction {
  if (typeof a !== "object" || a === null) return false;
  const action = a as Record<string, unknown>;
  switch (action.type) {
    case "drawFromDeck":
    case "drawFromDiscard":
      return true;
    case "layDown":
      return (
        Array.isArray(action.groups) &&
        action.groups.length <= 4 &&
        action.groups.every(
          (g: unknown) =>
            Array.isArray(g) &&
            g.length <= 15 &&
            g.every((id) => typeof id === "string" && id.length <= 48)
        )
      );
    case "hit":
      return (
        typeof action.meldId === "string" &&
        action.meldId.length <= 48 &&
        typeof action.cardId === "string" &&
        action.cardId.length <= 48 &&
        (action.end === undefined ||
          action.end === "low" ||
          action.end === "high")
      );
    case "discard":
      return (
        typeof action.cardId === "string" &&
        action.cardId.length <= 48 &&
        (action.skipTargetId === undefined ||
          (typeof action.skipTargetId === "string" &&
            action.skipTargetId.length <= 48))
      );
    default:
      return false;
  }
}

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    // Bound what a client can send us in one message.
    maxHttpBufferSize: 16 * 1024,
    // Notice dropped connections within ~15s (default is up to ~45s) so the
    // online dots stay honest.
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  const cleanupTimer = setInterval(cleanupRooms, 10 * 60 * 1000);

  // Pick up games that were running before a restart / redeploy.
  const saved = loadSavedRooms();
  restoreRooms(saved);
  if (saved.length > 0) console.log(`> restored ${saved.length} room(s)`);
  const saveTimer = setInterval(() => {
    if (takeDirty()) saveRooms(snapshotRooms());
  }, 5000);

  function broadcast(room: Room) {
    markDirty();
    syncTurnClock(room);
    for (const [playerId, socketId] of room.sockets) {
      if (socketId) {
        io.to(socketId).emit("gameState", stateFor(room, playerId));
      }
    }
    scheduleBots(room);
  }

  /**
   * (Re)start the idle clock whenever the turn moves on or the current human
   * makes a move. When it runs out the room is flagged `stalled`, which shows
   * the idle player a warning and lets the others wait or skip them.
   */
  function syncTurnClock(room: Room) {
    const gs = room.state;
    const current = gs.players[gs.currentPlayerIndex];
    const inPlay = gs.phase === "draw" || gs.phase === "play";
    const idleMs = gs.settings.turnSeconds * 1000;
    const key =
      inPlay && current && !current.isBot && idleMs > 0
        ? `${gs.round}|${current.id}|${room.moveSeq}`
        : null;
    if (key === room.turnKey) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnKey = key;
    room.stalled = false;
    room.turnDeadline = key ? Date.now() + idleMs : null;
    if (!key) return;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      if (room.turnKey !== key) return;
      room.stalled = true;
      autoSkipIfOffline(room);
      broadcast(room);
    }, idleMs);
  }

  function humansConnected(room: Room) {
    return room.state.players.some((p) => !p.isBot && p.connected);
  }

  function scheduleBots(room: Room) {
    const gs = room.state;
    if (room.botTimer) return;
    if (gs.phase !== "draw" && gs.phase !== "play") return;
    if (!gs.players[gs.currentPlayerIndex]?.isBot) return;
    // Pause bot play while no human is watching; a reconnect broadcasts and
    // re-schedules, which resumes the game.
    if (!humansConnected(room)) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (!humansConnected(room)) return;
      try {
        if (botStep(room)) broadcast(room);
      } catch (err) {
        console.error("bot step failed:", err);
      }
    }, 900);
  }

  /** Unbind a socket from the seat it held (if it still holds it). */
  function detach(socket: Socket) {
    const room = getRoom(socket.data.roomId ?? "");
    const playerId = socket.data.playerId;
    socket.data.roomId = undefined;
    socket.data.playerId = undefined;
    if (!room || !playerId) return;
    socket.leave(room.id);
    // A newer socket (reconnect, second tab) may own the seat now — leave it be.
    if (room.sockets.get(playerId) !== socket.id) return;
    markDisconnected(room, playerId);
    // Already flagged idle and now gone too: skip right away if allowed.
    autoSkipIfOffline(room);
    broadcast(room);
  }

  function attach(socket: Socket, room: Room, playerId: string) {
    if (
      socket.data.roomId &&
      (socket.data.roomId !== room.id || socket.data.playerId !== playerId)
    ) {
      // The same browser moved to another room without leaving the old one;
      // otherwise both rooms would keep pushing state to this socket.
      detach(socket);
    }
    room.sockets.set(playerId, socket.id);
    room.emptySince = null;
    socket.data.roomId = room.id;
    socket.data.playerId = playerId;
    socket.join(room.id);
  }

  io.on("connection", (socket) => {
    /** Simple sliding-window rate limit per socket. */
    function allowEvent(): boolean {
      const now = Date.now();
      const hits: number[] = (socket.data.rateHits ??= []);
      while (hits.length > 0 && now - hits[0] > RATE_LIMIT_WINDOW_MS) {
        hits.shift();
      }
      if (hits.length >= RATE_LIMIT_MAX_EVENTS) return false;
      hits.push(now);
      return true;
    }

    /** Guard every handler: rate-limited and exception-safe. */
    function on(event: string, handler: (...args: unknown[]) => void) {
      socket.on(event, (...args: unknown[]) => {
        if (!allowEvent()) return;
        try {
          handler(...args);
        } catch (err) {
          console.error(`socket handler "${event}" failed:`, err);
          socket.emit("errorMessage", "Something went wrong.");
        }
      });
    }

    on("createRoom", (payload, rawCb) => {
      const cb = safeCb(rawCb);
      const name = String((payload as { name?: unknown })?.name ?? "")
        .trim()
        .slice(0, 20);
      if (!name) return cb({ error: "Enter a name." });
      if (roomCount() >= MAX_ROOMS)
        return cb({ error: "Server is full — try again later." });
      const { room, playerId, token } = createRoom(name, {
        ...DEFAULT_SETTINGS,
        turnSeconds: DEFAULT_TURN_SECONDS,
      });
      attach(socket, room, playerId);
      cb({ roomId: room.id, playerId, token });
      broadcast(room);
    });

    on("joinRoom", (payload, rawCb) => {
      const cb = safeCb(rawCb);
      const p = (payload ?? {}) as {
        roomId?: unknown;
        name?: unknown;
        token?: unknown;
      };
      const room = getRoom(String(p.roomId ?? "").slice(0, 8));
      if (!room) return cb({ error: "Room not found." });
      const name = String(p.name ?? "").trim().slice(0, 20);
      const token =
        typeof p.token === "string" && p.token.length <= 64
          ? p.token
          : undefined;
      const result = joinRoom(room, name, token);
      if ("error" in result) return cb(result);
      attach(socket, room, result.playerId);
      cb({ roomId: room.id, playerId: result.playerId, token: result.token });
      broadcast(room);
    });

    function withRoom(fn: (room: Room, playerId: string) => string | null) {
      const room = getRoom(socket.data.roomId ?? "");
      const playerId = socket.data.playerId;
      if (!room || !playerId) {
        socket.emit("errorMessage", "You are not in a room.");
        return;
      }
      const error = fn(room, playerId);
      if (error) socket.emit("errorMessage", error);
      broadcast(room);
    }

    on("startGame", () => withRoom(startGame));
    on("nextRound", () => withRoom(nextRound));
    on("addBot", () => withRoom(addBot));
    on("removeBot", (payload) => {
      const botId = (payload as { botId?: unknown })?.botId;
      if (typeof botId !== "string" || botId.length > 64) return;
      withRoom((room, playerId) => removeBot(room, playerId, botId));
    });
    on("presence", (payload) => {
      const away = Boolean((payload as { away?: unknown })?.away);
      const room = getRoom(socket.data.roomId ?? "");
      const playerId = socket.data.playerId;
      if (!room || !playerId || room.sockets.get(playerId) !== socket.id) return;
      if (setAway(room, playerId, away)) broadcast(room);
    });
    on("skipTurn", () => withRoom(skipTurn));
    on("rematch", () => withRoom(rematch));
    on("updateSettings", (payload) => {
      if (typeof payload !== "object" || payload === null) return;
      withRoom((room, playerId) =>
        updateSettings(room, playerId, payload as Record<string, unknown>)
      );
    });
    on("keepWaiting", () => withRoom(keepWaiting));
    on("kickPlayer", (payload) => {
      const targetId = (payload as { playerId?: unknown })?.playerId;
      if (typeof targetId !== "string" || targetId.length > 64) return;
      withRoom((room, playerId) => {
        const targetSocketId = room.sockets.get(targetId);
        const result = kickPlayer(room, playerId, targetId);
        if ("error" in result) return result.error;
        const target = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
        if (target) {
          target.leave(room.id);
          target.data.roomId = undefined;
          target.data.playerId = undefined;
          target.emit("kicked", room.id);
        }
        return null;
      });
    });
    on("action", (action) => {
      if (!isValidAction(action)) {
        socket.emit("errorMessage", "Invalid move.");
        return;
      }
      withRoom((room, playerId) => act(room, playerId, action));
    });

    on("leaveRoom", (rawCb) => {
      const cb = safeCb(rawCb);
      const room = getRoom(socket.data.roomId ?? "");
      const playerId = socket.data.playerId;
      if (!room || !playerId) {
        cb({ removedSeat: true });
        return;
      }
      if (room.sockets.get(playerId) !== socket.id) {
        // a newer socket owns this seat — just unbind this one
        detach(socket);
        cb({ removedSeat: false });
        return;
      }
      const result = leaveRoom(room, playerId);
      socket.leave(room.id);
      socket.data.roomId = undefined;
      socket.data.playerId = undefined;
      cb(result);
      broadcast(room);
    });

    socket.on("disconnect", () => {
      try {
        detach(socket);
      } catch (err) {
        console.error("disconnect handler failed:", err);
      }
    });
  });

  function shutdown() {
    clearInterval(cleanupTimer);
    clearInterval(saveTimer);
    saveRooms(snapshotRooms());
    io.close();
    httpServer.close(() => process.exit(0));
    // Fallback if connections keep the server alive.
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  httpServer.listen(port, () => {
    console.log(`> Level 10 ready on http://localhost:${port}`);
  });
});
