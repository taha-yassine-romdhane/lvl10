"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  FaBan,
  FaCheck,
  FaChevronLeft,
  FaCircleQuestion,
  FaChevronRight,
  FaCopy,
  FaCrown,
  FaDice,
  FaForwardStep,
  FaHourglassHalf,
  FaPalette,
  FaPlus,
  FaRightFromBracket,
  FaRobot,
  FaRotateRight,
  FaSliders,
  FaTrophy,
  FaTriangleExclamation,
  FaUserSlash,
  FaXmark,
  FaWandMagicSparkles,
} from "react-icons/fa6";
import { getSocket } from "@/lib/clientSocket";
import { Wordmark } from "@/components/Brand";
import { CardBack, CardView } from "@/components/CardView";
import { ThemePicker } from "@/components/ThemePicker";
import { HowToPlay, Modal, SettingsPanel } from "@/components/GameExtras";
import { LEVELS, describeLevel, describeRequirement } from "@/lib/game/levels";
import { hitMeld } from "@/lib/game/validate";
import { randomName } from "@/lib/names";
import type {
  Card,
  ClientPlayer,
  ClientState,
  Meld,
  RoomSettings,
} from "@/lib/game/types";

const COLOR_ORDER = { red: 0, blue: 1, green: 2, yellow: 3 } as const;

const AVATAR_BG = [
  "bg-rose-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-teal-500",
];

function sortHand(hand: Card[], mode: "number" | "color"): Card[] {
  return [...hand].sort((a, b) => {
    const rank = (c: Card) =>
      c.kind === "wild" ? 100 : c.kind === "skip" ? 101 : 0;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.kind !== "number" || b.kind !== "number") return 0;
    if (mode === "color") {
      return COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.value - b.value;
    }
    return a.value - b.value || COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
  });
}

type Presence = "online" | "away" | "offline";

/** Live connection status of a human player (bots have none). */
function presenceOf(p: ClientPlayer): Presence | undefined {
  if (p.isBot) return undefined;
  if (!p.connected) return "offline";
  return p.away ? "away" : "online";
}

const PRESENCE_STYLE: Record<Presence, { dot: string; label: string }> = {
  online: { dot: "bg-emerald-400", label: "Online" },
  away: { dot: "bg-amber-400", label: "Away — app in background" },
  offline: { dot: "bg-slate-500", label: "Offline — reconnecting…" },
};

