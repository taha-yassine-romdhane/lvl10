import { buildDeck, cardPenalty, shuffle } from "./deck";
import { LEVELS } from "./levels";
import { buildMeld, hitMeld } from "./validate";
import type {
  Card,
  ClientState,
  GameAction,
  GameState,
  Meld,
  Player,
  RoomSettings,
} from "./types";

const HAND_SIZE = 10;

let meldSeq = 0;

export const DEFAULT_SETTINGS: RoomSettings = {
  turnSeconds: 30,
  autoSkipOffline: false,
  botLevel: "normal",
};

export function createGame(
  roomId: string,
  hostId: string,
  settings: RoomSettings = DEFAULT_SETTINGS
): GameState {
  return {
    roomId,
    hostId,
    players: [],
    drawPile: [],
    discardPile: [],
    melds: [],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: "lobby",
    round: 0,
    winnerIds: [],
    log: [],
    settings: { ...settings },
    lastSkip: null,
  };
}

/** Back to the lobby with the same seats for a rematch. */
export function resetGame(gs: GameState) {
  gs.phase = "lobby";
  gs.round = 0;
  gs.drawPile = [];
  gs.discardPile = [];
  gs.melds = [];
  gs.winnerIds = [];
  gs.currentPlayerIndex = 0;
  gs.dealerIndex = 0;
  gs.log = ["Rematch! Waiting for the host to start."];
  for (const p of gs.players) {
    p.hand = [];
    p.level = 1;
    p.score = 0;
    p.laidDown = false;
    p.completedThisRound = false;
    p.pendingSkips = 0;
  }
}

export function addPlayer(
  gs: GameState,
  id: string,
  name: string,
  isBot = false
): Player {
  const player: Player = {
    id,
    name,
    isBot,
    hand: [],
    level: 1,
    score: 0,
    laidDown: false,
    completedThisRound: false,
    pendingSkips: 0,
    connected: true,
    away: false,
  };
  gs.players.push(player);
  return player;
}

function log(gs: GameState, message: string) {
  gs.log.push(message);
  if (gs.log.length > 50) gs.log.shift();
}

export function startRound(gs: GameState) {
  gs.round += 1;
  gs.melds = [];
  const deck = shuffle(buildDeck());
  for (const p of gs.players) {
    p.hand = deck.splice(0, HAND_SIZE);
    p.laidDown = false;
    p.completedThisRound = false;
    p.pendingSkips = 0;
  }
  gs.discardPile = [deck.shift()!];
  gs.drawPile = deck;
  gs.dealerIndex = (gs.round - 1) % gs.players.length;
  gs.currentPlayerIndex = (gs.dealerIndex + 1) % gs.players.length;
  gs.phase = "draw";
  log(gs, `Round ${gs.round} started.`);
  // If the very first player has pending skips (impossible on fresh deal, but safe):
  resolveSkips(gs);
}

function currentPlayer(gs: GameState): Player {
  return gs.players[gs.currentPlayerIndex];
}

function refillDrawPile(gs: GameState) {
  if (gs.drawPile.length > 0) return;
  const top = gs.discardPile.pop();
  gs.drawPile = shuffle(gs.discardPile);
  gs.discardPile = top ? [top] : [];
}

function resolveSkips(gs: GameState) {
  // Skip over players with pending skips (consuming one per pass).
  let guard = 0;
  while (currentPlayer(gs).pendingSkips > 0 && guard < 20) {
    const p = currentPlayer(gs);
    p.pendingSkips -= 1;
    log(gs, `${p.name} is skipped.`);
    gs.currentPlayerIndex = (gs.currentPlayerIndex + 1) % gs.players.length;
    guard += 1;
  }
}

function advanceTurn(gs: GameState) {
  gs.currentPlayerIndex = (gs.currentPlayerIndex + 1) % gs.players.length;
  gs.phase = "draw";
  resolveSkips(gs);
}

