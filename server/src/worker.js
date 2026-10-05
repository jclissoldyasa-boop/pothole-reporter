// Shared pothole map for Motorcycle Pothole Reporter.
// Stores only where a pothole is and the day it was logged. No names, roads, times or IP addresses.

const ORIGINS = ["https://jclissoldyasa-boop.github.io"];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// Rough box around Australia, so typos and junk don't land on the map.
const BOUNDS = { latMin: -44.5, latMax: -9, lngMin: 112, lngMax: 154.5 };
const POSTS_PER_HOUR = 120;
// A pothole comes off the map once this many more riders say it's gone (or "fixed") than say it's still there.
const CLEAR_AT = 3;
const KINDS = ["gone", "fixed", "there"];
const MAX_BODY = 512; // bytes; a report is just {"lat":..,"lng":..}
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
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Strict-Transport-Security": "max-age=31536000",
      ...cors(req), ...extra,
    },
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

// Counts posts per IP per hour without storing the IP: it's hashed with a secret (RATE_SALT) and the day,
// so the database can't be reversed into IP addresses or linked across days.
async function overLimit(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  const bucket = (await sha256(ip + "|" + hour.slice(0, 10) + "|" + (env.RATE_SALT || ""))).slice(0, 32) + "|" + hour;
  const row = await env.DB.prepare(
    "INSERT INTO rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(bucket).first();
  return row.n > POSTS_PER_HOUR;
}

async function stats(env) {
  const now = today();
  const week = new Date(Date.parse(now) - 6 * 86400000).toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS week, " +
    "SUM(CASE WHEN cleared_day IS NOT NULL THEN 1 ELSE 0 END) AS fixed FROM potholes"
  ).bind(week).first();
  return { total: r.total || 0, week: r.week || 0, fixed: r.fixed || 0 };
}

async function votes(env, id) {
  const r = await env.DB.prepare(
    "SELECT SUM(kind = 'gone') AS gone, SUM(kind = 'fixed') AS fixed, SUM(kind = 'there') AS there FROM flags WHERE pothole_id = ?"
  ).bind(id).first();
  return { gone: r.gone || 0, fixed: r.fixed || 0, there: r.there || 0 };
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
        "SELECT p.id, p.lat, p.lng, p.day, " +
        "COALESCE(SUM(f.kind = 'gone'), 0) AS gone, COALESCE(SUM(f.kind = 'fixed'), 0) AS fixed, COALESCE(SUM(f.kind = 'there'), 0) AS there " +
        "FROM potholes p LEFT JOIN flags f ON f.pothole_id = p.id " +
        "WHERE p.day >= ? AND p.cleared_day IS NULL GROUP BY p.id ORDER BY p.day DESC LIMIT ?"
      ).bind(since, MAX_POINTS).all();
      // [lat, lng, daysAgo, id, gone, "fixed", still there]. The id is public: it only lets riders vote.
      const points = results.map(r => [r.lat, r.lng, daysAgo(r.day, now), r.id, r.gone, r.fixed, r.there]);
      return json(req, { days, points, clearAt: CLEAR_AT, ...(await stats(env)) }, 200, { "Cache-Control": "public, max-age=30" });
    }

    if (url.pathname === "/api/potholes" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json(req, { error: "too large" }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, { error: "bad json" }, 400); }
      const lat = Number(body && body.lat), lng = Number(body && body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) {
        return json(req, { error: "location outside Australia" }, 400);
      }
      if (await overLimit(req, env)) return json(req, { error: "too many reports, try later" }, 429);
      const id = randomId(9), key = randomId(18);
      // Rounded to about 10 m: plenty to find a pothole, too coarse to pick out a house.
      await env.DB.prepare("INSERT INTO potholes (id, lat, lng, day, key_hash) VALUES (?, ?, ?, ?, ?)")
        .bind(id, Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, today(), await sha256(key)).run();
      return json(req, { id, key, ...(await stats(env)) }, 201);
    }

    const f = url.pathname.match(/^\/api\/potholes\/([A-Za-z0-9_-]{6,32})\/flag$/);
    if (f && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json(req, { error: "too large" }, 413);
      let kind;
      try { kind = JSON.parse(raw).kind; } catch { return json(req, { error: "bad json" }, 400); }
      if (!KINDS.includes(kind)) return json(req, { error: "kind must be gone, fixed or there" }, 400);
      const p = await env.DB.prepare("SELECT cleared_day FROM potholes WHERE id = ?").bind(f[1]).first();
      if (!p) return json(req, { error: "not found" }, 404);
      // Vote counts go under "votes" so they don't clash with the site-wide "fixed" total.
      if (p.cleared_day) return json(req, { cleared: true, votes: await votes(env, f[1]), ...(await stats(env)) });
      if (await overLimit(req, env)) return json(req, { error: "too many reports, try later" }, 429);
      // One vote per connection per pothole; voting again changes it.
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const voter = (await sha256(ip + "|" + f[1] + "|" + (env.RATE_SALT || ""))).slice(0, 32);
      await env.DB.prepare(
        "INSERT INTO flags (pothole_id, voter, kind, day) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(pothole_id, voter) DO UPDATE SET kind = excluded.kind, day = excluded.day"
      ).bind(f[1], voter, kind, today()).run();
      const v = await votes(env, f[1]);
      const cleared = v.gone + v.fixed - v.there >= CLEAR_AT;
      if (cleared) await env.DB.prepare("UPDATE potholes SET cleared_day = ? WHERE id = ? AND cleared_day IS NULL").bind(today(), f[1]).run();
      return json(req, { cleared, clearAt: CLEAR_AT, votes: v, ...(await stats(env)) });
    }

    const m = url.pathname.match(/^\/api\/potholes\/([A-Za-z0-9_-]{6,32})$/);
    if (m && req.method === "DELETE") {
      const key = req.headers.get("X-Delete-Key") || "";
      if (!/^[A-Za-z0-9_-]{24}$/.test(key)) return json(req, { error: "missing key" }, 401);
      const r = await env.DB.prepare("DELETE FROM potholes WHERE id = ? AND key_hash = ?")
        .bind(m[1], await sha256(key)).run();
      if (r.meta.changes) await env.DB.prepare("DELETE FROM flags WHERE pothole_id = ?").bind(m[1]).run();
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
