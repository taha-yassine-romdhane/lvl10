"use client";

import { useEffect, useRef, useState } from "react";
import { FaPalette, FaCheck } from "react-icons/fa6";

const THEMES = [
  { id: "midnight", label: "Midnight", dot: "#818cf8" },
  { id: "casino", label: "Casino Felt", dot: "#fbbf24" },
  { id: "crimson", label: "Crimson", dot: "#fb7185" },
  { id: "ocean", label: "Ocean", dot: "#22d3ee" },
];

export function applyTheme(id: string) {
  if (id === "midnight") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = id;
  }
  localStorage.setItem("lvl10:theme", id);
}

export function ThemePicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("midnight");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("lvl10:theme") ?? "midnight";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    // `relative` would override a caller's `absolute` positioning.
    <div
      ref={ref}
      className={`${className?.includes("absolute") ? "" : "relative"} ${className ?? ""}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        title="Change theme"
        className="panel flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700/60"
      >
        <FaPalette className="accent h-3.5 w-3.5" />
        <span className="hidden sm:inline">Theme</span>
      </button>
      {open && (
        <div className="panel pop-in absolute right-0 z-50 mt-2 w-44 rounded-2xl p-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTheme(t.id);
                applyTheme(t.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors hover:bg-slate-700/60"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: t.dot }}
              />
              {t.label}
              {theme === t.id && (
                <FaCheck className="accent ml-auto h-3 w-3" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
