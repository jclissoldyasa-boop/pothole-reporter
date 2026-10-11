# Motorcycle Pothole Reporter

One tap logs a pothole's GPS location, road, travel direction and time, sorts it to VicRoads or the council for that spot (e.g. Melton, Moorabool), opens a filled-in email to send, and puts it on the riders' pothole map.

Live: https://motopotholereporter.au/ (moved from https://jclissoldyasa-boop.github.io/pothole-reporter/ on 2026-10-11)

## Put it on your phone

1. Open the address above in Chrome on your phone.
2. Tap the sign once and choose Allow when it asks for location.
3. Chrome menu (⋮) → Add to Home screen (or Install app).

Ride safe: mount the phone, one tap, eyes back on the road. Or have your pillion tap.

## Updating

The app is served from Cloudflare (static assets, `wrangler.jsonc` + `site-worker.js` in this folder; `.assetsignore` keeps `server/` and these files off the site). Deploy with `server/node_modules/.bin/wrangler deploy` from this folder. Also push to `main`: GitHub Pages still serves the old address, where `app.js` hands each phone's saved data to the new address once (in the link after `#`, which never leaves the phone) and then just forwards. The phone picks up the new version the next time the app opens with signal.

## Riders' map and counter

- Each logged pothole's spot is sent to a small Cloudflare Worker (`server/`) with a D1 database. The server keeps only the latitude/longitude, the direction of travel (to the nearest 10°, so pothole-ahead warnings skip the other side of the road) and the day. No name, phone, email, road, time of day or IP address.
- The header counter shows the total logged by all riders and how many this week.
- The map (Leaflet + OpenStreetMap tiles) shows potholes from the last 7 days, 30 days, year or all time, coloured by age.
- Tap a pin to say the pothole is Gone, "Fixed" (a dodgy patch, in quotes), or Still there. One vote per rider (connection) per pothole, changeable. Once gone + "fixed" votes are 3 more than still-there votes, it comes off the map and counts towards the header's "fixed" total. Votes store only a secret-salted hash of IP + pothole id. `CLEAR_AT` in `server/src/worker.js` sets the threshold.
- The rider who logged a pothole can tap **Fixed** (in "To send") or **Mark fixed** (in "Sent"): it comes off the map straight away but stays in the totals and the "fixed" count.
- The header shows potholes reported by riders, potholes "fixed", and the top 3 worst-offender councils (most potholes reported on council roads). The phone tells the server the state, whether it's a main road, and the council (`state:core name`, e.g. `vic:melton`, validated against the lists the server knows; Victoria's 79 so far). Each state's main-road total shows under the league.
- Deleting a report on the phone (meant for mistakes) takes it off the map and out of the counts (the phone keeps a private delete key for each one). Sharing can be turned off in "Your details".
- API: `GET /api/stats`, `GET /api/potholes?days=30`, `POST /api/potholes {lat,lng}`, `POST /api/potholes/:id/flag {kind: gone|fixed|there}`, `POST /api/potholes/:id/council {council, state, road, heading}` (older apps send `{council: "melton", vicroads}`, still accepted) and `POST /api/potholes/:id/fixed` (owner only, `X-Delete-Key`), `DELETE /api/potholes/:id` with `X-Delete-Key`. Posts are limited to 120 an hour per IP (salted, daily-rotating hash) and must be inside Australia.
- Deploy the server: `cd server && npm install && npm run deploy` (needs `wrangler login`; applies migrations first). **Deploy the server before the app** whenever the council/state format changes, or new phones' syncs get refused. Live at https://api.motopotholereporter.au (and https://pothole-reporter.drivemate-app.workers.dev, kept for phones on older versions)
- A copy of the app opened from `localhost` talks to `wrangler dev` on port 8787 instead, so testing doesn't touch the live map.

## Council contacts

- Councils and saved emails are keyed `state:core name` (`vic:melton`), road authorities `road:vic`, because council and suburb names repeat across states.

- `councils.js` lists all 79 Victorian councils with the phone, customer-service email (which takes road hazard reports) and website, from the Vic Councils (MAV) council contacts list. Melbourne and Port Phillip take reports only through their websites.
- "Council contacts" opens a list of states and territories. Each shows its road authority (`ROADS` in `app.js`) and councils: Victoria's full list, elsewhere just the councils from your reports until each state's list is added. Anyone can change the email for any council or road authority. Changes are saved on that phone only, with "Use standard" to go back.
- Council names from OpenStreetMap ("Shire of Moorabool") are matched to the list ("Moorabool Shire Council") on the core name.

## Privacy and security

- Your name, phone and email are stored only on your phone and only go into the emails you send yourself. They're never sent to the map server or the lookup services.
- The map server stores a location (rounded to ~10 m), the day, and a hash of a delete key. Nothing else: no names, contacts, times, roads or IP addresses. The rate limit uses an IP hash salted with a secret (`wrangler secret put RATE_SALT`) and the day.
- Only the phone that logged a pothole can delete it (it holds the key; the server keeps only its hash). Nobody can edit reports, and the API never returns ids or keys in map data.
- Requests over 512 bytes, outside Australia, or not plain numbers are refused. Browser access is limited to this site (CORS).
- The page has a Content Security Policy limiting it to the services it uses, and the map library is pinned with integrity hashes.
- `cd server && npm test` runs the security checks against `wrangler dev` (don't point it at the live map).

## Notes

- Road names come from OpenStreetMap (Nominatim). Reports are kept on the phone until you mark them as sent.
- Main roads go to the state's road authority (`ROADS` in `app.js`): VicRoads (enquiries@roads.vic.gov.au), Main Roads WA and NT Government roads by email; NSW, Queensland, SA, Tasmania and the ACT take reports by phone or website only, so riders add an email or use those. The ACT has no councils, so every ACT road goes to the ACT Government.
- Each local-road pothole goes to the council for that spot, found from OpenStreetMap council boundaries (Overpass API), with built-in Melton and Moorabool town lists as a fallback. Reports from different councils on one trip get their own email button.
- Freeways, highways and roads with a state route number go to the road authority: M/A/B/C in Victoria and Tasmania, M/A/B elsewhere, plus plain numbered routes in WA, Queensland and the NT. Outside Victoria, OpenStreetMap motorway/trunk roads do too. In Melton, the council's published list of VicRoads-controlled roads is also used.
