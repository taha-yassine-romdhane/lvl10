import { COLORS } from "./deck";
import type { Card, Requirement } from "./types";

interface Candidate {
  naturalIds: string[];
  wildsNeeded: number;
}

function setCandidates(cards: Card[], size: number): Candidate[] {
  const wilds = cards.filter((c) => c.kind === "wild").length;
  const out: Candidate[] = [];
  for (let value = 1; value <= 12; value++) {
    const naturals = cards.filter(
      (c) => c.kind === "number" && c.value === value
    );
    if (naturals.length === 0) continue;
    const useNaturals = Math.min(naturals.length, size);
    const wildsNeeded = size - useNaturals;
    if (wildsNeeded <= wilds) {
      out.push({
        naturalIds: naturals.slice(0, useNaturals).map((c) => c.id),
        wildsNeeded,
      });
    }
  }
  return out;
}

function runCandidates(cards: Card[], size: number): Candidate[] {
  const wilds = cards.filter((c) => c.kind === "wild").length;
  const out: Candidate[] = [];
  for (let start = 1; start + size - 1 <= 12; start++) {
    const naturalIds: string[] = [];
    let wildsNeeded = 0;
    for (let v = start; v < start + size; v++) {
      const nat = cards.find(
        (c) => c.kind === "number" && c.value === v && !naturalIds.includes(c.id)
      );
      if (nat) naturalIds.push(nat.id);
      else wildsNeeded++;
    }
    if (naturalIds.length > 0 && wildsNeeded <= wilds) {
      out.push({ naturalIds, wildsNeeded });
    }
  }
  // Prefer candidates that use the fewest wilds.
  return out.sort((a, b) => a.wildsNeeded - b.wildsNeeded);
}

function colorCandidates(cards: Card[], size: number): Candidate[] {
  const wilds = cards.filter((c) => c.kind === "wild").length;
  const out: Candidate[] = [];
  for (const color of COLORS) {
    const naturals = cards.filter(
      (c) => c.kind === "number" && c.color === color
    );
    if (naturals.length === 0) continue;
    const useNaturals = Math.min(naturals.length, size);
    const wildsNeeded = size - useNaturals;
    if (wildsNeeded <= wilds) {
      out.push({
        naturalIds: naturals.slice(0, useNaturals).map((c) => c.id),
        wildsNeeded,
      });
    }
  }
  return out;
}

function candidatesFor(cards: Card[], req: Requirement): Candidate[] {
  switch (req.type) {
    case "set":
      return setCandidates(cards, req.size);
    case "run":
      return runCandidates(cards, req.size);
    case "color":
      return colorCandidates(cards, req.size);
  }
}

/**
 * Search for disjoint card groups in `hand` satisfying every requirement.
 * Returns card-id groups in requirement order, or null if impossible.
 */
export function findLevelGroups(
  hand: Card[],
  reqs: Requirement[]
): string[][] | null {
  function dfs(remaining: Card[], reqIndex: number): string[][] | null {
    if (reqIndex === reqs.length) return [];
    for (const cand of candidatesFor(remaining, reqs[reqIndex])) {
      const wildIds = remaining
        .filter((c) => c.kind === "wild")
        .slice(0, cand.wildsNeeded)
        .map((c) => c.id);
      if (wildIds.length < cand.wildsNeeded) continue;
      const used = new Set([...cand.naturalIds, ...wildIds]);
      const rest = remaining.filter((c) => !used.has(c.id));
      const tail = dfs(rest, reqIndex + 1);
      if (tail) return [[...cand.naturalIds, ...wildIds], ...tail];
    }
    return null;
  }
  return dfs(hand, 0);
}
