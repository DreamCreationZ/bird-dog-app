"use client";

import React from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f3f0e7" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
          <section style={{ width: "min(760px, 100%)", background: "#fffdf8", border: "1px solid #d6cfbe", borderRadius: 12, padding: 16 }}>
            <h1 style={{ marginTop: 0 }}>Bird Dog Crash Guard</h1>
            <p>A global runtime error occurred.</p>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f6f2e8", padding: 12, borderRadius: 8 }}>
              {error?.message || "Unknown error"}
            </pre>
            {error?.digest ? <p>Digest: {error.digest}</p> : null}
            <button type="button" onClick={reset}>Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
