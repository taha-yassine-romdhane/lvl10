import type { Card, CardColor } from "./types";

export const COLORS: CardColor[] = ["red", "blue", "green", "yellow"];

let nextId = 0;
function cid(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}-${Math.floor(Math.random() * 1e6)}`;
}

/** 96 number cards (1-12, twice per color), 8 wilds, 4 skips = 108 cards. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 12; value++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: cid("n"), kind: "number", color, value });
      }
    }
  }
  for (let i = 0; i < 8; i++) deck.push({ id: cid("w"), kind: "wild" });
  for (let i = 0; i < 4; i++) deck.push({ id: cid("s"), kind: "skip" });
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardPenalty(card: Card): number {
  if (card.kind === "wild" || card.kind === "skip") return 25;
  return card.value <= 9 ? 5 : 10;
}
