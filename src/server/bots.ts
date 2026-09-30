import { applyAction } from "../lib/game/engine";
import { LEVELS } from "../lib/game/levels";
import { findLevelGroups } from "../lib/game/solver";
import { hitMeld } from "../lib/game/validate";
import type { Card, GameState, Player, Requirement } from "../lib/game/types";
import type { Room } from "./rooms";

export const BOT_NAMES = [
  "Bot Ada",
  "Bot Turing",
  "Bot Lovelace",
  "Bot Hopper",
  "Bot Babbage",
];

/** How much a card helps the player's current level. Higher = keep. */
function usefulness(card: Card, hand: Card[], reqs: Requirement[]): number {
  if (card.kind === "wild") return 100;
  if (card.kind === "skip") return -1;
  let best = 0;
  for (const req of reqs) {
    if (req.type === "set") {
      const same = hand.filter(
        (c) => c.kind === "number" && c.value === card.value
      ).length;
      best = Math.max(best, same);
    } else if (req.type === "color") {
      const same = hand.filter(
        (c) => c.kind === "number" && c.color === card.color
      ).length;
      best = Math.max(best, same);
    } else {
      const near = hand.filter(
        (c) =>
          c.kind === "number" &&
          c.id !== card.id &&
          Math.abs(c.value - card.value) < req.size
      ).length;
      best = Math.max(best, near);
    }
  }
  return best;
}

function chooseSkipTarget(gs: GameState, bot: Player): string {
  const others = gs.players.filter((p) => p.id !== bot.id);
  others.sort((a, b) => a.hand.length - b.hand.length || b.level - a.level);
  return others[0].id;
}

/**
 * Perform exactly one action for the bot whose turn it is.
 * Returns false when it's not a bot's turn (or the round is over).
 */
export function botStep(room: Room): boolean {
  const gs = room.state;
  if (gs.phase !== "draw" && gs.phase !== "play") return false;
  const bot = gs.players[gs.currentPlayerIndex];
  if (!bot.isBot) return false;
  const reqs = LEVELS[Math.min(bot.level, 10) - 1];

  if (gs.phase === "draw") {
    // Only take the discard when it makes guaranteed progress (completes the
    // laydown or can be hit onto a meld right away) — anything weaker can
    // livelock two bots into swapping the same card forever.
    const top = gs.discardPile[gs.discardPile.length - 1];
    let takeDiscard = false;
    if (top && top.kind !== "skip") {
      if (!bot.laidDown) {
        takeDiscard = findLevelGroups([...bot.hand, top], reqs) !== null;
      } else {
        takeDiscard = gs.melds.some((m) => hitMeld(m, top));
      }
    }
    const action = takeDiscard
      ? ({ type: "drawFromDiscard" } as const)
      : ({ type: "drawFromDeck" } as const);
    if (!applyAction(gs, bot.id, action).ok) {
      applyAction(gs, bot.id, { type: "drawFromDeck" });
    }
    return true;
  }

  // play phase: try to lay down
  if (!bot.laidDown) {
    const groups = findLevelGroups(bot.hand, reqs);
    if (groups && applyAction(gs, bot.id, { type: "layDown", groups }).ok) {
      return true;
    }
  }

  // try one hit
  if (bot.laidDown) {
    for (const card of bot.hand) {
      if (card.kind === "skip") continue;
      for (const meld of gs.melds) {
        if (hitMeld(meld, card)) {
          if (
            applyAction(gs, bot.id, {
              type: "hit",
              meldId: meld.id,
              cardId: card.id,
            }).ok
          ) {
            return true;
          }
        }
      }
    }
  }

  // discard: skips first (they're 25 points and block someone), then the
  // least useful non-wild card; wilds only as a last resort.
  const skipCard = bot.hand.find((c) => c.kind === "skip");
  if (skipCard) {
    applyAction(gs, bot.id, {
      type: "discard",
      cardId: skipCard.id,
      skipTargetId: chooseSkipTarget(gs, bot),
    });
    return true;
  }
  const ranked = [...bot.hand].sort(
    (a, b) => usefulness(a, bot.hand, reqs) - usefulness(b, bot.hand, reqs)
  );
  applyAction(gs, bot.id, { type: "discard", cardId: ranked[0].id });
  return true;
}
