import { useState } from "react";
import "./App.css";

export default function App() {
  const [targetUrl, setTargetUrl] = useState("https://example.com");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadHistory(forUrl) {
    try {
      const res = await fetch(
        `/api/history?url=${encodeURIComponent(forUrl)}&limit=25`
      );
      const data = await res.json();

      if (res.ok) {
        setHistory(data.history || []);
      }
    } catch {
      // ignore history errors for now
    }
  }

  async function runProbe() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setResult(data);
      await loadHistory(data.url);
    } catch (err) {
      setError(err?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Latency Monitor</h1>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <button onClick={runProbe} disabled={loading}>
          {loading ? "Probing..." : "Run Probe"}
        </button>
      </div>

      <p style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
        Try: https://example.com, https://cloudflare.com, or your own site.
      </p>

      {error && (
        <p style={{ marginTop: 12 }}>
          <strong>Error:</strong>{" "}
          {error === "invalid_url"
            ? "Invalid URL (must be http/https, not localhost or IP-literals)."
            : error === "timeout"
            ? "Timed out."
            : error === "fetch_failed"
            ? "Fetch failed (network/DNS/blocked)."
            : error === "response_too_large"
            ? "Response too large."
            : error}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <strong>Status:</strong> {result.status}
            </div>
            <div>
              <strong>TTFB-ish:</strong> {result.ttfb_ms} ms
            </div>
            <div>
              <strong>Total:</strong> {result.total_ms} ms
            </div>
          </div>

          <pre style={{ marginTop: 12, padding: 12, border: "1px solid #ddd" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>Recent History</h3>
          <ul>
            {history
              .slice()
              .reverse()
              .map((h, idx) => (
                <li key={idx}>
                  {new Date(h.ts).toLocaleTimeString()} — status {h.status}, ttfb{" "}
                  {h.ttfb_ms}ms, total {h.total_ms}ms
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}