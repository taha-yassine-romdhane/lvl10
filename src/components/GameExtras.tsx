"use client";

import { FaXmark } from "react-icons/fa6";
import { LEVELS, describeLevel } from "@/lib/game/levels";
import {
  TURN_SECONDS_OPTIONS,
  type BotLevel,
  type RoomSettings,
} from "@/lib/game/types";

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-xl bg-slate-950/50 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors disabled:cursor-default ${
            o.value === value
              ? "btn-accent text-white shadow"
              : "text-slate-400 enabled:hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Room rules. Everyone can see them; only the host can change them. */
export function SettingsPanel({
  settings,
  editable,
  onChange,
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange: (patch: Partial<RoomSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-slate-400">Turn timer</span>
        <Segmented
          value={settings.turnSeconds}
          disabled={!editable}
          onChange={(turnSeconds) => onChange({ turnSeconds })}
          options={TURN_SECONDS_OPTIONS.map((s) => ({
            value: s as number,
            label: s === 0 ? "Off" : `${s}s`,
          }))}
        />
        <span className="text-[11px] text-slate-500">
          After this long, others can wait or skip an idle player.
        </span>
      </div>
      <label
        className={`flex items-center justify-between gap-3 ${
          editable ? "cursor-pointer" : ""
        }`}
      >
        <span className="flex flex-col">
          <span className="text-xs font-bold text-slate-400">
            Auto-skip offline players
          </span>
          <span className="text-[11px] text-slate-500">
            Don&apos;t ask — skip someone who lost connection when their time
            runs out.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.autoSkipOffline}
          disabled={!editable}
          onClick={() =>
            onChange({ autoSkipOffline: !settings.autoSkipOffline })
          }
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-default ${
            settings.autoSkipOffline ? "btn-accent" : "bg-slate-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              settings.autoSkipOffline ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-slate-400">Bot skill</span>
        <Segmented<BotLevel>
          value={settings.botLevel}
          disabled={!editable}
          onChange={(botLevel) => onChange({ botLevel })}
          options={[
            { value: "easy", label: "Easy" },
            { value: "normal", label: "Normal" },
            { value: "hard", label: "Hard" },
          ]}
        />
      </div>
      {!editable && (
        <p className="text-[11px] text-slate-500">
          Only the host can change these.
        </p>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="panel pop-in safe-area flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-black">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-white"
          >
            <FaXmark className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Rules + the ten levels, reachable from the lobby and during a game. */
export function HowToPlay() {
  return (
    <div className="flex flex-col gap-4 text-sm text-slate-300">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        <li>
          On your turn, <b>draw</b> one card — from the deck or the top of the
          discard pile.
        </li>
        <li>
          If you can, <b>lay down</b> your level: tap cards, then{" "}
          <b>+ add</b> them to each group and press <b>Lay down</b>.
        </li>
        <li>
          Once you&apos;ve laid down, <b>add cards</b> to any meld on the table
          (tap a card, then a glowing meld).
        </li>
        <li>
          End your turn by <b>discarding</b> one card — tap it, then tap the
          discard pile.
        </li>
      </ol>
      <ul className="flex flex-col gap-1 rounded-xl bg-slate-950/40 p-3 text-xs text-slate-400">
        <li>
          <b className="text-slate-200">Set</b> — same number ·{" "}
          <b className="text-slate-200">Run</b> — numbers in a row ·{" "}
          <b className="text-slate-200">Color</b> — all one color
        </li>
        <li>
          <b className="text-slate-200">Wild</b> fits anywhere ·{" "}
          <b className="text-slate-200">Skip</b> makes a player miss a turn
        </li>
        <li>
          When someone empties their hand the round ends: everyone who laid
          down moves up a level; cards left in hand cost points (1–9: 5, 10–12:
          10, wild/skip: 25).
        </li>
        <li>
          First to finish level 10 wins — ties go to the lowest score.
        </li>
      </ul>
      <div>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
          The 10 levels
        </h3>
        <ol className="grid grid-cols-1 gap-1 text-xs">
          {LEVELS.map((_, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-lg bg-slate-900/50 px-3 py-1.5"
            >
              <span className="accent w-5 font-black">{i + 1}</span>
              {describeLevel(i + 1)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
