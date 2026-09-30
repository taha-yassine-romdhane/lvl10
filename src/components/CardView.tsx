"use client";

import { FaBan } from "react-icons/fa6";
import { LogoMark } from "./Brand";
import type { Card } from "@/lib/game/types";

const SUIT: Record<
  string,
  { text: string; edge: string; faint: string }
> = {
  red: {
    text: "text-rose-600",
    edge: "ring-rose-500/30",
    faint: "text-rose-600/20",
  },
  blue: {
    text: "text-sky-600",
    edge: "ring-sky-500/30",
    faint: "text-sky-600/20",
  },
  green: {
    text: "text-emerald-600",
    edge: "ring-emerald-500/30",
    faint: "text-emerald-600/20",
  },
  yellow: {
    text: "text-amber-500",
    edge: "ring-amber-400/40",
    faint: "text-amber-500/25",
  },
};

/**
 * Responsive sizes: compact on phones, full size from the `sm` breakpoint.
 * `hand` — the player's hand; `pile` — the discard pile; `meld` — cards on
 * the table.
 */
const FIT = {
  hand: {
    size: "w-[3.4rem] h-[4.9rem] min-h-[4.9rem] rounded-xl sm:w-24 sm:h-34 sm:min-h-34 sm:rounded-2xl",
    center: "text-3xl sm:text-6xl",
    corner: "text-[10px] sm:text-sm",
    mark: "h-3 w-3 sm:h-6 sm:w-6",
  },
  pile: {
    size: "w-20 h-28 min-h-28 rounded-2xl sm:w-36 sm:h-51 sm:min-h-51 sm:rounded-3xl",
    center: "text-5xl sm:text-8xl",
    corner: "text-xs sm:text-lg",
    mark: "h-5 w-5 sm:h-9 sm:w-9",
  },
  meld: {
    size: "w-10 h-14 min-h-14 rounded-lg sm:w-14 sm:h-20 sm:min-h-20 sm:rounded-xl",
    center: "text-xl sm:text-3xl",
    corner: "text-[8px] sm:text-[10px]",
    mark: "h-2.5 w-2.5 sm:h-3.5 sm:w-3.5",
  },
} as const;

