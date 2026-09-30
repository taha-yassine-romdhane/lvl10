import {
  addPlayer,
  applyAction,
  createGame,
  startRound,
} from "../src/lib/game/engine";
import { buildMeld, hitMeld } from "../src/lib/game/validate";
import type { Card, Meld } from "../src/lib/game/types";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

let n = 0;
const num = (value: number, color = "red"): Card =>
  ({ id: `t${++n}`, kind: "number", color, value } as Card);
const wild = (): Card => ({ id: `t${++n}`, kind: "wild" });
const skip = (): Card => ({ id: `t${++n}`, kind: "skip" });

// --- validation ---
check("set of 3 valid", !!buildMeld({ type: "set", size: 3 }, [num(7), num(7, "blue"), num(7, "green")]));
check("set of 3 mixed invalid", !buildMeld({ type: "set", size: 3 }, [num(7), num(8), num(7)]));
check("set with wilds valid", !!buildMeld({ type: "set", size: 3 }, [num(7), wild(), wild()]));
check("all wilds invalid", !buildMeld({ type: "set", size: 3 }, [wild(), wild(), wild()]));
check("skip never valid", !buildMeld({ type: "set", size: 3 }, [num(7), num(7), skip()]));

const run = buildMeld({ type: "run", size: 4 }, [num(3), num(5), num(6), wild()]);
check("run 3-6 with wild filling 4", !!run && run.runValues!.join(",") === "3,4,5,6");
check("run with duplicate invalid", !buildMeld({ type: "run", size: 4 }, [num(3), num(3), num(4), num(5)]));
check("run too spread invalid", !buildMeld({ type: "run", size: 4 }, [num(1), num(2), num(9), wild()]));
const runHigh = buildMeld({ type: "run", size: 4 }, [num(11), num(12), wild(), wild()]);
check("run near 12 shifts down", !!runHigh && runHigh.runValues!.join(",") === "9,10,11,12");

// requirement sizes are minimums — laying down MORE is allowed
check("set of 3 with 5 cards valid", !!buildMeld({ type: "set", size: 3 }, [num(7), num(7), num(7, "blue"), num(7, "green"), wild()]));
check("set of 3 with 2 cards invalid", !buildMeld({ type: "set", size: 3 }, [num(7), num(7)]));
const bigRun = buildMeld({ type: "run", size: 4 }, [num(3), num(4), num(5), num(6), num(7), num(8)]);
check("run of 4 with 6 cards valid", !!bigRun && bigRun.runValues!.join(",") === "3,4,5,6,7,8");
check("oversized run with dup invalid", !buildMeld({ type: "run", size: 4 }, [num(3), num(4), num(4), num(5), num(6)]));
check("color of 3 with 5 cards valid", !!buildMeld({ type: "color", size: 3 }, [num(1, "blue"), num(3, "blue"), num(5, "blue"), num(7, "blue"), wild()]));

check("color valid", !!buildMeld({ type: "color", size: 3 }, [num(1, "blue"), num(9, "blue"), wild()]));
check("color mixed invalid", !buildMeld({ type: "color", size: 3 }, [num(1, "blue"), num(9, "red"), wild()]));

// --- hitting ---
const setMeld: Meld = { id: "m1", playerId: "a", ...buildMeld({ type: "set", size: 3 }, [num(7), num(7), num(7)])! };
check("hit set with 7", !!hitMeld(setMeld, num(7)));
check("hit set with 8 fails", !hitMeld(setMeld, num(8)));
check("hit set with wild", !!hitMeld(setMeld, wild()));

const runMeld: Meld = { id: "m2", playerId: "a", ...buildMeld({ type: "run", size: 4 }, [num(3), num(4), num(5), num(6)])! };
check("hit run low with 2", hitMeld(runMeld, num(2))?.runValues?.join(",") === "2,3,4,5,6");
check("hit run high with 7", hitMeld(runMeld, num(7))?.runValues?.join(",") === "3,4,5,6,7");
check("hit run with 9 fails", !hitMeld(runMeld, num(9)));
check("hit run wild low", hitMeld(runMeld, wild(), "low")?.runValues?.[0] === 2);

const fullRun: Meld = { id: "m3", playerId: "a", ...buildMeld({ type: "run", size: 12 }, Array.from({ length: 12 }, (_, i) => num(i + 1)))! };
check("hit full run fails", !hitMeld(fullRun, wild(), "high") && !hitMeld(fullRun, wild(), "low"));

// --- full game flow ---
const gs = createGame("TEST", "p1");
addPlayer(gs, "p1", "Alice");
addPlayer(gs, "p2", "Bob");
startRound(gs);
check("round started", gs.phase === "draw" && gs.players.every((p) => p.hand.length === 10));

const first = gs.players[gs.currentPlayerIndex];
const second = gs.players[(gs.currentPlayerIndex + 1) % 2];
check("wrong turn rejected", !applyAction(gs, second.id, { type: "drawFromDeck" }).ok);
check("draw ok", applyAction(gs, first.id, { type: "drawFromDeck" }).ok);
check("double draw rejected", !applyAction(gs, first.id, { type: "drawFromDeck" }).ok);
check("hand is 11", first.hand.length === 11);

// force a level-1 hand (2 sets of 3) and lay down
first.hand = [num(4), num(4), wild(), num(9), num(9), num(9), num(2), skip(), num(5), num(6), num(11)];
const groups = [
  first.hand.slice(0, 3).map((c) => c.id),
  first.hand.slice(3, 6).map((c) => c.id),
];
const lay = applyAction(gs, first.id, { type: "layDown", groups });
check("laydown ok", lay.ok && first.laidDown && gs.melds.length === 2);
check("second laydown rejected", !applyAction(gs, first.id, { type: "layDown", groups }).ok);

// hit own set with another 4... give player a 4
const four = num(4);
first.hand.push(four);
const setMeldId = gs.melds.find((m) => m.setValue === 4)!.id;
check("hit ok", applyAction(gs, first.id, { type: "hit", meldId: setMeldId, cardId: four.id }).ok);

// discard skip targeting opponent
const skipCard = first.hand.find((c) => c.kind === "skip")!;
check("skip needs target", !applyAction(gs, first.id, { type: "discard", cardId: skipCard.id }).ok);
check("skip ok", applyAction(gs, first.id, { type: "discard", cardId: skipCard.id, skipTargetId: second.id }).ok);
check("turn skipped back to first", gs.players[gs.currentPlayerIndex].id === first.id && second.pendingSkips === 0);

// first goes out
applyAction(gs, first.id, { type: "drawFromDeck" });
first.hand = [first.hand[0]];
const out = applyAction(gs, first.id, { type: "discard", cardId: first.hand[0].id });
check("go out ends round", out.ok && gs.phase === "roundEnd");
check("first leveled up", first.level === 2);
check("second stayed and scored", second.level === 1 && second.score > 0);

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
