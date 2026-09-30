import { addPlayer, createGame, startRound } from "../src/lib/game/engine";
import { findLevelGroups } from "../src/lib/game/solver";
import { botStep } from "../src/server/bots";
import type { Card } from "../src/lib/game/types";
import type { Room } from "../src/server/rooms";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

let n = 0;
const num = (value: number, color = "red"): Card =>
  ({ id: `t${++n}`, kind: "number", color, value } as Card);
const wild = (): Card => ({ id: `t${++n}`, kind: "wild" });

// --- solver ---
check(
  "solver finds 2 sets of 3",
  !!findLevelGroups(
    [num(4), num(4), num(4, "blue"), num(9), num(9), wild(), num(2)],
    [
      { type: "set", size: 3 },
      { type: "set", size: 3 },
    ]
  )
);
check(
  "solver rejects impossible",
  !findLevelGroups(
    [num(1), num(2), num(3), num(4), num(5), num(6), num(7)],
    [
      { type: "set", size: 3 },
      { type: "set", size: 3 },
    ]
  )
);
check(
  "solver finds run of 7 with wilds",
  !!findLevelGroups(
    [num(1), num(2), num(4), num(5), num(7), wild(), wild()],
    [{ type: "run", size: 7 }]
  )
);
check(
  "solver finds color group",
  !!findLevelGroups(
    [
      num(1, "blue"),
      num(3, "blue"),
      num(5, "blue"),
      num(7, "blue"),
      num(9, "blue"),
      num(11, "blue"),
      wild(),
    ],
    [{ type: "color", size: 7 }]
  )
);
check(
  "solver shares wilds correctly",
  !findLevelGroups(
    [num(4), num(4), num(9), wild(), num(1), num(2)],
    [
      { type: "set", size: 3 },
      { type: "set", size: 3 },
    ]
  )
);

// --- full bots-only game simulation ---
const gs = createGame("BOTS", "b1");
addPlayer(gs, "b1", "Bot A", true);
addPlayer(gs, "b2", "Bot B", true);
addPlayer(gs, "b3", "Bot C", true);
startRound(gs);

const room = { state: gs } as Room;
let steps = 0;
let rounds = 1;
while (gs.phase !== "gameOver" && steps < 100000) {
  steps++;
  if (gs.phase === "roundEnd") {
    rounds++;
    startRound(gs);
    continue;
  }
  if (!botStep(room)) break;
}

console.log(
  `game finished: phase=${gs.phase}, rounds=${rounds}, steps=${steps}, levels=${gs.players
    .map((p) => p.level)
    .join(",")}, scores=${gs.players.map((p) => p.score).join(",")}`
);
check("bots finish a full game", gs.phase === "gameOver");
check("a winner exists", gs.winnerIds.length > 0);
check(
  "winner reached level 11",
  gs.players.some((p) => gs.winnerIds.includes(p.id) && p.level === 11)
);
check("game ends in sane number of rounds", rounds < 60);

console.log(failures === 0 ? "\nAll bot tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
