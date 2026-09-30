"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaDice, FaDownload } from "react-icons/fa6";
import { getSocket } from "@/lib/clientSocket";
import { LogoMark } from "@/components/Brand";
import { CardView } from "@/components/CardView";
import { ThemePicker } from "@/components/ThemePicker";
import { randomName } from "@/lib/names";
import type { Card } from "@/lib/game/types";

const HERO_CARDS: { card: Card; tilt: number; delay: number }[] = [
  { card: { id: "h1", kind: "number", color: "red", value: 1 }, tilt: -16, delay: 0 },
  { card: { id: "h2", kind: "number", color: "blue", value: 4 }, tilt: -8, delay: 300 },
  { card: { id: "h3", kind: "wild" }, tilt: 0, delay: 600 },
  { card: { id: "h4", kind: "number", color: "green", value: 7 }, tilt: 8, delay: 900 },
  { card: { id: "h5", kind: "number", color: "yellow", value: 10 }, tilt: 16, delay: 1200 },
];

export default function Lobby() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<
    (Event & { prompt: () => Promise<void> }) | null
  >(null);

  // Offer "Install app" when the browser says the PWA is installable.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as Event & { prompt: () => Promise<void> });
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    setName(localStorage.getItem("lvl10:name") ?? randomName());
    if (new URLSearchParams(location.search).has("kicked")) {
      setError("The host removed you from that game.");
    }
  }, []);

  function remember(roomId: string, token: string) {
    localStorage.setItem("lvl10:name", name.trim());
    localStorage.setItem(`lvl10:token:${roomId}`, token);
    router.push(`/game/${roomId}`);
  }

  function createRoom() {
    if (!name.trim()) return setError("Enter your name first.");
    setBusy(true);
    getSocket().emit(
      "createRoom",
      { name: name.trim() },
      (res: { roomId?: string; token?: string; error?: string }) => {
        setBusy(false);
        if (res.error || !res.roomId || !res.token)
          return setError(res.error ?? "Could not create room.");
        remember(res.roomId, res.token);
      }
    );
  }

  function joinRoom() {
    if (!name.trim()) return setError("Enter your name first.");
    if (!code.trim()) return setError("Enter a room code.");
    setBusy(true);
    getSocket().emit(
      "joinRoom",
      { roomId: code.trim().toUpperCase(), name: name.trim() },
      (res: { roomId?: string; token?: string; error?: string }) => {
        setBusy(false);
        if (res.error || !res.roomId || !res.token)
          return setError(res.error ?? "Could not join room.");
        remember(res.roomId, res.token);
      }
    );
  }

  return (
    <main className="table-bg safe-area relative flex min-h-dvh flex-col items-center justify-center gap-8 px-4 text-white sm:gap-10">
      <ThemePicker className="absolute top-4 right-4" />
      <div className="pop-in flex flex-col items-center gap-6 text-center">
        <div className="flex items-end justify-center">
          {HERO_CARDS.map(({ card, tilt, delay }, i) => (
            <div
              key={card.id}
              className="float-y"
              style={
                {
                  "--tilt": `${tilt}deg`,
                  transform: `rotate(${tilt}deg)`,
                  animationDelay: `${delay}ms`,
                  marginLeft: i === 0 ? 0 : "-0.9rem",
                  zIndex: i === 2 ? 10 : 5 - Math.abs(i - 2),
                } as React.CSSProperties
              }
            >
              <CardView card={card} />
            </div>
          ))}
        </div>
        <div>
          <h1 className="flex items-center justify-center gap-3 text-5xl font-black tracking-tight sm:gap-4 sm:text-7xl">
            <LogoMark className="accent h-10 w-10 sm:h-14 sm:w-14" />
            <span>
              Level <span className="title-shimmer">10</span>
            </span>
          </h1>
          <p className="mt-3 max-w-md text-slate-400">
            The multiplayer card race — complete sets, runs and colors through
            ten levels before your friends do.
          </p>
        </div>
      </div>

      <div className="panel pop-in flex w-full max-w-sm flex-col gap-4 rounded-3xl p-7" style={{ animationDelay: "120ms" }}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-300">
          Your name
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="min-w-0 flex-1 rounded-xl border border-slate-600/60 bg-slate-950/60 px-4 py-2.5 text-base text-white outline-none transition-colors focus:border-indigo-400"
              placeholder="e.g. Sam"
            />
            <button
              onClick={() => setName(randomName())}
              title="Random name"
              className="flex items-center rounded-xl bg-slate-700/70 px-3.5 transition-colors hover:bg-slate-600"
            >
              <FaDice className="h-4 w-4" />
            </button>
          </div>
        </label>

        <button
          onClick={createRoom}
          disabled={busy}
          className="btn-accent rounded-xl py-3.5 font-bold shadow-lg shadow-black/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          Create game
        </button>
        <p className="-mt-2 text-center text-xs text-slate-500">
          A room code is generated for you — invite friends or add bots.
        </p>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="h-px flex-1 bg-slate-700/60" /> or join a friend{" "}
          <div className="h-px flex-1 bg-slate-700/60" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && joinRoom()}
            maxLength={4}
            className="w-28 rounded-xl border border-slate-600/60 bg-slate-950/60 px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-white outline-none transition-colors focus:border-emerald-400"
            placeholder="CODE"
          />
          <button
            onClick={joinRoom}
            disabled={busy}
            className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 font-bold shadow-lg shadow-emerald-900/40 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            Join game
          </button>
        </div>

        {error && <p className="pop-in text-sm text-red-400">{error}</p>}
      </div>

      {installPrompt && (
        <button
          onClick={() => {
            installPrompt.prompt().finally(() => setInstallPrompt(null));
          }}
          className="panel flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-700/60"
        >
          <FaDownload className="accent h-3.5 w-3.5" /> Install app
        </button>
      )}

      <p className="text-xs text-slate-600">
        2–6 players · play solo with bots · free forever
      </p>
    </main>
  );
}
