export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ok") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};
