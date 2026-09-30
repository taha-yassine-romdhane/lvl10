"use client";

import { useEffect } from "react";

/** Registers /sw.js in production so the app is installable and has an offline page. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.warn("service worker registration failed", err));
  }, []);
  return null;
}
