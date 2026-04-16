"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep console signal for local debugging.
    // eslint-disable-next-line no-console
    console.error("Bird Dog route error:", error);
  }, [error]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f3f0e7" }}>
      <section style={{ width: "min(760px, 100%)", background: "#fffdf8", border: "1px solid #d6cfbe", borderRadius: 12, padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>Bird Dog Error</h1>
        <p>The app hit a runtime error. Please click retry.</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f6f2e8", padding: 12, borderRadius: 8 }}>
          {error?.message || "Unknown client error"}
        </pre>
        {error?.digest ? <p>Digest: {error.digest}</p> : null}
        <button type="button" onClick={reset}>Retry</button>
      </section>
    </main>
  );
}