function Avatar({
  name,
  index,
  small,
  status,
}: {
  name: string;
  index: number;
  small?: boolean;
  status?: Presence;
}) {
  return (
    <span
      className={`${AVATAR_BG[index % AVATAR_BG.length]} ${
        small ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm"
      } relative flex shrink-0 items-center justify-center rounded-full font-black text-white shadow ${
        status === "offline" ? "opacity-50 grayscale" : ""
      }`}
    >
      {name.replace("Bot ", "").charAt(0).toUpperCase()}
      {status && (
        <span
          title={PRESENCE_STYLE[status].label}
          aria-label={PRESENCE_STYLE[status].label}
          className={`absolute -right-0.5 -bottom-0.5 rounded-full outline-2 outline-slate-900 ${
            small ? "h-2.5 w-2.5" : "h-3 w-3"
          } ${PRESENCE_STYLE[status].dot} ${
            status === "online" ? "presence-pulse" : ""
          }`}
        />
      )}
    </span>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 50 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 4,
        duration: 3 + Math.random() * 3,
        color: ["#f43f5e", "#38bdf8", "#34d399", "#fbbf24", "#a78bfa"][i % 5],
      })),
    []
  );
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </>
  );
}

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const code = (roomId ?? "").toUpperCase();

  const [state, setState] = useState<ClientState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[][]>([]);
  const [skipPickFor, setSkipPickFor] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"number" | "color" | "custom">(
    "number"
  );
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const [clockDeadline, setClockDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [sheet, setSheet] = useState<"settings" | "help" | null>(null);
  // First-game tip; initial render is "Connecting…", so reading storage in
  // the initializer can't cause a hydration mismatch.
  const [showTip, setShowTip] = useState(() => {
    try {
      return typeof window !== "undefined" && !localStorage.getItem("lvl10:tip-done");
    } catch {
      return false;
    }
  });

  const join = useCallback(
    (name: string) => {
      const socket = getSocket();
      const token = localStorage.getItem(`lvl10:token:${code}`) ?? undefined;
      socket.emit(
        "joinRoom",
        { roomId: code, name, token },
        (res: { token?: string; error?: string }) => {
          if (res.error || !res.token) {
            setError(res.error ?? "Could not join.");
            setNeedsName(true);
            return;
          }
          localStorage.setItem(`lvl10:token:${code}`, res.token);
          localStorage.setItem("lvl10:name", name);
          setNeedsName(false);
        }
      );
    },
    [code]
  );

  useEffect(() => {
    const socket = getSocket();
    const onState = (s: ClientState) => {
      // Ignore stray updates from any other room this socket was in.
      if (s.roomId !== code) return;
      setState(s);
      setNow(Date.now());
      setClockDeadline(
        s.turnClock ? Date.now() + s.turnClock.msLeft : null
      );
    };
    const onError = (message: string) => setError(message);
    const onKicked = (roomId: string) => {
      if (roomId !== code) return;
      localStorage.removeItem(`lvl10:token:${code}`);
      router.push("/?kicked=1");
    };
    socket.on("gameState", onState);
    socket.on("errorMessage", onError);
    socket.on("kicked", onKicked);

    const name = localStorage.getItem("lvl10:name");
    if (name) {
      join(name);
    } else {
      setJoinName(randomName());
      setNeedsName(true);
    }
    const onReconnect = () => {
      const n = localStorage.getItem("lvl10:name");
      if (n) join(n);
    };
    socket.io.on("reconnect", onReconnect);

    // Our own connection: drives the "Reconnecting…" banner.
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    const goOffline = () => setOnline(false);
    const goOnline = () => {
      // The browser is back online: reconnect right away instead of waiting
      // for socket.io's backoff timer.
      if (!socket.connected) socket.connect();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    // Tell the others when the app goes to the background (phone locked,
    // switched apps, tab hidden).
    const reportPresence = () =>
      socket.emit("presence", { away: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", reportPresence);
    socket.on("connect", reportPresence);

    return () => {
      socket.off("gameState", onState);
      socket.off("errorMessage", onError);
      socket.off("kicked", onKicked);
      socket.io.off("reconnect", onReconnect);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", reportPresence);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", reportPresence);
    };
  }, [code, join, router]);

  // Tick once a second while a turn clock is running.
  useEffect(() => {
    if (clockDeadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [clockDeadline]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const you = useMemo(
    () => state?.players.find((p) => p.id === state.you.id) ?? null,
    [state]
  );
  const myTurn = state !== null && state.currentPlayerId === state.you.id;
  const reqs = you ? LEVELS[Math.min(you.level, 10) - 1] : [];

  const clock = state?.turnClock ?? null;
  const clockSecs =
    clock && clockDeadline !== null
      ? Math.max(0, Math.ceil((clockDeadline - now) / 1000))
      : null;
  const youAreIdle = Boolean(clock?.stalled && clock.playerId === state?.you.id);

  useEffect(() => {
    document.title = youAreIdle
      ? "⚠ Still there? — Level 10"
      : myTurn
        ? "● Your turn — Level 10"
        : "Level 10";
  }, [myTurn, youAreIdle]);

  // Buzz the phone when it becomes your turn, and harder when you're idle.
  useEffect(() => {
    if (myTurn) navigator.vibrate?.(60);
  }, [myTurn]);
  useEffect(() => {
    if (youAreIdle) navigator.vibrate?.([120, 80, 120]);
  }, [youAreIdle]);

  // Keep the screen awake while a round is being played.
  const inRound = state?.phase === "draw" || state?.phase === "play";
  useEffect(() => {
    if (!inRound || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => undefined);
    };
  }, [inRound]);

  useEffect(() => {
    setStaged(reqs.map(() => []));
    setSelected([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you?.level, state?.round, you?.laidDown]);

  const leave = useCallback(() => {
    getSocket().emit("leaveRoom", (res?: { removedSeat: boolean }) => {
      if (res?.removedSeat) {
        localStorage.removeItem(`lvl10:token:${code}`);
      }
      router.push("/");
    });
  }, [code, router]);

  function copyInvite() {
    navigator.clipboard
      .writeText(`${location.origin}/game/${code}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
  }

  if (needsName) {
    return (
      <main className="table-bg flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-white">
        <div className="panel pop-in flex flex-col items-center gap-4 rounded-3xl p-8">
          <Wordmark className="text-xl text-slate-300" />
          <h1 className="text-3xl font-black">
            Join room <span className="accent font-mono">{code}</span>
          </h1>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && joinName.trim() && join(joinName.trim())
              }
              maxLength={20}
              placeholder="Your name"
              className="rounded-xl border border-slate-600/60 bg-slate-950/60 px-4 py-2.5 outline-none focus:border-indigo-400"
            />
            <button
              onClick={() => setJoinName(randomName())}
              title="Random name"
              className="flex items-center rounded-xl bg-slate-700/70 px-3.5 hover:bg-slate-600"
            >
              <FaDice className="h-4 w-4" />
            </button>
            <button
              onClick={() => joinName.trim() && join(joinName.trim())}
              className="btn-accent rounded-xl px-5 font-bold hover:brightness-110"
            >
              Join
            </button>
          </div>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-slate-400 underline hover:text-slate-300"
          >
            Back to lobby
          </button>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="table-bg flex min-h-screen items-center justify-center text-slate-400">
        <div className="pop-in flex items-center gap-3">
          <span className="accent-bg h-3 w-3 animate-ping rounded-full" />
          Connecting…
        </div>
      </main>
    );
  }

  const socket = getSocket();
  const stagedIds = new Set(staged.flat());
  const hand = state.you.hand;
  const isHost = state.hostId === state.you.id;
  const hostPlayer = state.players.find((p) => p.id === state.hostId);
  const hostAway = !hostPlayer || (!hostPlayer.connected && !hostPlayer.isBot);

  function changeSettings(patch: Partial<RoomSettings>) {
    socket.emit("updateSettings", patch);
  }

  function dismissTip() {
    setShowTip(false);
    try {
      localStorage.setItem("lvl10:tip-done", "1");
    } catch {
      // private mode: the tip just shows again next time
    }
  }

  // Settings / rules sheet, available in every phase.
  const sheetView =
    sheet === "settings" ? (
      <Modal
        title={
          <>
            <FaSliders className="accent h-4 w-4" /> Room {code}
          </>
        }
        onClose={() => setSheet(null)}
      >
        <button
          onClick={copyInvite}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-700/70 py-2.5 text-sm font-bold transition-colors hover:bg-slate-600"
        >
          {copied ? (
            <>
              <FaCheck className="h-3.5 w-3.5 text-emerald-400" /> Link copied!
            </>
          ) : (
            <>
              <FaCopy className="h-3.5 w-3.5" /> Copy invite link
            </>
          )}
        </button>
        <SettingsPanel
          settings={state.settings}
          editable={isHost}
          onChange={changeSettings}
        />
      </Modal>
    ) : sheet === "help" ? (
      <Modal
        title={
          <>
            <FaCircleQuestion className="accent h-4 w-4" /> How to play
          </>
        }
        onClose={() => setSheet(null)}
      >
        <HowToPlay />
      </Modal>
    ) : null;

  function toggleSelect(id: string) {
    setSelected((sel) =>
      sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]
    );
  }

  function stageSelected(groupIndex: number) {
    setStaged((groups) =>
      groups.map((g, i) => (i === groupIndex ? [...g, ...selected] : g))
    );
    setSelected([]);
  }

  function unstage(groupIndex: number, cardId: string) {
    setStaged((groups) =>
      groups.map((g, i) =>
        i === groupIndex ? g.filter((id) => id !== cardId) : g
      )
    );
  }

  function layDown() {
    socket.emit("action", { type: "layDown", groups: staged });
  }

  function hit(meld: Meld, end?: "low" | "high") {
    socket.emit("action", {
      type: "hit",
      meldId: meld.id,
      cardId: selected[0],
      end,
    });
    setSelected([]);
  }

  function discard() {
    const card = hand.find((c) => c.id === selected[0]);
    if (card?.kind === "skip") {
      setSkipPickFor(card.id);
      return;
    }
    socket.emit("action", { type: "discard", cardId: selected[0] });
    setSelected([]);
  }

  function discardSkip(targetId: string) {
    if (!skipPickFor) return;
    socket.emit("action", {
      type: "discard",
      cardId: skipPickFor,
      skipTargetId: targetId,
    });
    setSkipPickFor(null);
    setSelected([]);
  }

  const selectedCard =
    selected.length === 1
      ? hand.find((c) => c.id === selected[0]) ?? null
      : null;
  // The card being considered against melds: a single dragged card wins over
  // the click-selection.
  const activeCard =
    dragIds?.length === 1
      ? hand.find((c) => c.id === dragIds[0]) ?? null
      : selectedCard;
  const singleWildSelected = selectedCard?.kind === "wild";
  const canHitNow = Boolean(
    myTurn && state.phase === "play" && you?.laidDown && activeCard
  );

  function startDrag(e: React.DragEvent, card: Card) {
    const ids = selected.includes(card.id) ? selected : [card.id];
    setDragIds(ids);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
  }

  function dropOnGroup(e: React.DragEvent, groupIndex: number) {
    e.preventDefault();
    if (!dragIds) return;
    const ids = dragIds.filter(
      (id) => hand.some((c) => c.id === id) && !stagedIds.has(id)
    );
    setStaged((groups) =>
      groups.map((g, i) => (i === groupIndex ? [...g, ...ids] : g))
    );
    setSelected((sel) => sel.filter((id) => !ids.includes(id)));
    setDragIds(null);
  }

  function dropOnDiscard(e: React.DragEvent) {
    e.preventDefault();
    const ids = dragIds;
    setDragIds(null);
    if (!ids) return;
    if (!myTurn || state?.phase !== "play") {
      setError("You can only discard on your turn, after drawing.");
      return;
    }
    if (ids.length !== 1) {
      setError("Drag a single card to the discard pile.");
      return;
    }
    const card = hand.find((c) => c.id === ids[0]);
    if (!card) return;
    if (card.kind === "skip") {
      setSkipPickFor(card.id);
      return;
    }
    socket.emit("action", { type: "discard", cardId: card.id });
    setSelected([]);
  }

  function dropOnMeld(e: React.DragEvent, meld: Meld) {
    e.preventDefault();
    const ids = dragIds;
    setDragIds(null);
    if (!ids || ids.length !== 1) return;
    const card = hand.find((c) => c.id === ids[0]);
    if (!card) return;
    if (!myTurn || state?.phase !== "play" || !you?.laidDown) {
      setError("Lay down your level first — then you can add to melds.");
      return;
    }
    if (!hitMeld(meld, card)) {
      setError("That card doesn't fit this meld.");
      return;
    }
    socket.emit("action", { type: "hit", meldId: meld.id, cardId: card.id });
    setSelected([]);
  }

  const unstagedHand = hand.filter((c) => !stagedIds.has(c.id));
  const displayedHand =
    sortMode === "custom"
      ? [...unstagedHand].sort((a, b) => {
          const ia = customOrder.indexOf(a.id);
          const ib = customOrder.indexOf(b.id);
          return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
        })
      : sortHand(unstagedHand, sortMode);

  /** Drop a dragged card (or selection) onto another hand card to reorder. */
  function dropOnHandCard(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    e.stopPropagation();
    const ids = dragIds;
    setDragIds(null);
    if (!ids || ids.includes(targetId)) return;
    const current = displayedHand.map((c) => c.id);
    const moving = ids.filter((id) => current.includes(id));
    if (moving.length === 0) return;
    const rest = current.filter((id) => !moving.includes(id));
    const ti = rest.indexOf(targetId);
    // Dragging rightward drops AFTER the target, leftward drops BEFORE it —
    // so a one-position move works in both directions.
    const movingRight = current.indexOf(moving[0]) < current.indexOf(targetId);
    const insertAt = movingRight ? ti + 1 : ti;
    setCustomOrder([
      ...rest.slice(0, insertAt),
      ...moving,
      ...rest.slice(insertAt),
    ]);
    setSortMode("custom");
  }

  // ---------- lobby ----------
  if (state.phase === "lobby") {
    return (
      <main className="table-bg relative flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-white">
        <ThemePicker className="absolute top-4 right-4" />
        <div className="pop-in flex flex-col items-center text-center">
          <Wordmark className="mb-2 text-xl text-slate-300" />
          <h1 className="text-4xl font-black">
            Room{" "}
            <span className="title-shimmer font-mono tracking-widest">
              {code}
            </span>
          </h1>
          <button
            onClick={copyInvite}
            className="mt-3 flex items-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2 text-sm font-bold transition-colors hover:bg-slate-700"
          >
            {copied ? (
              <>
                <FaCheck className="h-3.5 w-3.5 text-emerald-400" /> Link
                copied!
              </>
            ) : (
              <>
                <FaCopy className="h-3.5 w-3.5" /> Copy invite link
              </>
            )}
          </button>
        </div>
        <div className="panel pop-in w-full max-w-sm rounded-3xl p-6" style={{ animationDelay: "80ms" }}>
          <h2 className="mb-4 text-sm font-bold tracking-wide text-slate-400 uppercase">
            Players ({state.players.length}/6)
          </h2>
          <ul className="flex flex-col gap-3">
            {state.players.map((p, i) => (
              <li key={p.id} className="pop-in flex items-center gap-3">
                <Avatar name={p.name} index={i} status={presenceOf(p)} />
                <span className="font-bold">
                  {p.isBot && (
                    <FaRobot className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-slate-400" />
                  )}
                  {p.name}
                </span>
                {p.id === state.hostId && (
                  <span className="accent-banner rounded-full border px-2 py-0.5 text-xs font-bold">
                    host
                  </span>
                )}
                {p.id === state.you.id && (
                  <span className="text-xs text-slate-500">you</span>
                )}
                {presenceOf(p) && presenceOf(p) !== "online" && (
                  <span className="text-xs text-slate-400">
                    {presenceOf(p)}
                  </span>
                )}
                {isHost && p.isBot && (
                  <button
                    onClick={() => socket.emit("removeBot", { botId: p.id })}
                    className="ml-auto px-2 py-1 text-xs text-red-400 hover:underline"
                  >
                    remove
                  </button>
                )}
                {isHost && !p.isBot && p.id !== state.you.id && (
                  <button
                    onClick={() =>
                      socket.emit("kickPlayer", { playerId: p.id })
                    }
                    className="ml-auto px-2 py-1 text-xs text-red-400 hover:underline"
                  >
                    kick
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && state.players.length < 6 && (
            <button
              onClick={() => socket.emit("addBot")}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-2.5 text-sm font-bold text-slate-300 transition-colors hover:border-slate-400 hover:text-white"
            >
              <FaRobot className="h-4 w-4" />
              <FaPlus className="h-2.5 w-2.5" /> Add a bot
            </button>
          )}
        </div>
        <div
          className="panel pop-in w-full max-w-sm rounded-3xl p-6"
          style={{ animationDelay: "140ms" }}
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-400 uppercase">
            <FaSliders className="h-3.5 w-3.5" /> Room rules
          </h2>
          <SettingsPanel
            settings={state.settings}
            editable={isHost}
            onChange={changeSettings}
          />
        </div>
        {isHost ? (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => socket.emit("startGame")}
              disabled={state.players.length < 2}
              className={`btn-accent rounded-xl px-10 py-3.5 font-bold shadow-lg shadow-black/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 ${
                state.players.length >= 2 ? "glow-pulse" : ""
              }`}
            >
              Start game
            </button>
            {state.players.length < 2 && (
              <p className="text-sm text-slate-400">
                Invite a friend or add a bot to play solo.
              </p>
            )}
          </div>
        ) : (
          <p className="animate-pulse text-slate-400">
            Waiting for the host to start…
          </p>
        )}
        <button
          onClick={leave}
          className="flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-red-400"
        >
          <FaRightFromBracket className="h-3.5 w-3.5" /> Leave room
        </button>
        <button
          onClick={() => setSheet("help")}
          className="flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
        >
          <FaCircleQuestion className="h-3.5 w-3.5" /> How to play
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {sheetView}
      </main>
    );
  }

  // ---------- round end / game over ----------
  if (state.phase === "roundEnd" || state.phase === "gameOver") {
    const ranked = [...state.players].sort(
      (a, b) => b.level - a.level || a.score - b.score
    );
    return (
      <main className="table-bg flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-white">
        {state.phase === "gameOver" && <Confetti />}
        <div className="pop-in flex flex-col items-center text-center">
          <Wordmark className="mb-3 text-xl text-slate-400" />
          <h1 className="text-5xl font-black">
            {state.phase === "gameOver" ? (
              <span className="title-shimmer">Game over!</span>
            ) : (
              `Round ${state.round} done`
            )}
          </h1>
          {state.phase === "gameOver" && (
            <p className="mt-3 flex items-center justify-center gap-2.5 text-2xl font-bold text-amber-300">
              <FaTrophy className="h-6 w-6" />
              {state.players
                .filter((p) => state.winnerIds.includes(p.id))
                .map((p) => p.name)
                .join(", ")}{" "}
              wins!
            </p>
          )}
        </div>
        <div className="panel pop-in w-full max-w-md overflow-hidden rounded-3xl" style={{ animationDelay: "100ms" }}>
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-950/40 text-xs tracking-wide text-slate-400 uppercase">
                <th className="p-3">Player</th>
                <th className="p-3">Level</th>
                <th className="p-3">Score</th>
                <th className="p-3">This round</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.id} className="border-t border-slate-700/50">
                  <td className="flex items-center gap-2 p-3 font-bold">
                    <Avatar name={p.name} index={state.players.indexOf(p)} small status={presenceOf(p)} />
                    {p.isBot && (
                    <FaRobot className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-slate-400" />
                  )}
                    {p.name}
                    {p.id === state.you.id && (
                      <span className="text-xs font-normal text-slate-500">
                        you
                      </span>
                    )}
                    {i === 0 && state.phase === "gameOver" && (
                      <FaCrown className="h-4 w-4 text-amber-400" />
                    )}
                  </td>
                  <td className="p-3">{p.level > 10 ? "Done!" : p.level}</td>
                  <td className="p-3">{p.score}</td>
                  <td className="p-3">
                    {p.completedThisRound ? (
                      <span className="flex items-center gap-1 font-bold text-emerald-400">
                        <FaCheck className="h-3 w-3" /> Level up
                      </span>
                    ) : (
                      <span className="text-slate-500">Retry level</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.phase === "roundEnd" && (
          <button
            onClick={leave}
            className="flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-red-400"
          >
            <FaRightFromBracket className="h-3.5 w-3.5" /> Leave game
          </button>
        )}
        {state.phase === "roundEnd" &&
          (isHost || hostAway ? (
            <button
              onClick={() => socket.emit("nextRound")}
              className="btn-accent glow-pulse rounded-xl px-10 py-3.5 font-bold shadow-lg transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Next round
            </button>
          ) : (
            <p className="animate-pulse text-slate-400">
              Waiting for the host…
            </p>
          ))}
        {state.phase === "gameOver" && (
          <div className="flex w-full max-w-md flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {isHost || hostAway ? (
              <button
                onClick={() => socket.emit("rematch")}
                className="btn-accent glow-pulse flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3.5 font-bold shadow-lg transition-all hover:brightness-110 active:scale-[0.98] sm:w-auto"
              >
                <FaRotateRight className="h-4 w-4" /> Play again
              </button>
            ) : (
              <p className="animate-pulse text-slate-400">
                Waiting for the host to start a rematch…
              </p>
            )}
            <button
              onClick={leave}
              className="w-full rounded-xl bg-slate-700/80 px-8 py-3.5 font-bold transition-colors hover:bg-slate-600 sm:w-auto"
            >
              Back to lobby
            </button>
          </div>
        )}
      </main>
    );
  }

  // ---------- in-game ----------
  const currentName = state.players.find(
    (p) => p.id === state.currentPlayerId
  )?.name;

  return (
    <main className="table-bg safe-area flex h-dvh flex-col gap-2 overflow-hidden text-white sm:gap-3">
      {/* top bar: opponents + status + actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="no-scrollbar -mx-2 flex items-center gap-2 overflow-x-auto px-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Wordmark className="mr-1 hidden text-lg lg:flex" />
        {state.players
          .filter((p) => p.id !== state.you.id)
          .map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!isHost}
              onClick={() => {
                setConfirmKick(false);
                setManaging(p.id);
              }}
              title={
                isHost
                  ? `${p.score} points — tap to manage`
                  : `${p.score} points`
              }
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs whitespace-nowrap transition-all duration-300 disabled:cursor-default ${
                p.id === state.currentPlayerId
                  ? "accent-chip glow-pulse border"
                  : "panel"
              } ${isHost ? "hover:brightness-125" : ""}`}
            >
              <Avatar name={p.name} index={state.players.indexOf(p)} small status={presenceOf(p)} />
              <span className="font-bold">{p.name}</span>
              <span className="text-slate-300">
                Lv {Math.min(p.level, 10)} · {p.handCount} cards
                <span className="hidden sm:inline"> · {p.score} pts</span>
              </span>
              {p.laidDown && <FaCheck className="h-3 w-3 text-emerald-300" />}
              {p.pendingSkips > 0 && <FaBan className="h-3 w-3 text-red-400" />}
              {clock?.playerId === p.id && clockSecs !== null && (
                <span
                  className={`font-mono font-bold ${
                    clock.stalled || clockSecs <= 10
                      ? "text-amber-300"
                      : "text-slate-300"
                  }`}
                >
                  {clock.stalled ? "idle" : `${clockSecs}s`}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div
            className={`flex min-w-0 flex-1 items-center justify-center truncate rounded-xl border px-3.5 py-2 text-xs font-bold sm:flex-none ${
              myTurn
                ? "accent-banner glow-pulse"
                : "border-transparent text-slate-400"
            }`}
          >
            {myTurn && (
              <FaWandMagicSparkles className="mr-1.5 inline h-3 w-3" />
            )}
            {myTurn
              ? state.phase === "draw"
                ? "Your turn — draw"
                : "Play, then discard"
              : `${currentName}'s turn…`}
            {myTurn && clockSecs !== null && !clock?.stalled && (
              <span
                className={`ml-2 font-mono ${
                  clockSecs <= 10 ? "text-amber-300" : "opacity-70"
                }`}
              >
                {clockSecs}s
              </span>
            )}
          </div>
          <button
            onClick={copyInvite}
            className="panel hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700/60 sm:flex"
          >
            {copied ? (
              <>
                <FaCheck className="h-3 w-3 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <FaCopy className="h-3 w-3" /> {code}
              </>
            )}
          </button>
          <ThemePicker />
          <button
            onClick={() => setSheet("help")}
            title="How to play"
            aria-label="How to play"
            className="panel flex items-center rounded-xl px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700/60"
          >
            <FaCircleQuestion className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setSheet("settings")}
            title="Room & rules"
            aria-label="Room and rules"
            className="panel flex items-center rounded-xl px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700/60"
          >
            <FaSliders className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={leave}
            title="Leave game (your seat is saved — rejoin with the same link)"
            className="panel flex items-center rounded-xl px-3 py-2 text-xs font-bold text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
          >
            <FaRightFromBracket className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* the table: player melds left, piles center */}
      <div className="panel relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-3xl p-3 sm:flex-row sm:gap-5 sm:overflow-x-auto sm:p-5">
        {/* per-player meld groups */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:gap-3 sm:self-start">
          {state.players.map((p) => {
            const playerMelds = state.melds.filter(
              (m) => m.playerId === p.id
            );
            return (
              <div
                key={p.id}
                className={`rounded-2xl bg-slate-900/40 p-2.5 sm:min-w-72 sm:p-3.5 ${
                  p.id === state.currentPlayerId ? "ring-1 ring-white/15" : ""
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Avatar name={p.name} index={state.players.indexOf(p)} status={presenceOf(p)} />
                  <span className="min-w-0 truncate text-sm font-bold text-slate-200">
                    {p.name}
                    {p.id === state.you.id && " (you)"}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-xs text-slate-400 tabular-nums"
                    title="Penalty points so far — lower is better"
                  >
                    {p.score} pts
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      p.laidDown
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "accent-banner border"
                    }`}
                    title={describeLevel(Math.min(p.level, 10))}
                  >
                    Lv {Math.min(p.level, 10)}
                    {p.laidDown && (
                      <FaCheck className="ml-1 inline h-2.5 w-2.5 align-[-1px]" />
                    )}
                  </span>
                </div>
                {playerMelds.length === 0 ? (
                  // Not laid down yet: show what this level asks for.
                  <div className="flex w-full gap-2 sm:w-72">
                    {LEVELS[Math.min(p.level, 10) - 1].map((req, i) => (
                      <div
                        key={i}
                        className="flex h-14 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/70 px-1 text-center text-xs leading-tight font-bold text-slate-400 sm:h-20 sm:text-sm"
                      >
                        {describeRequirement(req)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {playerMelds.map((meld) => {
                      const fits =
                        canHitNow && activeCard
                          ? hitMeld(meld, activeCard) !== null
                          : false;
                      return (
                        <div
                          key={meld.id}
                          onDragOver={(e) => {
                            if (fits) e.preventDefault();
                          }}
                          onDrop={(e) => dropOnMeld(e, meld)}
                          className={`pop-in rounded-xl bg-slate-900/60 p-1.5 transition-all duration-200 ${
                            fits
                              ? "hit-glow"
                              : canHitNow
                                ? "opacity-50"
                                : ""
                          }`}
                        >
                          <p className="mb-1 text-[10px] text-slate-500 sm:text-xs">
                            {meld.type === "set"
                              ? `${meld.setValue}s`
                              : meld.type === "color"
                                ? `${meld.color}`
                                : `run ${meld.runValues?.[0]}–${meld.runValues?.[meld.runValues.length - 1]}`}
                          </p>
                          <div className="flex gap-1">
                            {meld.type === "run" &&
                              fits &&
                              singleWildSelected &&
                              selectedCard &&
                              hitMeld(meld, selectedCard, "low") && (
                                <button
                                  onClick={() => hit(meld, "low")}
                                  className="flex items-center rounded-lg bg-emerald-600 px-1.5 text-xs font-bold transition-colors hover:bg-emerald-500"
                                  title="Add wild to low end"
                                >
                                  <FaChevronLeft className="h-3 w-3" />
                                </button>
                              )}
                            {meld.cards.map((c) => (
                              <CardView
                                key={c.id}
                                card={c}
                                fit="meld"
                                onClick={
                                  fits &&
                                  !(
                                    meld.type === "run" && singleWildSelected
                                  )
                                    ? () => hit(meld)
                                    : undefined
                                }
                              />
                            ))}
                            {meld.type === "run" &&
                              fits &&
                              singleWildSelected &&
                              selectedCard &&
                              hitMeld(meld, selectedCard, "high") && (
                                <button
                                  onClick={() => hit(meld, "high")}
                                  className="flex items-center rounded-lg bg-emerald-600 px-1.5 text-xs font-bold transition-colors hover:bg-emerald-500"
                                  title="Add wild to high end"
                                >
                                  <FaChevronRight className="h-3 w-3" />
                                </button>
                              )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* piles — centered on the table: big discard, smaller draw beside it */}
        <div className="order-first flex justify-center sm:pointer-events-none sm:absolute sm:inset-0 sm:order-none sm:items-center">
          <div className="pointer-events-auto flex items-end gap-4 sm:gap-5">
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => socket.emit("action", { type: "drawFromDeck" })}
            disabled={!myTurn || state.phase !== "draw"}
            className={
              myTurn && state.phase === "draw"
                ? "glow-pulse cursor-pointer rounded-xl transition-transform hover:-translate-y-1.5 hover:scale-105"
                : "opacity-50"
            }
          >
            <CardBack pile />
          </button>
          <span className="text-xs font-bold text-slate-400">
            Draw · {state.drawCount}
          </span>
        </div>
        <div
          onDragOver={(e) => {
            if (dragIds) e.preventDefault();
          }}
          onDrop={dropOnDiscard}
          className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed p-2 transition-all duration-200 sm:p-3 ${
            dragIds
              ? "scale-105 border-rose-400 bg-rose-500/15 shadow-lg shadow-rose-900/40"
              : myTurn && state.phase === "play"
                ? "border-rose-400/40 bg-rose-500/5"
                : "border-slate-600/40"
          }`}
        >
          {state.discardTop ? (
            <div key={state.discardTop.id} className="pop-in pointer-events-auto">
              <CardView
                card={state.discardTop}
                fit="pile"
                onClick={
                  myTurn && state.phase === "draw"
                    ? () => socket.emit("action", { type: "drawFromDiscard" })
                    : myTurn && state.phase === "play" && selected.length === 1
                      ? discard
                      : undefined
                }
              />
            </div>
          ) : (
            <div className="flex h-28 min-h-28 w-20 items-center justify-center rounded-2xl border border-slate-700/60 text-slate-600 sm:h-51 sm:min-h-51 sm:w-36 sm:rounded-3xl">
              —
            </div>
          )}
          <span
            className={`text-xs font-bold ${
              dragIds ? "text-rose-300" : "text-slate-400"
            }`}
          >
            {dragIds
              ? "Drop to discard!"
              : myTurn && state.phase === "play"
                ? selected.length === 1
                  ? "Tap to discard"
                  : "Discard · pick a card"
                : myTurn && state.phase === "draw"
                  ? "Tap to take"
                  : "Discard"}
          </span>
        </div>
          </div>
        </div>

        {/* latest move */}
        {state.log.length > 0 && (
          <p className="order-first text-center text-[11px] text-slate-500 sm:pointer-events-none sm:absolute sm:bottom-2.5 sm:left-4 sm:order-none sm:text-left">
            {state.log[state.log.length - 1]}
          </p>
        )}
      </div>

      {/* bottom dock: level + staging + hand */}
      {you && (
        <div className="panel flex flex-col gap-2 rounded-3xl p-2.5 sm:gap-3 sm:p-4">
          {showTip && (
            <div className="accent-banner flex items-start gap-2 rounded-xl border px-3 py-2 text-xs">
              <FaWandMagicSparkles className="mt-0.5 h-3 w-3 shrink-0" />
              <p className="flex-1 leading-relaxed">
                <b>Tap</b> cards to select · <b>+ add</b> them to a group ·{" "}
                <b>Lay down</b> · tap a glowing meld to add to it · tap the{" "}
                <b>discard pile</b> to end your turn.{" "}
                <button
                  onClick={() => setSheet("help")}
                  className="font-bold underline"
                >
                  Full rules
                </button>
              </p>
              <button
                onClick={dismissTip}
                aria-label="Dismiss tip"
                className="-m-1 p-1 opacity-70 hover:opacity-100"
              >
                <FaXmark className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div
              className="flex w-full items-center justify-between gap-2.5 rounded-xl bg-slate-900/50 px-3 py-2 sm:w-auto"
              title={`${you.score} points`}
            >
              <span className="text-xs font-bold whitespace-nowrap">
                Level {Math.min(you.level, 10)}
                <span className="accent">
                  {" "}
                  · {describeLevel(Math.min(you.level, 10))}
                </span>
              </span>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-3 rounded-full ${
                      i + 1 < you.level
                        ? "bg-emerald-400"
                        : i + 1 === you.level
                          ? "accent-bg"
                          : "bg-slate-700"
                    }`}
                  />
                ))}
              </div>
            </div>

            {!you.laidDown && (
              <div className="flex w-full gap-2 sm:contents">
              {reqs.map((req, i) => (
                <div
                  key={i}
                  onDragOver={(e) => {
                    if (dragIds) e.preventDefault();
                  }}
                  onDrop={(e) => dropOnGroup(e, i)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-dashed px-2.5 py-1.5 transition-all duration-200 sm:flex-none ${
                    dragIds
                      ? "accent-banner scale-[1.03]"
                      : (staged[i]?.length ?? 0) >= req.size
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : "border-slate-600/50 bg-slate-900/40"
                  }`}
                >
                  <div className="flex flex-col items-start">
                    <span
                      className={`text-[10px] font-bold whitespace-nowrap ${
                        (staged[i]?.length ?? 0) >= req.size
                          ? "text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      {describeRequirement(req)} · {staged[i]?.length ?? 0}/
                      {req.size}+
                    </span>
                    <button
                      onClick={() => stageSelected(i)}
                      disabled={selected.length === 0}
                      title="Add selected cards to this group"
                      className="mt-0.5 flex items-center gap-1 rounded-md bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-300 transition-colors hover:bg-slate-600 disabled:opacity-30"
                    >
                      <FaPlus className="h-2 w-2" /> add
                    </button>
                  </div>
                  <div className="no-scrollbar flex min-h-14 min-w-11 items-center gap-1 overflow-x-auto">
                    {(staged[i] ?? []).map((id) => {
                      const card = hand.find((c) => c.id === id);
                      return card ? (
                        <CardView
                          key={id}
                          card={card}
                          small
                          onClick={() => unstage(i, id)}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
              </div>
            )}
            {!you.laidDown && (
              <button
                onClick={layDown}
                disabled={
                  !myTurn ||
                  state.phase !== "play" ||
                  !reqs.every((r, i) => (staged[i]?.length ?? 0) >= r.size)
                }
                className={`rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-sm font-bold shadow transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 ${
                  myTurn &&
                  state.phase === "play" &&
                  reqs.every((r, i) => (staged[i]?.length ?? 0) >= r.size)
                    ? "glow-pulse"
                    : ""
                }`}
              >
                Lay down
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={discard}
                disabled={
                  !myTurn || state.phase !== "play" || selected.length !== 1
                }
                className="rounded-xl bg-gradient-to-r from-rose-500 to-red-600 px-5 py-2 text-sm font-bold shadow transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                Discard
              </button>
              <button
                onClick={() =>
                  setSortMode((m) =>
                    m === "number"
                      ? "color"
                      : m === "color"
                        ? "custom"
                        : "number"
                  )
                }
                title="Sort hand: by number, by color, or your own order (drag cards onto each other to arrange)"
                className="flex items-center gap-1.5 rounded-xl bg-slate-700/70 px-2.5 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-600"
              >
                {sortMode === "number" ? (
                  "1·2·3"
                ) : sortMode === "color" ? (
                  <FaPalette className="h-3 w-3" />
                ) : (
                  "free"
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-1 pt-2 sm:gap-2 sm:pt-0">
            {displayedHand.map((card, i) => (
              <div
                key={card.id}
                onDragOver={(e) => {
                  if (dragIds && !dragIds.includes(card.id)) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onDrop={(e) => dropOnHandCard(e, card.id)}
              >
                <CardView
                  card={card}
                  fit="hand"
                  selected={selected.includes(card.id)}
                  onClick={() => toggleSelect(card.id)}
                  dealDelay={i * 35}
                  draggable
                  onDragStart={(e) => startDrag(e, card)}
                  onDragEnd={() => setDragIds(null)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* our own connection dropped */}
      {!online && (
        <div className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-sm items-center justify-center gap-2.5 rounded-2xl bg-slate-800/95 px-4 py-3 text-sm font-bold shadow-2xl ring-1 ring-white/10">
          <span className="h-2.5 w-2.5 animate-ping rounded-full bg-amber-400" />
          Connection lost — reconnecting…
        </div>
      )}

      {/* idle warning for the player who is holding things up */}
      {youAreIdle && (
        <div className="toast-up fixed inset-x-3 top-3 z-50 mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-amber-400/60 bg-amber-500/95 px-5 py-4 text-center font-bold text-slate-950 shadow-2xl sm:flex-row sm:text-left">
          <FaTriangleExclamation className="h-6 w-6 shrink-0" />
          <p className="flex-1 text-sm">
            Are you still there? You haven&apos;t played for a while — the
            other players can now skip your turn.
          </p>
          <button
            onClick={() => socket.emit("keepWaiting")}
            className="shrink-0 rounded-xl bg-slate-950 px-4 py-2 text-sm text-amber-300 transition-transform active:scale-95"
          >
            I&apos;m here!
          </button>
        </div>
      )}

      {/* someone else is idle: wait or skip? */}
      {clock?.stalled &&
        clock.playerId !== state.you.id &&
        !skipPickFor &&
        !managing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="panel pop-in flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6 text-center">
              <FaHourglassHalf className="mx-auto h-7 w-7 text-amber-400" />
              <h2 className="text-lg font-black">
                {state.players.find((p) => p.id === clock.playerId)?.name}{" "}
                {state.players.find((p) => p.id === clock.playerId)?.connected
                  ? "hasn't played in a while"
                  : "is offline"}
              </h2>
              <p className="text-sm text-slate-400">
                Keep waiting, or skip their turn and play on?
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => socket.emit("keepWaiting")}
                  className="flex-1 rounded-xl bg-slate-700/80 py-3 font-bold transition-all hover:bg-slate-600 active:scale-[0.98]"
                >
                  Keep waiting
                </button>
                <button
                  onClick={() => socket.emit("skipTurn")}
                  className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  <FaForwardStep className="h-3.5 w-3.5" /> Skip turn
                </button>
              </div>
            </div>
          </div>
        )}

      {/* host: manage a player */}
      {managing &&
        isHost &&
        (() => {
          const target = state.players.find((p) => p.id === managing);
          if (!target) return null;
          const canSkip =
            state.currentPlayerId === target.id && !target.isBot;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
              onClick={() => setManaging(null)}
            >
              <div
                className="panel pop-in flex w-full max-w-xs flex-col gap-3 rounded-3xl p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <Avatar
                    name={target.name}
                    index={state.players.indexOf(target)}
                    small
                  />
                  {target.name}
                </h2>
                <button
                  disabled={!canSkip}
                  onClick={() => {
                    socket.emit("skipTurn");
                    setManaging(null);
                  }}
                  className="flex items-center gap-3 rounded-xl bg-slate-700/70 px-4 py-3 font-bold transition-all hover:bg-slate-600 active:scale-[0.98] disabled:opacity-40"
                >
                  <FaForwardStep className="h-4 w-4" /> Skip their turn
                </button>
                {!canSkip && (
                  <p className="-mt-1 text-xs text-slate-500">
                    {target.isBot
                      ? "Bots play instantly."
                      : "You can skip them once it's their turn."}
                  </p>
                )}
                <button
                  disabled={state.players.length <= 2}
                  onClick={() => {
                    if (!confirmKick) return setConfirmKick(true);
                    socket.emit("kickPlayer", { playerId: target.id });
                    setManaging(null);
                  }}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
                    confirmKick
                      ? "bg-red-600 hover:bg-red-500"
                      : "bg-slate-700/70 text-red-300 hover:bg-red-500/30"
                  }`}
                >
                  <FaUserSlash className="h-4 w-4" />
                  {confirmKick ? "Tap again to kick" : "Kick from game"}
                </button>
                {state.players.length <= 2 && (
                  <p className="-mt-1 text-xs text-slate-500">
                    A game needs at least 2 players.
                  </p>
                )}
                <button
                  onClick={() => setManaging(null)}
                  className="text-sm text-slate-400 underline hover:text-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}

      {sheetView}

      {/* skip target modal */}
      {skipPickFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="panel pop-in flex min-w-64 flex-col gap-3 rounded-3xl p-7">
            <h2 className="flex items-center gap-2 text-lg font-black">
              <FaBan className="h-4 w-4 text-red-400" /> Skip who?
            </h2>
            {state.players
              .filter((p) => p.id !== state.you.id)
              .map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => discardSkip(p.id)}
                  className="flex items-center gap-3 rounded-xl bg-slate-700/70 px-4 py-2.5 font-bold transition-all hover:bg-indigo-500 active:scale-[0.98]"
                >
                  <Avatar name={p.name} index={state.players.indexOf(p)} small />
                  {p.isBot && (
                    <FaRobot className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-slate-400" />
                  )}
                  {p.name}
                </button>
              ))}
            <button
              onClick={() => setSkipPickFor(null)}
              className="text-sm text-slate-400 underline hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* error toast */}
      {error && (
        <div className="toast-up fixed bottom-6 left-1/2 z-50 rounded-2xl bg-red-600 px-6 py-3 font-bold shadow-2xl shadow-red-900/50">
          {error}
        </div>
      )}

    </main>
  );
}
