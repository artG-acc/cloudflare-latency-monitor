import { ProbeStoreDO } from "./ProbeStoreDO.js";
export { ProbeStoreDO };

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;


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

  if (looksLikeIpLiteral(host)) {
    if (isPrivateIpv4(host)) return { ok: false, reason: "invalid_url" };
    return { ok: false, reason: "invalid_url" };
  }

  return { ok: true, url: u.toString() };
}

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
      headers: {
        "accept-encoding": "identity",
      },
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


function getProbeStoreStub(env, urlString) {

  if (!env?.PROBE_STORE) return null;

  const id = env.PROBE_STORE.idFromName(urlString);
  return env.PROBE_STORE.get(id);
}

async function storeSample(ctx, stub, urlString, sample) {
  if (!stub) return;

  ctx.waitUntil(
    stub.fetch("https://do/store/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlString, sample }),
    })
  );
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ok") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/history") {
      const target = url.searchParams.get("url") || "";
      const limit = url.searchParams.get("limit") || "25";

      if (!target) {
        return Response.json({ ok: false, error: "missing_url" }, { status: 400 });
      }

      const stub = getProbeStoreStub(env, target);
      if (!stub) {

        return Response.json(
          { ok: false, error: "do_not_configured" },
          { status: 501 }
        );
      }

      return stub.fetch(
        `https://do/store/history?url=${encodeURIComponent(
          target
        )}&limit=${encodeURIComponent(limit)}`
      );
    }


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

      const result = await probeOnce(targetUrl.trim(), TIMEOUT_MS);

      if (!result.ok) {
        const status =
          result.error === "invalid_url"
            ? 400
            : result.error === "timeout"
            ? 408
            : result.error === "response_too_large"
            ? 413
            : 502;

        return Response.json(result, { status });
      }

      const stub = getProbeStoreStub(env, result.url);
      const sample = {
        ts: Date.now(),
        status: result.status,
        ttfb_ms: result.ttfb_ms,
        total_ms: result.total_ms,
      };
      await storeSample(ctx, stub, result.url, sample);

      return Response.json(result);
    }

    return new Response("Not found", { status: 404 });
  },
};