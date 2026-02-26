export class ProbeStoreDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/store/add" && request.method === "POST") {
      const data = await request.json();
      const key = `history:${data.url}`;

      const existing = (await this.state.storage.get(key)) || [];
      existing.push(data.sample);

      // keep last 200 samples per URL
      const trimmed = existing.slice(-200);

      await this.state.storage.put(key, trimmed);

      return Response.json({ ok: true, count: trimmed.length });
    }

    if (url.pathname === "/store/history" && request.method === "GET") {
      const target = url.searchParams.get("url") || "";
      const limit = Number(url.searchParams.get("limit") || "25");

      const key = `history:${target}`;
      const existing = (await this.state.storage.get(key)) || [];
      const sliced = existing.slice(-Math.min(Math.max(limit, 1), 200));

      return Response.json({ ok: true, url: target, history: sliced });
    }

    return new Response("Not found", { status: 404 });
  }
}