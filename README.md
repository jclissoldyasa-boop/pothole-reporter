# Motorcycle Pothole Reporter

One tap logs a pothole's GPS location, road, travel direction and time, sorts it to VicRoads or the council for that spot (e.g. Melton, Moorabool), opens a filled-in email to send, and puts it on the riders' pothole map.

Live: https://jclissoldyasa-boop.github.io/pothole-reporter/

## Put it on your phone

1. Open the address above in Chrome on your phone.
2. Tap the sign once and choose Allow when it asks for location.
3. Chrome menu (⋮) → Add to Home screen (or Install app).

Ride safe: mount the phone, one tap, eyes back on the road. Or have your pillion tap.

## Updating

Push changes to `main`; GitHub Pages republishes. The phone picks up the new version the next time the app opens with signal.

## Riders' map and counter

- Each logged pothole's spot is sent to a small Cloudflare Worker (`server/`) with a D1 database. The server keeps only the latitude/longitude and the day. No name, phone, email, road, time of day or IP address.
- The header counter shows the total logged by all riders and how many this week.
- The map (Leaflet + OpenStreetMap tiles) shows potholes from the last 7 days, 30 days, year or all time, coloured by age.
- Deleting a report on the phone takes it off the map too (the phone keeps a private delete key for each one). Sharing can be turned off in "Your details".
- API: `GET /api/stats`, `GET /api/potholes?days=30`, `POST /api/potholes {lat,lng}`, `DELETE /api/potholes/:id` with `X-Delete-Key`. Posts are limited to 120 an hour per IP (salted, daily-rotating hash) and must be inside Australia.
- Deploy the server: `cd server && npm install && npm run deploy` (needs `wrangler login`). Live at https://pothole-reporter.drivemate-app.workers.dev
- A copy of the app opened from `localhost` talks to `wrangler dev` on port 8787 instead, so testing doesn't touch the live map.

## Notes

- Road names come from OpenStreetMap (Nominatim). Reports are kept on the phone until you mark them as sent.
- VicRoads reports go to enquiries@roads.vic.gov.au.
- Each local-road pothole goes to the council for that spot, found from OpenStreetMap council boundaries (Overpass API), with built-in Melton and Moorabool town lists as a fallback. Reports from different councils on one trip get their own email button.
- Moorabool's email (info@moorabool.vic.gov.au) is built in. For other councils, add the email once in "Your details" and it's remembered.
- Roads with a Victorian M, A, B or C route number go to VicRoads. In Melton, the council's published list of VicRoads-controlled roads is also used.
