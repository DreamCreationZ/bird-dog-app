"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error?.message || "Unknown client error";
  const isChunkLoadError = /loading chunk|chunkloaderror|failed to fetch dynamically imported module|_next\/static\/chunks/i.test(
    message.toLowerCase()
  );

  useEffect(() => {
    // Keep console signal for local debugging.
    // eslint-disable-next-line no-console
    console.error("Bird Dog route error:", error);

    if (typeof window === "undefined") return;
    if (!isChunkLoadError) return;

    const reloadKey = "bird_dog_chunk_reload_once";
    if (window.sessionStorage.getItem(reloadKey) === "1") return;
    window.sessionStorage.setItem(reloadKey, "1");

    const url = new URL(window.location.href);
    url.searchParams.set("_chunkRetry", String(Date.now()));
    window.location.replace(url.toString());
  }, [error, isChunkLoadError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("_chunkRetry")) return;
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("_chunkRetry");
    window.history.replaceState({}, "", cleaned.toString());
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f3f0e7" }}>
      <section style={{ width: "min(760px, 100%)", background: "#fffdf8", border: "1px solid #d6cfbe", borderRadius: 12, padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>Bird Dog Error</h1>
        <p>
          {isChunkLoadError
            ? "App version updated. Refreshing to latest build..."
            : "The app hit a runtime error. Please click retry."}
        </p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f6f2e8", padding: 12, borderRadius: 8 }}>
          {message}
        </pre>
        {error?.digest ? <p>Digest: {error.digest}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={reset}>Retry</button>
          <button
            type="button"
            onClick={() => {
              if (typeof window === "undefined") return;
              const url = new URL(window.location.href);
              url.searchParams.set("_hardReload", String(Date.now()));
              window.location.replace(url.toString());
            }}
          >
            Reload Latest App
          </button>
        </div>
      </section>
    </main>
  );
}
