import { addPlayer, createGame, resetGame, startRound } from "../src/lib/game/engine";
import { findLevelGroups } from "../src/lib/game/solver";
import { botStep } from "../src/server/bots";
import type { BotLevel, Card } from "../src/lib/game/types";
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

// --- full bots-only game simulation, at every skill level ---
function simulate(levels: BotLevel[]) {
  const gs = createGame("BOTS", "b0");
  levels.forEach((_, i) => addPlayer(gs, `b${i}`, `Bot ${i}`, true));
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
    // each bot plays at its own skill: swap the room setting per turn
    gs.settings.botLevel = levels[gs.currentPlayerIndex];
    if (!botStep(room)) break;
  }
  return { gs, rounds, steps };
}

for (const level of ["easy", "normal", "hard"] as BotLevel[]) {
  const { gs, rounds, steps } = simulate([level, level, level]);
  console.log(
    `${level}: phase=${gs.phase}, rounds=${rounds}, steps=${steps}, levels=${gs.players
      .map((p) => p.level)
      .join(",")}`
  );
  check(`${level} bots finish a full game`, gs.phase === "gameOver");
  check(`${level}: a winner exists`, gs.winnerIds.length > 0);
  check(
    `${level}: winner reached level 11`,
    gs.players.some((p) => gs.winnerIds.includes(p.id) && p.level === 11)
  );
  check(`${level}: sane number of rounds`, rounds < 80);

  if (level === "normal") {
    resetGame(gs);
    check(
      "rematch reset: lobby, level 1, score 0, empty hands",
      gs.phase === "lobby" &&
        gs.round === 0 &&
        gs.players.every((p) => p.level === 1 && p.score === 0 && p.hand.length === 0)
    );
  }
}

// hard should beat easy more often than not
let hardWins = 0;
let easyWins = 0;
const GAMES = 30;
for (let g = 0; g < GAMES; g++) {
  // alternate seats so turn order doesn't decide it
  const seats: BotLevel[] = g % 2 ? ["hard", "easy"] : ["easy", "hard"];
  const { gs } = simulate(seats);
  for (const id of gs.winnerIds) {
    const lvl = seats[Number(id.slice(1))];
    if (lvl === "hard") hardWins++;
    else easyWins++;
  }
}
console.log(`head-to-head over ${GAMES} games: hard ${hardWins} – easy ${easyWins}`);
check("hard bots beat easy bots overall", hardWins > easyWins);

console.log(failures === 0 ? "\nAll bot tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