function endRound(gs: GameState, outPlayer: Player) {
  log(gs, `${outPlayer.name} went out!`);
  for (const p of gs.players) {
    p.score += p.hand.reduce((sum, c) => sum + cardPenalty(c), 0);
    if (p.laidDown) {
      p.completedThisRound = true;
      if (p.level < 10) {
        p.level += 1;
      } else {
        p.level = 11; // finished the game
      }
    }
  }
  const finishers = gs.players.filter((p) => p.level > 10);
  if (finishers.length > 0) {
    const best = Math.min(...finishers.map((p) => p.score));
    gs.winnerIds = finishers.filter((p) => p.score === best).map((p) => p.id);
    gs.phase = "gameOver";
    const names = gs.players
      .filter((p) => gs.winnerIds.includes(p.id))
      .map((p) => p.name)
      .join(", ");
    log(gs, `Game over — winner: ${names}!`);
  } else {
    gs.phase = "roundEnd";
  }
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export function applyAction(
  gs: GameState,
  playerId: string,
  action: GameAction
): ActionResult {
  const player = gs.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: "Unknown player." };
  if (gs.phase !== "draw" && gs.phase !== "play")
    return { ok: false, error: "The round is not in progress." };
  if (currentPlayer(gs).id !== playerId)
    return { ok: false, error: "It is not your turn." };

  switch (action.type) {
    case "drawFromDeck": {
      if (gs.phase !== "draw") return { ok: false, error: "You already drew." };
      refillDrawPile(gs);
      const card = gs.drawPile.shift();
      gs.phase = "play";
      if (!card) {
        // Every card is in hands or melds — let the turn continue without a
        // draw instead of deadlocking the round.
        log(gs, `The deck is empty — ${player.name} plays without drawing.`);
        return { ok: true };
      }
      player.hand.push(card);
      log(gs, `${player.name} drew from the deck.`);
      return { ok: true };
    }

    case "drawFromDiscard": {
      if (gs.phase !== "draw") return { ok: false, error: "You already drew." };
      const top = gs.discardPile[gs.discardPile.length - 1];
      if (!top) return { ok: false, error: "Discard pile is empty." };
      if (top.kind === "skip")
        return { ok: false, error: "Skip cards can't be picked up." };
      gs.discardPile.pop();
      player.hand.push(top);
      gs.phase = "play";
      log(gs, `${player.name} took the discard.`);
      return { ok: true };
    }

    case "layDown": {
      if (gs.phase !== "play")
        return { ok: false, error: "Draw a card first." };
      if (player.laidDown)
        return { ok: false, error: "You already laid down this round." };
      const reqs = LEVELS[player.level - 1];
      if (action.groups.length !== reqs.length)
        return { ok: false, error: "Wrong number of groups for your level." };
      const allIds = action.groups.flat();
      if (new Set(allIds).size !== allIds.length)
        return { ok: false, error: "A card was used twice." };
      const groups: Card[][] = [];
      for (const ids of action.groups) {
        const cards: Card[] = [];
        for (const id of ids) {
          const card = player.hand.find((c) => c.id === id);
          if (!card) return { ok: false, error: "Card not in your hand." };
          cards.push(card);
        }
        groups.push(cards);
      }
      const built = [];
      for (let i = 0; i < reqs.length; i++) {
        const meld = buildMeld(reqs[i], groups[i]);
        if (!meld)
          return {
            ok: false,
            error: `Group ${i + 1} doesn't satisfy "${reqs[i].type} of ${reqs[i].size}".`,
          };
        built.push(meld);
      }
      for (const b of built) {
        meldSeq += 1;
        // Random suffix: ids must stay unique after games are reloaded from disk.
        const meld: Meld = {
          id: `m${meldSeq}-${Math.random().toString(36).slice(2, 8)}`,
          playerId,
          ...b,
        };
        gs.melds.push(meld);
      }
      const used = new Set(allIds);
      player.hand = player.hand.filter((c) => !used.has(c.id));
      player.laidDown = true;
      log(gs, `${player.name} laid down level ${player.level}!`);
      if (player.hand.length === 0) endRound(gs, player);
      return { ok: true };
    }

    case "hit": {
      if (gs.phase !== "play")
        return { ok: false, error: "Draw a card first." };
      if (!player.laidDown)
        return { ok: false, error: "Lay down your level before hitting." };
      const meldIndex = gs.melds.findIndex((m) => m.id === action.meldId);
      if (meldIndex === -1) return { ok: false, error: "Meld not found." };
      const card = player.hand.find((c) => c.id === action.cardId);
      if (!card) return { ok: false, error: "Card not in your hand." };
      const updated = hitMeld(gs.melds[meldIndex], card, action.end);
      if (!updated)
        return { ok: false, error: "That card doesn't fit there." };
      gs.melds[meldIndex] = updated;
      player.hand = player.hand.filter((c) => c.id !== card.id);
      log(gs, `${player.name} added a card to a meld.`);
      if (player.hand.length === 0) endRound(gs, player);
      return { ok: true };
    }

    case "discard": {
      if (gs.phase !== "play")
        return { ok: false, error: "Draw a card first." };
      const card = player.hand.find((c) => c.id === action.cardId);
      if (!card) return { ok: false, error: "Card not in your hand." };
      if (card.kind === "skip") {
        const target = gs.players.find((p) => p.id === action.skipTargetId);
        if (!target || target.id === player.id)
          return { ok: false, error: "Choose another player to skip." };
        target.pendingSkips += 1;
        gs.lastSkip = {
          seq: (gs.lastSkip?.seq ?? 0) + 1,
          byId: player.id,
          targetId: target.id,
        };
        log(gs, `${player.name} skipped ${target.name}!`);
      } else {
        log(gs, `${player.name} discarded.`);
      }
      player.hand = player.hand.filter((c) => c.id !== card.id);
      gs.discardPile.push(card);
      if (player.hand.length === 0) {
        endRound(gs, player);
      } else {
        advanceTurn(gs);
      }
      return { ok: true };
    }
  }
  // Reached only with a malformed action object from an untrusted client.
  return { ok: false, error: "Unknown action." };
}

