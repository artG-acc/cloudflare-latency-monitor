import { useState } from "react";
import "./App.css";

export default function App() {
  const [targetUrl, setTargetUrl] = useState("https://example.com");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loadingProbe, setLoadingProbe] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function fetchHistory(forUrl) {
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/history?url=${encodeURIComponent(forUrl)}&limit=25`
      );
      const data = await res.json();
      if (res.ok) setHistory(data.history || []);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function fetchStats(forUrl) {
    try {
      const res = await fetch(
        `/api/stats?url=${encodeURIComponent(forUrl)}&limit=200`
      );
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch {
      // ignore for now
    }
  }

  async function refresh(forUrl) {
    await Promise.all([fetchHistory(forUrl), fetchStats(forUrl)]);
  }

  async function runProbe() {
    setLoadingProbe(true);
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

      // After probe, refresh stats + history
      await refresh(data.url);
    } catch (err) {
      setError(err?.message || "Request failed");
      // still refresh history/stats for the URL in case it exists
      await refresh(targetUrl);
    } finally {
      setLoadingProbe(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Latency Monitor</h1>
      <p>Day 7–8: History table + Metrics (p50/p95/error rate)</p>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <button onClick={runProbe} disabled={loadingProbe}>
          {loadingProbe ? "Probing..." : "Run Probe"}
        </button>
        <button onClick={() => refresh(targetUrl)} disabled={loadingHistory}>
          {loadingHistory ? "Refreshing..." : "Refresh"}
        </button>
      </div>

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

      {/* Day 8 tiles */}
      {stats?.ok && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ border: "1px solid #ddd", padding: 12, minWidth: 160 }}>
            <div><strong>Current</strong></div>
            <div>{stats.current_total_ms ?? "—"} ms</div>
          </div>
          <div style={{ border: "1px solid #ddd", padding: 12, minWidth: 160 }}>
            <div><strong>p50</strong></div>
            <div>{stats.p50_total_ms ?? "—"} ms</div>
          </div>
          <div style={{ border: "1px solid #ddd", padding: 12, minWidth: 160 }}>
            <div><strong>p95</strong></div>
            <div>{stats.p95_total_ms ?? "—"} ms</div>
          </div>
          <div style={{ border: "1px solid #ddd", padding: 12, minWidth: 160 }}>
            <div><strong>Error rate</strong></div>
            <div>{stats.error_rate_pct ?? 0}%</div>
          </div>
        </div>
      )}

      {/* Last probe result */}
      {result && (
        <pre style={{ marginTop: 12, padding: 12, border: "1px solid #ddd" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      {/* Day 7 history table */}
      {history.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>Recent History (last 25)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Time</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>OK</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Status/Error</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>TTFB</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {history
                .slice()
                .reverse()
                .map((h, idx) => (
                  <tr key={idx}>
                    <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                      {new Date(h.ts).toLocaleTimeString()}
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                      {h.ok ? "Good" : "Bad"}
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                      {h.ok ? h.status : h.error}
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                      {h.ok ? `${h.ttfb_ms} ms` : "—"}
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                      {h.ok ? `${h.total_ms} ms` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}