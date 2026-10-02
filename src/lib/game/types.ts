export type CardColor = "red" | "blue" | "green" | "yellow";

export type Card =
  | { id: string; kind: "number"; color: CardColor; value: number }
  | { id: string; kind: "wild" }
  | { id: string; kind: "skip" };

export type RequirementType = "set" | "run" | "color";

export interface Requirement {
  type: RequirementType;
  size: number;
}

export interface Meld {
  id: string;
  playerId: string;
  type: RequirementType;
  cards: Card[];
  /** for sets: the number every card represents */
  setValue?: number;
  /** for color melds: the shared color */
  color?: CardColor;
  /** for runs: represented value of cards[i] (wilds included), ascending */
  runValues?: number[];
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  level: number; // 1..10
  score: number;
  laidDown: boolean;
  completedThisRound: boolean;
  pendingSkips: number;
  connected: boolean;
  /** connected, but the app is in the background (tab hidden / screen off) */
  away: boolean;
  isBot: boolean;
}

export type GamePhase = "lobby" | "draw" | "play" | "roundEnd" | "gameOver";

export type BotLevel = "easy" | "normal" | "hard";

/** Room rules the host can change. */
export interface RoomSettings {
  /** seconds a human may idle on their turn before others are asked; 0 = off */
  turnSeconds: number;
  /** skip an offline player's turn automatically instead of asking */
  autoSkipOffline: boolean;
  botLevel: BotLevel;
}

export const TURN_SECONDS_OPTIONS = [30, 60, 90, 0] as const;

/** A skip card played on someone. `seq` goes up by one with every skip. */
export interface SkipEvent {
  seq: number;
  byId: string;
  targetId: string;
}

export interface GameState {
  roomId: string;
  hostId: string;
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  melds: Meld[];
  currentPlayerIndex: number;
  dealerIndex: number;
  phase: GamePhase;
  round: number;
  winnerIds: string[];
  log: string[];
  settings: RoomSettings;
  /** the most recent skip card played, announced to everyone at the table */
  lastSkip: SkipEvent | null;
}

/** What each individual client is allowed to see. */
export interface ClientPlayer {
  id: string;
  name: string;
  handCount: number;
  level: number;
  score: number;
  laidDown: boolean;
  completedThisRound: boolean;
  pendingSkips: number;
  connected: boolean;
  away: boolean;
  isBot: boolean;
}

export interface ClientState {
  roomId: string;
  hostId: string;
  you: { id: string; hand: Card[] };
  players: ClientPlayer[];
  discardTop: Card | null;
  drawCount: number;
  melds: Meld[];
  currentPlayerId: string | null;
  phase: GamePhase;
  round: number;
  winnerIds: string[];
  log: string[];
  settings: RoomSettings;
  lastSkip: SkipEvent | null;
  /**
   * Idle tracking for the human whose turn it is. `msLeft` counts down to the
   * idle warning; once `stalled`, other players are asked to wait or skip.
   */
  turnClock: { playerId: string; msLeft: number; stalled: boolean } | null;
}

export type GameAction =
  | { type: "drawFromDeck" }
  | { type: "drawFromDiscard" }
  | { type: "layDown"; groups: string[][] } // card ids per requirement, in level order
  | { type: "hit"; meldId: string; cardId: string; end?: "low" | "high" }
  | { type: "discard"; cardId: string; skipTargetId?: string };
