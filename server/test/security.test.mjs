// Security checks for the riders' map API. Run against `wrangler dev`: npm test
// (BASE=https://... to point elsewhere, but don't run it against the live map: it adds and removes rows.)
import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8787";
let failed = 0;
const ok = (cond, name) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failed++; };
const post = body => fetch(BASE + "/api/potholes", { method: "POST", headers: { "Content-Type": "application/json" }, body });
const del = (id, key) => fetch(BASE + "/api/potholes/" + id, { method: "DELETE", headers: key == null ? {} : { "X-Delete-Key": key } });

// The schema has nowhere to put personal details.
const schema = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8").toLowerCase();
ok(!/\b(name|email|phone|ip|address|time|user)\w*\s+(text|integer|real)/.test(schema.replace(/--.*$/gm, "")), "schema has no personal-data columns");

const stats = await (await fetch(BASE + "/api/stats")).json();
ok(JSON.stringify(Object.keys(stats).sort()) === '["fixed","total","week"]', "stats returns only counts");

const a = await post(JSON.stringify({ lat: -37.6870123, lng: 144.5620456, name: "Sam", phone: "0400 000 000", email: "sam@example.com" }));
const ra = await a.json();
ok(a.status === 201 && ra.id && /^[A-Za-z0-9_-]{24}$/.test(ra.key), "report accepted, delete key returned once");
const b = await post(JSON.stringify({ lat: -37.70, lng: 144.60 }));
const rb = await b.json();

const list = await (await fetch(BASE + "/api/potholes?days=1")).json();
const raw = JSON.stringify(list);
ok(list.points.every(p => Array.isArray(p) && p.length === 7 && typeof p[3] === "string" && [0, 1, 2, 4, 5, 6].every(i => typeof p[i] === "number")), "map points are only location, age, public id and vote counts");
ok(!/"(name|phone|email|key|key_hash|voter|ip)"/.test(raw) && !["Sam", "0400 000 000", "sam@example.com", ra.key].some(x => raw.includes(x)), "map data has no names, contacts, keys or voters");
ok(list.points.some(p => p[0] === -37.687 && p[1] === 144.562), "locations rounded to ~10 m");

// Flags: one vote per connection per pothole, and enough "gone"/"fixed" votes clear it off the map.
const flag = (id, kind) => fetch(BASE + "/api/potholes/" + id + "/flag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
ok((await flag(ra.id, "nope")).status === 400, "unknown flag kind refused");
ok((await flag("doesnotexist", "gone")).status === 404, "flagging a missing pothole refused");
await flag(ra.id, "gone"); await flag(ra.id, "fixed"); const v3 = await (await flag(ra.id, "gone")).json();
ok(v3.votes.gone + v3.votes.fixed === 1 && !v3.cleared, "repeat votes from one rider count once");
const listF = await (await fetch(BASE + "/api/potholes?days=1")).json();
ok(listF.points.some(p => p[3] === ra.id), "still on the map below the threshold");

// Different riders. Faking CF-Connecting-IP only works on wrangler dev; Cloudflare sets it in production.
const flagAs = (id, kind, ip) => fetch(BASE + "/api/potholes/" + id + "/flag", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ kind }) });
const c = await (await post(JSON.stringify({ lat: -37.71, lng: 144.61 }))).json();
await flagAs(c.id, "gone", "10.0.0.1"); await flagAs(c.id, "fixed", "10.0.0.2"); await flagAs(c.id, "there", "10.0.0.3");
const held = await (await flagAs(c.id, "fixed", "10.0.0.4")).json();
ok(!held.cleared && held.votes.there === 1, "a 'still there' vote holds it on the map");
const gone = await (await flagAs(c.id, "gone", "10.0.0.5")).json();
ok(gone.cleared, "enough riders saying it's fixed clears it");
const listC = await (await fetch(BASE + "/api/potholes?days=1")).json();
ok(!listC.points.some(p => p[3] === c.id) && listC.fixed >= 1, "cleared pothole is off the map and counted as fixed");
await del(c.id, c.key);

ok((await del(ra.id)).status === 401, "delete without key refused");
ok((await (await del(ra.id, "A".repeat(24))).json()).deleted === 0, "delete with wrong key does nothing");
ok((await (await del(ra.id, rb.key)).json()).deleted === 0, "one phone's key can't delete another phone's report");
ok((await (await del(ra.id, ra.key)).json()).deleted === 1, "owner's key deletes the report");
ok((await (await del(rb.id, rb.key)).json()).deleted === 1, "clean up second report");

ok((await post(JSON.stringify({ lat: 51.5, lng: 0 }))).status === 400, "locations outside Australia refused");
ok((await post("not json")).status === 400, "bad JSON refused");
ok((await post(JSON.stringify({ lat: -37.7, lng: 144.6, pad: "x".repeat(1000) }))).status === 413, "oversized body refused");
ok((await post(JSON.stringify({ lat: "-37.7; DROP TABLE potholes", lng: 144.6 }))).status === 400, "non-numeric location refused");
ok((await fetch(BASE + "/api/potholes/" + ra.id, { method: "PUT" })).status === 404, "no way to edit reports");
ok((await fetch(BASE + "/api/rate")).status === 404, "rate-limit table not exposed");

const pre = await fetch(BASE + "/api/potholes", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
ok(pre.headers.get("Access-Control-Allow-Origin") !== "https://evil.example", "other websites can't use the API from a browser");
const h = await fetch(BASE + "/api/stats");
ok(h.headers.get("X-Content-Type-Options") === "nosniff" && h.headers.get("Referrer-Policy") === "no-referrer", "security headers set");

console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
