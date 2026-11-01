const ID_BYTES = 16;
const ID_PATTERN = /^\/([A-Za-z0-9_-]{22})$/;

// Snapshots are third-party markup on our origin: no scripts, no indexing, no referrer leaks.
const VIEW_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=300"
};

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function isAuthorized(request, env) {
  const encoder = new TextEncoder();
  const hash = value => crypto.subtle.digest("SHA-256", encoder.encode(value));
  const [given, expected] = await Promise.all([
    hash(request.headers.get("Authorization") ?? ""),
    hash(`Bearer ${env.UPLOAD_TOKEN}`)
  ]);
  return crypto.subtle.timingSafeEqual(given, expected);
}

async function create(request, env, origin) {
  const id = newId();
  await env.PAGES.put(id, request.body, {
    httpMetadata: { contentType: VIEW_HEADERS["Content-Type"] },
    customMetadata: {
      title: request.headers.get("X-Page-Title") ?? "",
      createdAt: new Date().toISOString()
    }
  });
  return Response.json({ id, url: `${origin}/${id}` }, { status: 201 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.UPLOAD_TOKEN) return new Response("UPLOAD_TOKEN is not set", { status: 500 });

    if (url.pathname === "/api/pages" && request.method === "POST") {
      if (!(await isAuthorized(request, env))) return new Response("Unauthorized", { status: 401 });
      return create(request, env, url.origin);
    }

    const id = url.pathname.match(ID_PATTERN)?.[1];
    if (!id) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });

    if (request.method === "DELETE") {
      if (!(await isAuthorized(request, env))) return new Response("Unauthorized", { status: 401 });
      await env.PAGES.delete(id);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const object = await env.PAGES.get(id);
      if (!object) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
      return new Response(request.method === "HEAD" ? null : object.body, { headers: VIEW_HEADERS });
    }

    return new Response("Method not allowed", { status: 405 });
  }
};
