import { useState } from "react";
import "./App.css";

export default function App() {
  const [apiResult, setApiResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function testApi() {
    setLoading(true);
    setError("");
    setApiResult(null);

    try {
      const res = await fetch("/api/ok");

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setApiResult(data);
    } catch (err) {
      setError(err?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Latency Monitor</h1>
      <p>Day 2: React UI calling Worker API</p>

      <button onClick={testApi} disabled={loading}>
        {loading ? "Calling /api/ok..." : "Test /api/ok"}
      </button>

      {error && (
        <p style={{ marginTop: 12 }}>
          <strong>Error:</strong> {error}
        </p>
      )}

      {apiResult && (
        <pre style={{ marginTop: 12, padding: 12, border: "1px solid #ddd" }}>
          {JSON.stringify(apiResult, null, 2)}
        </pre>
      )}
    </div>
  );
}