// Shared pothole map for Motorcycle Pothole Reporter.
// Stores only where a pothole is and the day it was logged. No names, roads, times or IP addresses.

const ORIGINS = ["https://jclissoldyasa-boop.github.io"];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// Rough box around Australia, so typos and junk don't land on the map.
const BOUNDS = { latMin: -44.5, latMax: -9, lngMin: 112, lngMax: 154.5 };
const POSTS_PER_HOUR = 120;
const MAX_POINTS = 20000;

function cors(req) {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || LOCAL.test(o) ? o : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Delete-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(req, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...cors(req), ...extra },
  });
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
function daysAgo(day, now) {
  return Math.max(0, Math.round((Date.parse(now) - Date.parse(day)) / 86400000));
}
async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function randomId(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Counts posts per salted IP hash per hour. The salt changes daily, so hashes can't be linked across days.
async function overLimit(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  const bucket = (await sha256(ip + "|" + hour.slice(0, 10) + "|pothole")).slice(0, 32) + "|" + hour;
  const row = await env.DB.prepare(
    "INSERT INTO rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(bucket).first();
  return row.n > POSTS_PER_HOUR;
}

async function stats(env) {
  const now = today();
  const week = new Date(Date.parse(now) - 6 * 86400000).toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS week FROM potholes"
  ).bind(week).first();
  return { total: r.total || 0, week: r.week || 0 };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

    if (url.pathname === "/api/stats" && req.method === "GET") {
      return json(req, await stats(env), 200, { "Cache-Control": "public, max-age=30" });
    }

    if (url.pathname === "/api/potholes" && req.method === "GET") {
      const days = Math.min(3650, Math.max(1, parseInt(url.searchParams.get("days") || "365", 10) || 365));
      const now = today();
      const since = new Date(Date.parse(now) - (days - 1) * 86400000).toISOString().slice(0, 10);
      const { results } = await env.DB.prepare(
        "SELECT lat, lng, day FROM potholes WHERE day >= ? ORDER BY day DESC LIMIT ?"
      ).bind(since, MAX_POINTS).all();
      const points = results.map(r => [r.lat, r.lng, daysAgo(r.day, now)]);
      return json(req, { days, points, ...(await stats(env)) }, 200, { "Cache-Control": "public, max-age=30" });
    }

    if (url.pathname === "/api/potholes" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json(req, { error: "bad json" }, 400); }
      const lat = Number(body && body.lat), lng = Number(body && body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) {
        return json(req, { error: "location outside Australia" }, 400);
      }
      if (await overLimit(req, env)) return json(req, { error: "too many reports, try later" }, 429);
      const id = randomId(9), key = randomId(18);
      await env.DB.prepare("INSERT INTO potholes (id, lat, lng, day, key_hash) VALUES (?, ?, ?, ?, ?)")
        .bind(id, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, today(), await sha256(key)).run();
      return json(req, { id, key, ...(await stats(env)) }, 201);
    }

    const m = url.pathname.match(/^\/api\/potholes\/([A-Za-z0-9_-]{6,32})$/);
    if (m && req.method === "DELETE") {
      const key = req.headers.get("X-Delete-Key") || "";
      if (!key) return json(req, { error: "missing key" }, 401);
      const r = await env.DB.prepare("DELETE FROM potholes WHERE id = ? AND key_hash = ?")
        .bind(m[1], await sha256(key)).run();
      // Gone already counts as done, so a retry after a dropped connection is fine.
      return json(req, { deleted: r.meta.changes, ...(await stats(env)) });
    }

    if (url.pathname === "/") {
      return new Response("Motorcycle Pothole Reporter map server. The app is at https://jclissoldyasa-boop.github.io/pothole-reporter/\n",
        { headers: { "Content-Type": "text/plain" } });
    }
    return json(req, { error: "not found" }, 404);
  },

  // Daily: drop old rate-limit counters.
  async scheduled(_ev, env) {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 13);
    await env.DB.prepare("DELETE FROM rate WHERE substr(bucket, 34) < ?").bind(cutoff).run();
  },
};
