import { randomUUID } from "crypto";
import {
  addPlayer,
  applyAction,
  createGame,
  DEFAULT_SETTINGS,
  forfeitTurn,
  removePlayer,
  resetGame,
  sanitizeFor,
  startRound,
} from "../lib/game/engine";
import {
  TURN_SECONDS_OPTIONS,
  type BotLevel,
  type GameAction,
  type GameState,
  type RoomSettings,
} from "../lib/game/types";
import { BOT_NAMES } from "./bots";

export interface Room {
  id: string;
  state: GameState;
  /** playerId -> socketId (or null when disconnected) */
  sockets: Map<string, string | null>;
  /**
   * secret rejoin token -> playerId. Player ids are public (every client sees
   * them), so they must never be accepted as proof of identity.
   */
  tokens: Map<string, string>;
  emptySince: number | null;
  botTimer: NodeJS.Timeout | null;
  /** bumped on every successful move / forfeit / kick; drives the turn clock */
  moveSeq: number;
  /** identifies the turn the idle clock is running for (null = no clock) */
  turnKey: string | null;
  turnTimer: NodeJS.Timeout | null;
  turnDeadline: number | null;
  /** the current player has been idle past the limit */
  stalled: boolean;
}

const rooms = new Map<string, Room>();

/** Set whenever room data changes; the persistence loop saves and clears it. */
let dirty = false;
export function markDirty() {
  dirty = true;
}
export function takeDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return rooms.has(code) ? makeCode() : code;
}

export function createRoom(
  name: string,
  settings: RoomSettings = DEFAULT_SETTINGS
): {
  room: Room;
  playerId: string;
  token: string;
} {
  const id = makeCode();
  const playerId = randomUUID();
  const token = randomUUID();
  const state = createGame(id, playerId, settings);
  addPlayer(state, playerId, name);
  const room: Room = {
    id,
    state,
    sockets: new Map(),
    tokens: new Map([[token, playerId]]),
    emptySince: null,
    botTimer: null,
    moveSeq: 0,
    turnKey: null,
    turnTimer: null,
    turnDeadline: null,
    stalled: false,
  };
  rooms.set(id, room);
  return { room, playerId, token };
}

function disposeRoom(room: Room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.turnTimer) clearTimeout(room.turnTimer);
  rooms.delete(room.id);
  markDirty();
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id.toUpperCase());
}

export function roomCount(): number {
  return rooms.size;
}

export function joinRoom(
  room: Room,
  name: string,
  token?: string
): { playerId: string; token: string } | { error: string } {
  const existingId = token ? room.tokens.get(token) : undefined;
  const existing = room.state.players.find((pl) => pl.id === existingId);
  if (existing && token) {
    existing.connected = true;
    existing.away = false;
    if (name) existing.name = name;
    return { playerId: existing.id, token };
  }
  if (room.state.phase !== "lobby")
    return { error: "That game has already started." };
  if (room.state.players.length >= 6)
    return { error: "That room is full (6 players max)." };
  if (!name) return { error: "Enter a name." };
  const playerId = randomUUID();
  const newToken = randomUUID();
  room.tokens.set(newToken, playerId);
  addPlayer(room.state, playerId, name);
  return { playerId, token: newToken };
}

function forgetPlayer(room: Room, playerId: string) {
  room.sockets.delete(playerId);
  for (const [token, id] of room.tokens) {
    if (id === playerId) room.tokens.delete(token);
  }
}

