import type { Card, CardColor, Meld, Requirement } from "./types";

interface BuiltMeld {
  type: Requirement["type"];
  cards: Card[];
  setValue?: number;
  color?: CardColor;
  runValues?: number[];
}

/**
 * Check that `cards` satisfy `req`. The requirement size is a MINIMUM — you
 * may lay down more (e.g. 5 cards on a "set of 4"). Wilds may stand in for
 * any card, but at least one natural (number) card is required per group.
 * Skip cards are never valid in a meld. Returns the built meld data (with
 * wild assignments) or null.
 */
export function buildMeld(req: Requirement, cards: Card[]): BuiltMeld | null {
  if (cards.length < req.size) return null;
  if (cards.some((c) => c.kind === "skip")) return null;
  const naturals = cards.filter((c) => c.kind === "number");
  const wilds = cards.filter((c) => c.kind === "wild");
  if (naturals.length === 0) return null;

  if (req.type === "set") {
    const value = naturals[0].value;
    if (!naturals.every((c) => c.value === value)) return null;
    return { type: "set", cards: [...naturals, ...wilds], setValue: value };
  }

  if (req.type === "color") {
    const color = naturals[0].color;
    if (!naturals.every((c) => c.color === color)) return null;
    return { type: "color", cards: [...naturals, ...wilds], color };
  }

  // run — the run length is however many cards were provided (>= req.size)
  const runLength = cards.length;
  if (runLength > 12) return null;
  const values = naturals.map((c) => c.value);
  if (new Set(values).size !== values.length) return null; // duplicates can't fit one run
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min + 1 > runLength) return null;
  // Find a start position so the whole run fits within 1..12.
  let start = Math.max(1, Math.min(min, 12 - runLength + 1));
  // Ensure the window covers max as well (it will, since span <= length).
  if (start + runLength - 1 < max) start = max - runLength + 1;
  if (start < 1) return null;

  const sortedNaturals = [...naturals].sort((a, b) => a.value - b.value);
  const wildPool = [...wilds];
  const orderedCards: Card[] = [];
  const runValues: number[] = [];
  for (let v = start; v < start + runLength; v++) {
    const nat = sortedNaturals.find((c) => c.value === v);
    if (nat) {
      orderedCards.push(nat);
    } else {
      const w = wildPool.pop();
      if (!w) return null;
      orderedCards.push(w);
    }
    runValues.push(v);
  }
  return { type: "run", cards: orderedCards, runValues };
}

/**
 * While a group is still being put together: can `cards` ever become a valid
 * meld for `req`? Returns what is wrong with them, or null if they are fine so
 * far (more cards may still be needed).
 */
export function stagingProblem(req: Requirement, cards: Card[]): string | null {
  if (cards.some((c) => c.kind === "skip"))
    return "Skip cards can't be laid down.";
  const naturals = cards.filter((c) => c.kind === "number");
  if (req.type === "set") {
    return naturals.every((c) => c.value === naturals[0].value)
      ? null
      : "A set needs cards with the same number.";
  }
  if (req.type === "color") {
    return naturals.every((c) => c.color === naturals[0].color)
      ? null
      : "These cards must all be the same color.";
  }
  if (new Set(naturals.map((c) => c.value)).size !== naturals.length)
    return "A run needs numbers in a row — no repeats.";
  return cards.length > 12 ? "A run can't be longer than 12 cards." : null;
}

/**
 * Can `card` be added to `meld`? For runs, `end` picks which side a wild goes
 * on (a number card's side is inferred). Returns a new meld or null.
 */
export function hitMeld(
  meld: Meld,
  card: Card,
  end?: "low" | "high"
): Meld | null {
  if (card.kind === "skip") return null;

  if (meld.type === "set") {
    if (card.kind === "number" && card.value !== meld.setValue) return null;
    return { ...meld, cards: [...meld.cards, card] };
  }

  if (meld.type === "color") {
    if (card.kind === "number" && card.color !== meld.color) return null;
    return { ...meld, cards: [...meld.cards, card] };
  }

  // run
  const values = meld.runValues!;
  const low = values[0];
  const high = values[values.length - 1];
  let side: "low" | "high" | null = null;
  if (card.kind === "number") {
    if (card.value === low - 1) side = "low";
    else if (card.value === high + 1) side = "high";
    else return null;
  } else {
    // wild: caller picks the side, default to whichever is open
    side = end ?? (high < 12 ? "high" : "low");
  }
  if (side === "low" && low - 1 < 1) return null;
  if (side === "high" && high + 1 > 12) return null;

  if (side === "low") {
    return {
      ...meld,
      cards: [card, ...meld.cards],
      runValues: [low - 1, ...values],
    };
  }
  return {
    ...meld,
    cards: [...meld.cards, card],
    runValues: [...values, high + 1],
  };
}
