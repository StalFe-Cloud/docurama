"use client";

/**
 * Last-resort global error boundary (root layout failures). Renders without
 * the app shell — its own <html>/<body> — and always offers a full reload.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#ffffff", color: "#1a1a1a" }}>
        <div style={{ maxWidth: "640px", margin: "0 auto", padding: "80px 24px" }} role="alert">
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", color: "#b91c1c", textTransform: "uppercase", margin: 0 }}>
            Platform error
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 600, marginTop: 12, marginBottom: 0 }}>
            Docurama could not render this page
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "#57534e", marginTop: 16 }}>
            The failure was logged with our engineering team. Reload to try again; if the
            problem persists, write to support@docurama.eu
            {error.digest ? ` and mention reference ${error.digest}.` : "."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24, padding: "10px 18px", borderRadius: 8, border: "1px solid #d6d3d1",
              background: "#0f7a5a", color: "#ffffff", fontSize: 14, fontWeight: 500, cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
