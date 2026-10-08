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
// Victoria's 79 councils by core name (matches coreName() in the app). Anything else is refused.
const COUNCILS = new Set(["alpine", "ararat", "ballarat", "banyule", "bass coast", "baw baw", "bayside", "benalla", "boroondara", "brimbank", "buloke", "campaspe", "cardinia", "casey", "central goldfields", "colac otway", "corangamite", "darebin", "east gippsland", "frankston", "gannawarra", "glen eira", "glenelg", "golden plains", "greater bendigo", "greater dandenong", "greater geelong", "greater shepparton", "hepburn", "hindmarsh", "hobsons bay", "horsham", "hume", "indigo", "kingston", "knox", "latrobe", "loddon", "macedon ranges", "manningham", "mansfield", "maribyrnong", "maroondah", "melbourne", "melton", "merri bek", "mildura", "mitchell", "moira", "monash", "moonee valley", "moorabool", "mornington peninsula", "mount alexander", "moyne", "murrindindi", "nillumbik", "northern grampians", "port phillip", "pyrenees", "queenscliffe", "south gippsland", "southern grampians", "stonnington", "strathbogie", "surf coast", "swan hill", "towong", "wangaratta", "warrnambool", "wellington", "west wimmera", "whitehorse", "whittlesea", "wodonga", "wyndham", "yarra", "yarra ranges", "yarriambiack"]);
const MAX_BODY = 512; // bytes; a report is just {"lat":..,"lng":..}
const MAX_POINTS = 20000;
const MAX_FEEDBACK = 4096; // bytes; a message of up to 2000 characters plus a contact
const FEEDBACK_ROWS = 2000; // stops a flood filling the database; delete read messages to make room

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

// Direction of travel: whole degrees, rounded to 10. Missing means unknown; anything else is refused.
function headingOf(v) {
  if (v === undefined || v === null) return { ok: true, h: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 360) return { ok: false };
  return { ok: true, h: (Math.round(v / 10) * 10) % 360 };
}

async function stats(env) {
  const now = today();
  const week = new Date(Date.parse(now) - 6 * 86400000).toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS week, " +
    "SUM(CASE WHEN cleared_day IS NOT NULL THEN 1 ELSE 0 END) AS fixed, SUM(vicroads) AS vicroads FROM potholes"
  ).bind(week).first();
  // Worst offenders: councils with the most potholes reported in their area, VicRoads roads included.
  const { results: worst } = await env.DB.prepare(
    "SELECT council, COUNT(*) AS n FROM potholes WHERE council IS NOT NULL GROUP BY council ORDER BY n DESC, council LIMIT 3"
  ).all();
  return { total: r.total || 0, week: r.week || 0, fixed: r.fixed || 0, vicroads: r.vicroads || 0, worst: worst.map(w => [w.council, w.n]) };
}

// The phone that logged a pothole proves it with its key; the server only has the key's hash.
async function ownerOk(req, env, id) {
  const key = req.headers.get("X-Delete-Key") || "";
  if (!/^[A-Za-z0-9_-]{24}$/.test(key)) return false;
  return !!(await env.DB.prepare("SELECT 1 FROM potholes WHERE id = ? AND key_hash = ?").bind(id, await sha256(key)).first());
}

async function votes(env, id) {
  const r = await env.DB.prepare(
    "SELECT SUM(kind = 'gone') AS gone, SUM(kind = 'fixed') AS fixed, SUM(kind = 'there') AS there FROM flags WHERE pothole_id = ?"
  ).bind(id).first();
  return { gone: r.gone || 0, fixed: r.fixed || 0, there: r.there || 0 };
}

// The owner's inbox key is a Worker secret (INBOX_KEY). Hashing both sides keeps the comparison constant-time.
async function inboxOk(req, env) {
  const got = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!env.INBOX_KEY || env.INBOX_KEY.length < 20 || !got) return false;
  return (await sha256(got)) === (await sha256(env.INBOX_KEY));
}
const text = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";