export function addBot(room: Room, playerId: string): string | null {
  if (room.state.hostId !== playerId) return "Only the host can add bots.";
  if (room.state.phase !== "lobby")
    return "Bots can only be added before the game starts.";
  if (room.state.players.length >= 6) return "The room is full.";
  const used = new Set(room.state.players.map((p) => p.name));
  const name =
    BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${room.state.players.length}`;
  addPlayer(room.state, `bot-${randomUUID()}`, name, true);
  return null;
}

export function removeBot(
  room: Room,
  playerId: string,
  botId: string
): string | null {
  if (room.state.hostId !== playerId) return "Only the host can remove bots.";
  if (room.state.phase !== "lobby")
    return "Bots can only be removed before the game starts.";
  const index = room.state.players.findIndex(
    (p) => p.id === botId && p.isBot
  );
  if (index === -1) return "Bot not found.";
  room.state.players.splice(index, 1);
  return null;
}

export function startGame(room: Room, playerId: string): string | null {
  if (room.state.hostId !== playerId) return "Only the host can start.";
  if (room.state.players.length < 2) return "Need at least 2 players.";
  if (room.state.phase !== "lobby" && room.state.phase !== "roundEnd")
    return "Game already in progress.";
  startRound(room.state);
  return null;
}

export function nextRound(room: Room, playerId: string): string | null {
  const host = room.state.players.find((p) => p.id === room.state.hostId);
  const hostAway = !host || (!host.connected && !host.isBot);
  if (room.state.hostId !== playerId && !hostAway)
    return "Only the host can start the next round.";
  if (room.state.phase !== "roundEnd") return "The round isn't over.";
  startRound(room.state);
  return null;
}

export function act(
  room: Room,
  playerId: string,
  action: GameAction
): string | null {
  const result = applyAction(room.state, playerId, action);
  if (!result.ok) return result.error ?? "Invalid move.";
  room.moveSeq += 1;
  return null;
}

/**
 * Kick a player (host only). In the lobby the seat is simply removed; in a
 * running game the player leaves the game for good. Returns the kicked id so
 * the server can notify and detach their socket.
 */
export function kickPlayer(
  room: Room,
  hostId: string,
  targetId: string
): { kickedId: string } | { error: string } {
  const gs = room.state;
  if (gs.hostId !== hostId) return { error: "Only the host can kick players." };
  if (targetId === hostId) return { error: "You can't kick yourself." };
  if (!gs.players.some((p) => p.id === targetId))
    return { error: "Player not found." };
  if (gs.phase !== "lobby" && gs.players.length <= 2)
    return { error: "At least 2 players are needed to keep the game going." };
  removePlayer(gs, targetId);
  forgetPlayer(room, targetId);
  room.moveSeq += 1;
  return { kickedId: targetId };
}

/**
 * Skip the current player's turn. The host may do this at any time; anyone
 * else only once the player has been flagged idle.
 */
export function skipTurn(room: Room, requesterId: string): string | null {
  const gs = room.state;
  if (gs.phase !== "draw" && gs.phase !== "play")
    return "The round is not in progress.";
  const current = gs.players[gs.currentPlayerIndex];
  const requester = gs.players.find((p) => p.id === requesterId);
  if (!requester || requester.isBot) return "Unknown player.";
  if (current.isBot) return "Bots play on their own.";
  if (current.id === requesterId) return "It's your turn — just play!";
  if (gs.hostId !== requesterId && !room.stalled)
    return `Give ${current.name} a moment — they still have time.`;
  forfeitTurn(gs);
  room.moveSeq += 1;
  return null;
}

const BOT_LEVELS: BotLevel[] = ["easy", "normal", "hard"];

/** Host changes room rules. Unknown or invalid fields are ignored. */
export function updateSettings(
  room: Room,
  playerId: string,
  patch: Record<string, unknown>
): string | null {
  const gs = room.state;
  if (gs.hostId !== playerId) return "Only the host can change settings.";
  const next = { ...gs.settings };
  if (
    typeof patch.turnSeconds === "number" &&
    (TURN_SECONDS_OPTIONS as readonly number[]).includes(patch.turnSeconds)
  ) {
    next.turnSeconds = patch.turnSeconds;
  }
  if (typeof patch.autoSkipOffline === "boolean") {
    next.autoSkipOffline = patch.autoSkipOffline;
  }
  if (BOT_LEVELS.includes(patch.botLevel as BotLevel)) {
    next.botLevel = patch.botLevel as BotLevel;
  }
  if (next.turnSeconds !== gs.settings.turnSeconds) {
    // restart the idle clock with the new limit
    room.turnKey = null;
    room.stalled = false;
  }
  gs.settings = next;
  return null;
}

/** Host starts a rematch after game over: same seats, fresh levels. */
export function rematch(room: Room, playerId: string): string | null {
  const gs = room.state;
  if (gs.phase !== "gameOver") return "The game isn't over yet.";
  const host = gs.players.find((p) => p.id === gs.hostId);
  const hostAway = !host || (!host.connected && !host.isBot);
  if (gs.hostId !== playerId && !hostAway)
    return "Only the host can start a rematch.";
  if (hostAway) gs.hostId = playerId;
  resetGame(gs);
  room.moveSeq += 1;
  return null;
}

/**
 * With "auto-skip offline players" on, an idle player who is disconnected
 * loses the turn without anyone having to decide. Returns true if skipped.
 */
export function autoSkipIfOffline(room: Room): boolean {
  const gs = room.state;
  if (!room.stalled || !gs.settings.autoSkipOffline) return false;
  if (gs.phase !== "draw" && gs.phase !== "play") return false;
  const current = gs.players[gs.currentPlayerIndex];
  if (!current || current.isBot || current.connected) return false;
  forfeitTurn(gs);
  room.moveSeq += 1;
  return true;
}

/** Someone chose to keep waiting for an idle player: restart their clock. */
export function keepWaiting(room: Room, requesterId: string): string | null {
  if (!room.stalled) return null; // they moved in the meantime
  const requester = room.state.players.find((p) => p.id === requesterId);
  if (!requester || requester.isBot) return "Unknown player.";
  // Clearing the key makes the server arm a fresh clock on the next broadcast.
  room.turnKey = null;
  room.stalled = false;
  return null;
}

/** Foreground/background presence reported by the client. */
export function setAway(room: Room, playerId: string, away: boolean): boolean {
  const p = room.state.players.find((pl) => pl.id === playerId);
  if (!p || p.away === away) return false;
  p.away = away;
  return true;
}

export function stateFor(room: Room, playerId: string) {
  const state = sanitizeFor(room.state, playerId);
  const current = room.state.players[room.state.currentPlayerIndex];
  if (room.turnKey && current && room.turnDeadline !== null) {
    state.turnClock = {
      playerId: current.id,
      msLeft: Math.max(0, room.turnDeadline - Date.now()),
      stalled: room.stalled,
    };
  }
  return state;
}

/**
 * Explicitly leave a room. In the lobby the seat is removed entirely (with
 * host handover); in a started game the seat is kept so the player can
 * rejoin, and is just marked disconnected.
 */
export function leaveRoom(
  room: Room,
  playerId: string
): { removedSeat: boolean } {
  if (room.state.phase === "lobby") {
    const index = room.state.players.findIndex((p) => p.id === playerId);
    if (index !== -1) room.state.players.splice(index, 1);
    forgetPlayer(room, playerId);
    if (room.state.hostId === playerId) {
      const newHost =
        room.state.players.find((p) => !p.isBot && p.connected) ??
        room.state.players.find((p) => !p.isBot);
      if (newHost) {
        room.state.hostId = newHost.id;
      } else {
        // only bots (or nobody) left — drop the room
        disposeRoom(room);
      }
    }
    return { removedSeat: true };
  }
  markDisconnected(room, playerId);
  return { removedSeat: false };
}

export function markDisconnected(room: Room, playerId: string) {
  const p = room.state.players.find((pl) => pl.id === playerId);
  if (p) p.connected = false;
  room.sockets.set(playerId, null);
  if ([...room.sockets.values()].every((s) => s === null)) {
    room.emptySince = Date.now();
  }
}

// ---------- persistence ----------

export interface SavedRoom {
  id: string;
  state: GameState;
  tokens: [string, string][];
  moveSeq: number;
}

export function snapshotRooms(): SavedRoom[] {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    state: room.state,
    tokens: [...room.tokens],
    moveSeq: room.moveSeq,
  }));
}

/**
 * Load rooms saved before a restart. Every human starts out offline; their
 * browsers reconnect and rejoin with their tokens, and the game carries on.
 */
export function restoreRooms(saved: SavedRoom[]) {
  const now = Date.now();
  for (const s of saved) {
    const state = s.state;
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    const sockets = new Map<string, string | null>();
    for (const p of state.players) {
      p.away = false;
      if (!p.isBot) {
        p.connected = false;
        sockets.set(p.id, null);
      }
    }
    rooms.set(s.id, {
      id: s.id,
      state,
      sockets,
      tokens: new Map(s.tokens),
      emptySince: now,
      botTimer: null,
      moveSeq: s.moveSeq,
      turnKey: null,
      turnTimer: null,
      turnDeadline: null,
      stalled: false,
    });
  }
}

/** Remove rooms with no connected sockets for over an hour. */
export function cleanupRooms() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const room of rooms.values()) {
    if (room.emptySince !== null && room.emptySince < cutoff) {
      disposeRoom(room);
    }
  }
}