export function CardView({
  card,
  selected,
  onClick,
  small,
  large,
  xl,
  xxl,
  fit,
  dealDelay,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  large?: boolean;
  xl?: boolean;
  xxl?: boolean;
  fit?: keyof typeof FIT;
  dealDelay?: number;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const size = fit
    ? FIT[fit].size
    : xxl
    ? "w-36 h-51 min-h-51 rounded-3xl"
    : xl
      ? "w-24 h-34 min-h-34 rounded-2xl"
      : large
        ? "w-20 h-28 min-h-28 rounded-2xl"
        : small
          ? "w-10 h-14 min-h-14 rounded-lg"
          : "w-14 h-20 min-h-20 rounded-xl";
  const centerText = fit
    ? FIT[fit].center
    : xxl
    ? "text-8xl"
    : xl
      ? "text-6xl"
      : large
        ? "text-5xl"
        : small
          ? "text-xl"
          : "text-3xl";
  const cornerText = fit
    ? FIT[fit].corner
    : xxl
    ? "text-lg"
    : xl
      ? "text-sm"
      : large
        ? "text-xs"
        : small
          ? "text-[8px]"
          : "text-[10px]";
  const markSize = fit
    ? FIT[fit].mark
    : xxl
    ? "h-9 w-9"
    : xl
      ? "h-6 w-6"
      : large
        ? "h-5 w-5"
        : small
          ? "h-2.5 w-2.5"
          : "h-3.5 w-3.5";

  // Disabled cards must not intercept drag events aimed at the drop zone
  // behind them (discard zone, meld boxes).
  const base = `${size} relative flex flex-col items-center justify-center border shadow-lg shadow-black/40 transition-all duration-150 select-none ${
    dealDelay !== undefined ? "deal-in" : ""
  } ${
    onClick
      ? `${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} hover:-translate-y-1.5 hover:shadow-xl`
      : "pointer-events-none"
  } ${
    selected
      ? "-translate-y-3 ring-2 ring-indigo-400 shadow-2xl shadow-indigo-500/40"
      : ""
  }`;
  const delayStyle =
    dealDelay !== undefined
      ? { animationDelay: `${dealDelay}ms` }
      : undefined;
  const dragProps = { draggable, onDragStart, onDragEnd };

  if (card.kind === "number") {
    const suit = SUIT[card.color];
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        style={delayStyle}
        {...dragProps}
        className={`${base} border-black/10 bg-[#faf8f2]`}
      >
        <span
          className={`pointer-events-none absolute inset-1 ${
            small ? "rounded-md" : "rounded-lg"
          } ring-1 ${suit.edge}`}
        />
        <span
          className={`absolute top-1 left-1.5 ${cornerText} ${suit.text} font-black`}
        >
          {card.value}
        </span>
        <span
          className={`absolute right-1.5 bottom-1 ${cornerText} ${suit.text} rotate-180 font-black`}
        >
          {card.value}
        </span>
        <span className={`${centerText} ${suit.text} font-black`}>
          {card.value}
        </span>
        <LogoMark className={`${markSize} ${suit.faint} mt-0.5`} />
      </button>
    );
  }

  if (card.kind === "wild") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        style={delayStyle}
        {...dragProps}
        className={`${base} card-gloss border-violet-950/70 bg-gradient-to-br from-violet-500 via-purple-700 to-indigo-950 text-white`}
      >
        <span
          className={`pointer-events-none absolute inset-1 ${
            small ? "rounded-md" : "rounded-lg"
          } ring-1 ring-white/25`}
        />
        <span className={`absolute top-1 left-1.5 ${cornerText} font-black`}>
          W
        </span>
        <span
          className={`absolute right-1.5 bottom-1 ${cornerText} rotate-180 font-black`}
        >
          W
        </span>
        <LogoMark className={small ? "h-4 w-4" : "h-6 w-6"} />
        {!small && (
          <span
            className={`mt-1 text-[8px] font-black tracking-[0.2em] ${
              fit && fit !== "pile" ? "hidden sm:inline" : ""
            }`}
          >
            WILD
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={delayStyle}
      {...dragProps}
      className={`${base} card-gloss border-slate-950/70 bg-gradient-to-br from-slate-600 to-slate-900 text-white`}
    >
      <span
        className={`pointer-events-none absolute inset-1 ${
          small ? "rounded-md" : "rounded-lg"
        } ring-1 ring-white/20`}
      />
      <span className={`absolute top-1 left-1.5 ${cornerText} font-black`}>
        S
      </span>
      <span
        className={`absolute right-1.5 bottom-1 ${cornerText} rotate-180 font-black`}
      >
        S
      </span>
      <FaBan className={small ? "h-4 w-4" : "h-6 w-6"} />
      {!small && (
        <span
          className={`mt-0.5 text-[8px] font-black tracking-[0.2em] ${
            fit && fit !== "pile" ? "hidden sm:inline" : ""
          }`}
        >
          SKIP
        </span>
      )}
    </button>
  );
}

export function CardBack({
  small,
  large,
  xl,
  pile,
}: {
  small?: boolean;
  large?: boolean;
  xl?: boolean;
  /** draw pile: compact on phones, `xl` from the sm breakpoint */
  pile?: boolean;
}) {
  const size = pile
    ? "w-16 h-24 min-h-24 rounded-2xl sm:w-28 sm:h-40 sm:min-h-40 sm:rounded-3xl"
    : xl
    ? "w-28 h-40 min-h-40 rounded-3xl"
    : large
      ? "w-20 h-28 min-h-28 rounded-2xl"
      : small
        ? "w-10 h-14 min-h-14 rounded-lg"
        : "w-14 h-20 min-h-20 rounded-xl";
  return (
    <div
      className={`${size} card-back-pattern relative flex flex-col items-center justify-center border border-indigo-950/80 shadow-lg shadow-black/40`}
    >
      <div
        className={`pointer-events-none absolute inset-1 ${
          small ? "rounded-md" : "rounded-lg"
        } ring-1 ring-indigo-300/25`}
      />
      <LogoMark
        className={`${pile ? "h-8 w-8 sm:h-12 sm:w-12" : xl ? "h-12 w-12" : large ? "h-9 w-9" : small ? "h-4 w-4" : "h-6 w-6"} text-indigo-300/90`}
      />
      <span
        className={`${pile ? "text-sm sm:text-xl" : xl ? "text-xl" : large ? "text-base" : small ? "text-[9px]" : "text-xs"} mt-0.5 font-black tracking-widest text-indigo-200/90`}
      >
        10
      </span>
    </div>
  );
}
