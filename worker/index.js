import { ProbeStoreDO } from "./ProbeStoreDO.js";
export { ProbeStoreDO };

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;

// ---------- URL validation (SSRF-lite MVP) ----------
function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((x) => Number(x));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

function looksLikeIpLiteral(hostname) {
  return /^[0-9.]+$/.test(hostname);
}

function isValidPublicHttpUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }

  const host = u.hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { ok: false, reason: "invalid_url" };
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "invalid_url" };
  }
  if (host === "169.254.169.254") {
    return { ok: false, reason: "invalid_url" };
  }

  // MVP safe: block IP-literals (avoid SSRF risks)
  if (looksLikeIpLiteral(host)) {
    if (isPrivateIpv4(host)) return { ok: false, reason: "invalid_url" };
    return { ok: false, reason: "invalid_url" };
  }

  return { ok: true, url: u.toString() };
}

// ---------- Read body with max size limit ----------
async function readWithLimit(response, maxBytes) {
  if (!response.body) return 0;

  const reader = response.body.getReader();
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;

    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error("response_too_large");
    }
  }
  return total;
}

// ---------- Probe ----------
async function probeOnce(urlString, timeoutMs = TIMEOUT_MS) {
  const valid = isValidPublicHttpUrl(urlString);
  if (!valid.ok) return { ok: false, error: valid.reason };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  const start = Date.now();

  try {
    const res = await fetch(valid.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "accept-encoding": "identity" },
    });

    const ttfb_ms = Date.now() - start;

    await readWithLimit(res, MAX_BYTES);
    const total_ms = Date.now() - start;

    return {
      ok: true,
      url: valid.url,
      status: res.status,
      ttfb_ms,
      total_ms,
    };
  } catch (err) {
    const msg = String(err?.message || err?.name || err);

    if (msg.includes("response_too_large"))
      return { ok: false, error: "response_too_large" };

    if (msg.toLowerCase().includes("timeout") || err === "timeout")
      return { ok: false, error: "timeout" };

    if (msg.toLowerCase().includes("abort"))
      return { ok: false, error: "timeout" };

    return { ok: false, error: "fetch_failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------- Durable Object helpers ----------
function getProbeStoreStub(env, urlString) {
  const id = env.PROBE_STORE.idFromName(urlString);
  return env.PROBE_STORE.get(id);
}

function storeSample(ctx, stub, urlString, sample) {
  ctx.waitUntil(
    stub.fetch("https://do/store/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlString, sample }),
    })
  );
}

function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return null;
  const idx = Math.ceil(p * sortedNums.length) - 1;
  const safeIdx = Math.min(Math.max(idx, 0), sortedNums.length - 1);
  return sortedNums[safeIdx];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // keep ok endpoint
    if (url.pathname === "/api/ok") return Response.json({ ok: true });

    // -------- Day 7: History endpoint (already) --------
    if (url.pathname === "/api/history") {
      const target = url.searchParams.get("url") || "";
      const limit = url.searchParams.get("limit") || "25";

      if (!target) {
        return Response.json({ ok: false, error: "missing_url" }, { status: 400 });
      }

      const stub = getProbeStoreStub(env, target);
      return stub.fetch(
        `https://do/store/history?url=${encodeURIComponent(
          target
        )}&limit=${encodeURIComponent(limit)}`
      );
    }

    // -------- Day 8: Stats endpoint --------
    if (url.pathname === "/api/stats") {
      const target = url.searchParams.get("url") || "";
      const limit = url.searchParams.get("limit") || "200";

      if (!target) {
        return Response.json({ ok: false, error: "missing_url" }, { status: 400 });
      }

      const stub = getProbeStoreStub(env, target);
      const res = await stub.fetch(
        `https://do/store/history?url=${encodeURIComponent(
          target
        )}&limit=${encodeURIComponent(limit)}`
      );

      const data = await res.json();
      const history = data.history || [];

      const totalCount = history.length;
      const okSamples = history.filter((s) => s.ok === true && typeof s.total_ms === "number");
      const errSamples = history.filter((s) => s.ok === false);

      const totals = okSamples.map((s) => s.total_ms).sort((a, b) => a - b);

      const current = okSamples.length ? okSamples[okSamples.length - 1] : null;
      const p50 = percentile(totals, 0.5);
      const p95 = percentile(totals, 0.95);
      const error_rate = totalCount ? Math.round((errSamples.length / totalCount) * 1000) / 10 : 0;

      return Response.json({
        ok: true,
        url: target,
        samples: totalCount,
        ok_samples: okSamples.length,
        errors: errSamples.length,
        error_rate_pct: error_rate,
        current_total_ms: current?.total_ms ?? null,
        current_ttfb_ms: current?.ttfb_ms ?? null,
        p50_total_ms: p50,
        p95_total_ms: p95,
      });
    }

    // -------- Probe endpoint (store success + failure) --------
    if (url.pathname === "/api/probe") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
      }

      const targetUrl = body?.url;
      if (typeof targetUrl !== "string" || targetUrl.trim().length === 0) {
        return Response.json({ ok: false, error: "invalid_url" }, { status: 400 });
      }

      // validate early so we know what key to store under (normalized url)
      const valid = isValidPublicHttpUrl(targetUrl.trim());
      if (!valid.ok) {
        // store invalid attempts under the raw input (optional); here we just return
        return Response.json({ ok: false, error: "invalid_url" }, { status: 400 });
      }

      const result = await probeOnce(valid.url, TIMEOUT_MS);
      const stub = getProbeStoreStub(env, valid.url);

      // store BOTH success and failure for error_rate
      const sample =
        result.ok
          ? {
              ts: Date.now(),
              ok: true,
              status: result.status,
              ttfb_ms: result.ttfb_ms,
              total_ms: result.total_ms,
            }
          : {
              ts: Date.now(),
              ok: false,
              error: result.error,
            };

      storeSample(ctx, stub, valid.url, sample);

      if (!result.ok) {
        const status =
          result.error === "timeout"
            ? 408
            : result.error === "response_too_large"
            ? 413
            : 502;

        return Response.json(result, { status });
      }

      return Response.json(result);
    }

    return new Response("Not found", { status: 404 });
  },
};