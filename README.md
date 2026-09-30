# Level 10 — Online Multiplayer Card Game

A Next.js + Socket.IO implementation of the Level 10 / Phase 10-style card game. Race your friends through 10 levels of sets, runs and color groups.

## Run it

```bash
npm install
npm run dev        # dev server on http://localhost:3000
```

Production:

```bash
npm run build
npm start          # runs server.ts in production mode
```

Open http://localhost:3000 — a name is suggested for you — and hit **Create game**. Share the 4-letter room code (or use **Copy invite link**) so friends can join, or press **🤖 Add a bot** to play solo against the computer. 2–6 players (bots count).

> Note: the app needs a long-running Node server for websockets, so it can't be deployed to Vercel's serverless platform. Use Docker (below), a VPS, Railway, Render, Fly.io, or similar.

## Deploy with Docker

```bash
docker compose up -d --build   # build + run on port 3000
docker compose logs -f         # watch logs
docker compose down            # stop
```

The image is a multi-stage build (Node 22 alpine): the Next.js app is compiled in a builder stage, and the runtime stage contains only production dependencies and the built output. It runs as the unprivileged `node` user with `no-new-privileges`, a 512 MB memory limit, 1 CPU, log rotation, and a healthcheck that Docker uses to auto-restart an unhealthy container (`restart: unless-stopped`).

Server hardening (applies everywhere, not just Docker):

- All socket payloads are shape-validated before touching game logic; unknown or malformed actions are rejected.
- Socket messages are capped at 16 KB — oversized senders are disconnected.
- Per-socket rate limiting (30 events / 2 s) absorbs event floods.
- Room count is capped (500) to bound memory; idle rooms are swept hourly; bot timers stop when no human is connected and are cleared when rooms are deleted.
- Every socket handler is exception-guarded so a bad message can never crash the process; SIGTERM/SIGINT shut down cleanly.
- `scripts/e2e-security-test.ts` fuzzes the server (malformed payloads, oversized messages, event floods) and verifies it stays healthy.

## Rules (implemented)

- 108-card deck: 1–12 in four colors (×2 each), 8 wilds, 4 skips. 10 cards dealt per round.
- On your turn: draw (deck or discard — skips can't be taken), optionally lay down your level, optionally add cards to any laid melds (only after laying down your own level), then discard.
- Discarding a skip lets you choose a player to lose their next turn.
- When someone empties their hand the round ends: players who laid down advance a level, everyone else retries. Leftover cards score penalty points (5 for 1–9, 10 for 10–12, 25 for wild/skip); lowest score breaks ties among players finishing level 10.
- The 10 levels: 2×set of 3 · set 3 + run 4 · set 4 + run 4 · run 7 · run 8 · run 9 · 2×set of 4 · 7 of one color · set 5 + set 2 · set 5 + set 3.

## Code layout

- `src/lib/game/` — pure game engine (deck, levels, validation, turn state machine). No I/O; fully testable.
- `src/server/rooms.ts` — room lifecycle (create/join/reconnect/bots/cleanup).
- `src/server/bots.ts` — bot AI (draw heuristics, laydown via solver, hitting, discard choice).
- `src/lib/game/solver.ts` — finds a valid laydown for a hand (used by bots).
- `server.ts` — custom Next.js server with Socket.IO wiring.
- `src/app/page.tsx` — lobby (create/join with room code).
- `src/app/game/[roomId]/page.tsx` — game table UI.
- `scripts/engine-test.ts` — engine unit tests (`npx tsx scripts/engine-test.ts`).
- `scripts/e2e-test.ts` — two-player websocket smoke test (server must be running).
- `scripts/bot-test.ts` — solver tests + full bots-only game simulation.
- `scripts/e2e-bot-test.ts` — live human-vs-bots test over websockets.
