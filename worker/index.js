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

  // Basic safety blocks (minimal, but good for now)
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { ok: false, reason: "invalid_url" };
  }

  return { ok: true, url: u.toString() };
}

async function probeOnce(urlString, timeoutMs = 8000) {
  const valid = isValidPublicHttpUrl(urlString);
  if (!valid.ok) {
    return {
      ok: false,
      error: valid.reason, // "invalid_url"
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  const start = Date.now();

  try {
    // Day 4: "TTFB-ish" = time until fetch resolves (headers available)
    const res = await fetch(valid.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    const ttfb_ms = Date.now() - start;

    // Optional: basic guard against huge downloads (keeps dev safe)
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > 1_000_000) {
      return {
        ok: false,
        error: "response_too_large",
      };
    }

    // Day 3: total time = start → body fully read
    // Day 4: we keep this and return both.
    await res.arrayBuffer();

    const total_ms = Date.now() - start;

    return {
      ok: true,
      url: valid.url,
      status: res.status,
      ttfb_ms,
      total_ms,
    };
  } catch (err) {
    const msg = String(err?.name || err?.message || err);

    if (msg.toLowerCase().includes("timeout") || err === "timeout") {
      return { ok: false, error: "timeout" };
    }

    // AbortController aborts throw an error too
    if (msg.toLowerCase().includes("abort")) {
      return { ok: false, error: "timeout" };
    }

    return { ok: false, error: "fetch_failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Keep Day 2 endpoint
    if (url.pathname === "/api/ok") {
      return Response.json({ ok: true });
    }

    // Day 3 + Day 4 endpoint
    if (url.pathname === "/api/probe") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { ok: false, error: "invalid_json" },
          { status: 400 }
        );
      }

      const targetUrl = body?.url;

      if (typeof targetUrl !== "string" || targetUrl.trim().length === 0) {
        return Response.json(
          { ok: false, error: "invalid_url" },
          { status: 400 }
        );
      }

      const result = await probeOnce(targetUrl.trim(), 8000);

      // Map errors to HTTP status (helps UI)
      if (!result.ok) {
        const status =
          result.error === "invalid_url"
            ? 400
            : result.error === "timeout"
            ? 408
            : 502;

        return Response.json(result, { status });
      }

      return Response.json(result);
    }

    // For all other routes:
    // your wrangler.toml run_worker_first = ["/api/*"]
    // means non-API requests will go straight to assets.
    return new Response("Not found", { status: 404 });
  },
};