// Private feedback inbox. The key travels in the link's #fragment, which browsers never send to the server.
const INBOX_HTML = `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Pothole Reporter feedback</title>
<style>
:root{--bg:#e9e7e2;--card:#fff;--ink:#17181a;--muted:#5d6267;--line:#d2cfc7;--warn:#b3261e;--sign:#f5c518}
@media (prefers-color-scheme:dark){:root{--bg:#0f1011;--card:#1b1d20;--ink:#f1efe9;--muted:#a3a8ad;--line:#33373c;--warn:#ff8a80}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
h1{font-size:1.3rem;margin:4px 0 12px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
button{font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;border:2px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer}
button.main{background:var(--sign);border-color:var(--sign);color:#141516}
button.del{border-color:var(--warn);color:var(--warn);padding:5px 10px;font-size:.85rem}
.msg{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 10px}
.msg p{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.meta{display:flex;justify-content:space-between;gap:10px;align-items:center;color:var(--muted);font-size:.85rem}
.status{color:var(--muted)}
</style></head><body><main>
<h1>Rider feedback</h1>
<div class="bar"><button class="main" id="copy" type="button" hidden>Copy all</button><span class="status" id="status" role="status">Loading…</span></div>
<div id="list"></div>
</main><script src="inbox.js"></script></body></html>`;
const INBOX_JS = `(function(){
  "use strict";
  const key=location.hash.slice(1),$=id=>document.getElementById(id);
  let rows=[];
  const api=(path,opt)=>fetch("api/feedback"+path,{...opt,headers:{Authorization:"Bearer "+key}});
  const plain=r=>r.day+(r.device?" ("+r.device+")":"")+"\n"+r.message+(r.contact?"\nReply to: "+r.contact:"");
  function render(){
    const list=$("list");list.textContent="";
    $("copy").hidden=!rows.length;
    $("status").textContent=rows.length?rows.length+(rows.length===1?" message":" messages"):"No feedback yet.";
    rows.forEach(r=>{
      const d=document.createElement("div");d.className="msg";
      const p=document.createElement("p");p.textContent=r.message;d.appendChild(p);
      if(r.contact){const c=document.createElement("p");c.textContent="Reply to: "+r.contact;d.appendChild(c)}
      const m=document.createElement("div");m.className="meta";
      const s=document.createElement("span");s.textContent=r.day+(r.device?" · "+r.device:"");m.appendChild(s);
      const b=document.createElement("button");b.type="button";b.className="del";b.textContent="Delete";
      b.onclick=async()=>{b.disabled=true;const x=await api("/"+r.id,{method:"DELETE"}).catch(()=>null);
        if(x&&x.ok){rows=rows.filter(y=>y!==r);render()}else{b.disabled=false;$("status").textContent="Couldn't delete. Try again."}};
      m.appendChild(b);d.appendChild(m);list.appendChild(d);
    });
  }
  $("copy").onclick=async()=>{
    try{await navigator.clipboard.writeText(rows.map(plain).join("\n\n"));$("status").textContent="Copied. Paste it into your note."}
    catch(e){$("status").textContent="Couldn't copy. Select the text and copy it by hand."}
  };
  if(!key){$("status").textContent="This link is missing its key. Use the full inbox link.";return}
  api("").then(r=>{if(r.status===403)throw new Error("key");if(!r.ok)throw new Error();return r.json()})
    .then(d=>{rows=d.feedback;render()})
    .catch(e=>{$("status").textContent=e.message==="key"?"Wrong key. Use the full inbox link.":"Couldn't load. Check your signal and refresh."});
})();`;

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
        "SELECT p.id, p.lat, p.lng, p.day, p.heading, " +
        "COALESCE(SUM(f.kind = 'gone'), 0) AS gone, COALESCE(SUM(f.kind = 'fixed'), 0) AS fixed, COALESCE(SUM(f.kind = 'there'), 0) AS there " +
        "FROM potholes p LEFT JOIN flags f ON f.pothole_id = p.id " +
        "WHERE p.day >= ? AND p.cleared_day IS NULL GROUP BY p.id ORDER BY p.day DESC LIMIT ?"
      ).bind(since, MAX_POINTS).all();
      // [lat, lng, daysAgo, id, gone, "fixed", still there, heading or null]. The id is public: it only lets riders vote.
      const points = results.map(r => [r.lat, r.lng, daysAgo(r.day, now), r.id, r.gone, r.fixed, r.there, r.heading]);
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
      const hd = headingOf(body.heading);
      if (!hd.ok) return json(req, { error: "heading must be 0 to 359 degrees" }, 400);
      if (await overLimit(req, env)) return json(req, { error: "too many reports, try later" }, 429);
      const id = randomId(9), key = randomId(18);
      // Rounded to about 10 m: plenty to find a pothole, too coarse to pick out a house.
      await env.DB.prepare("INSERT INTO potholes (id, lat, lng, day, key_hash, heading) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, today(), await sha256(key), hd.h).run();
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

    // Owner-only: set the council area, whether it's a VicRoads road and the direction of travel, or mark it fixed straight away.
    const o = url.pathname.match(/^\/api\/potholes\/([A-Za-z0-9_-]{6,32})\/(council|fixed)$/);
    if (o && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json(req, { error: "too large" }, 413);
      if (!(await ownerOk(req, env, o[1]))) return json(req, { error: "not yours" }, 403);
      if (o[2] === "council") {
        let council, vicroads, heading;
        try { ({ council, vicroads = false, heading } = JSON.parse(raw)); } catch { return json(req, { error: "bad json" }, 400); }
        if (council !== "" && !COUNCILS.has(council)) return json(req, { error: "unknown council" }, 400);
        if (typeof vicroads !== "boolean") return json(req, { error: "vicroads must be true or false" }, 400);
        const hd = headingOf(heading);
        if (!hd.ok) return json(req, { error: "heading must be 0 to 359 degrees" }, 400);
        // Older apps don't send a heading, so leave any saved one alone rather than wiping it.
        await env.DB.prepare("UPDATE potholes SET council = ?, vicroads = ?, heading = COALESCE(?, heading) WHERE id = ?")
          .bind(council || null, vicroads ? 1 : 0, hd.h, o[1]).run();
        return json(req, { council, vicroads, ...(await stats(env)) });
      }
      await env.DB.prepare("UPDATE potholes SET cleared_day = ? WHERE id = ? AND cleared_day IS NULL").bind(today(), o[1]).run();
      return json(req, { cleared: true, ...(await stats(env)) });
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

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_FEEDBACK) return json(req, { error: "too long" }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, { error: "bad json" }, 400); }
      const message = text(body && body.message, 2000);
      if (!message) return json(req, { error: "message is empty" }, 400);
      if (await overLimit(req, env)) return json(req, { error: "too many messages, try later" }, 429);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first();
      if (n.n >= FEEDBACK_ROWS) return json(req, { error: "inbox full, try later" }, 503);
      await env.DB.prepare("INSERT INTO feedback (day, message, contact, device) VALUES (?, ?, ?, ?)")
        .bind(today(), message, text(body.contact, 200) || null, text(body.device, 60) || null).run();
      return json(req, { sent: true }, 201);
    }

    // Owner only, from the /inbox page.
    if (url.pathname === "/api/feedback" && req.method === "GET") {
      if (!(await inboxOk(req, env))) return json(req, { error: "wrong key" }, 403);
      const { results } = await env.DB.prepare("SELECT id, day, message, contact, device FROM feedback ORDER BY id DESC").all();
      return json(req, { feedback: results });
    }
    const fb = url.pathname.match(/^\/api\/feedback\/(\d{1,10})$/);
    if (fb && req.method === "DELETE") {
      if (!(await inboxOk(req, env))) return json(req, { error: "wrong key" }, 403);
      const r = await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(+fb[1]).run();
      return json(req, { deleted: r.meta.changes });
    }

    if (url.pathname === "/inbox" || url.pathname === "/inbox.js") {
      const page = url.pathname === "/inbox";
      return new Response(page ? INBOX_HTML : INBOX_JS, {
        headers: {
          "Content-Type": page ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex", "Strict-Transport-Security": "max-age=31536000",
        },
      });
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
