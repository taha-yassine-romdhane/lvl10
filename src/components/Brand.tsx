"use client";

/** The Level 10 logomark: two rising chevrons — "leveling up". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5l8-6.5 8 6.5" opacity={0.45} />
      <path d="M4 11l8-6.5 8 6.5" />
    </svg>
  );
}

/** Compact horizontal wordmark used in headers. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 font-black tracking-tight select-none ${className ?? ""}`}
    >
      <LogoMark className="h-5 w-5 accent" />
      <span>
        LVL<span className="accent">10</span>
      </span>
    </span>
  );
}