/**
 * End the current player's turn without them acting (idle / skipped by the
 * host). If they already drew, the most recently drawn card (the last one in
 * hand) goes to the discard pile — without a skip effect — so their hand size
 * stays fair. A forfeit never makes a player go out.
 */
export function forfeitTurn(gs: GameState): boolean {
  if (gs.phase !== "draw" && gs.phase !== "play") return false;
  const player = currentPlayer(gs);
  if (gs.phase === "play" && player.hand.length > 1) {
    gs.discardPile.push(player.hand.pop()!);
  }
  log(gs, `${player.name}'s turn was skipped.`);
  advanceTurn(gs);
  return true;
}

/**
 * Remove a player from the game entirely (kick). Their hand is shuffled back
 * into the draw pile; melds they already laid down stay on the table.
 */
export function removePlayer(gs: GameState, playerId: string): boolean {
  const index = gs.players.findIndex((p) => p.id === playerId);
  if (index === -1) return false;
  const [removed] = gs.players.splice(index, 1);
  gs.winnerIds = gs.winnerIds.filter((id) => id !== playerId);
  if (gs.phase === "lobby") return true;
  gs.drawPile = shuffle([...gs.drawPile, ...removed.hand]);
  removed.hand = [];
  if (gs.players.length === 0) return true;
  if (gs.dealerIndex > index) gs.dealerIndex -= 1;
  gs.dealerIndex %= gs.players.length;
  const wasTheirTurn = index === gs.currentPlayerIndex;
  if (index < gs.currentPlayerIndex) gs.currentPlayerIndex -= 1;
  gs.currentPlayerIndex %= gs.players.length;
  log(gs, `${removed.name} was removed from the game.`);
  if (wasTheirTurn && (gs.phase === "draw" || gs.phase === "play")) {
    gs.phase = "draw";
    resolveSkips(gs);
  }
  return true;
}

export function sanitizeFor(gs: GameState, playerId: string): ClientState {
  const you = gs.players.find((p) => p.id === playerId);
  return {
    roomId: gs.roomId,
    hostId: gs.hostId,
    you: { id: playerId, hand: you ? you.hand : [] },
    players: gs.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      level: p.level,
      score: p.score,
      laidDown: p.laidDown,
      completedThisRound: p.completedThisRound,
      pendingSkips: p.pendingSkips,
      connected: p.connected,
      away: p.away,
      isBot: p.isBot,
    })),
    discardTop: gs.discardPile[gs.discardPile.length - 1] ?? null,
    drawCount: gs.drawPile.length,
    melds: gs.melds,
    currentPlayerId:
      gs.phase === "draw" || gs.phase === "play"
        ? gs.players[gs.currentPlayerIndex]?.id ?? null
        : null,
    phase: gs.phase,
    round: gs.round,
    winnerIds: gs.winnerIds,
    log: gs.log.slice(-15),
    settings: gs.settings,
    lastSkip: gs.lastSkip,
    turnClock: null,
  };
}
