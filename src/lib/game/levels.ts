import type { Requirement } from "./types";

/** The 10 levels. Index 0 = level 1. */
export const LEVELS: Requirement[][] = [
  [{ type: "set", size: 3 }, { type: "set", size: 3 }], // 1: 2 sets of 3
  [{ type: "set", size: 3 }, { type: "run", size: 4 }], // 2: set of 3 + run of 4
  [{ type: "set", size: 4 }, { type: "run", size: 4 }], // 3: set of 4 + run of 4
  [{ type: "run", size: 7 }], // 4: run of 7
  [{ type: "run", size: 8 }], // 5: run of 8
  [{ type: "run", size: 9 }], // 6: run of 9
  [{ type: "set", size: 4 }, { type: "set", size: 4 }], // 7: 2 sets of 4
  [{ type: "color", size: 7 }], // 8: 7 cards of one color
  [{ type: "set", size: 5 }, { type: "set", size: 2 }], // 9: set of 5 + set of 2
  [{ type: "set", size: 5 }, { type: "set", size: 3 }], // 10: set of 5 + set of 3
];

export function describeRequirement(req: Requirement): string {
  switch (req.type) {
    case "set":
      return `Set of ${req.size}`;
    case "run":
      return `Run of ${req.size}`;
    case "color":
      return `${req.size} cards of one color`;
  }
}

export function describeLevel(level: number): string {
  return LEVELS[level - 1].map(describeRequirement).join(" + ");
}
