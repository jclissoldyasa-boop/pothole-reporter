# Pothole Reporter

One tap logs a pothole's GPS location, road, travel direction and time, sorts it to VicRoads or Melton City Council, and opens a filled-in email to send.

## Put it online (GitHub Pages)

1. Create a new public repository on GitHub, e.g. `pothole-reporter`.
2. Upload every file in this folder to the repository (Add file → Upload files), then Commit.
3. Go to Settings → Pages. Under "Build and deployment", set Source to "Deploy from a branch", Branch to `main` and folder to `/ (root)`, then Save.
4. After a minute or two the address appears at the top of that page, e.g. `https://YOUR-USERNAME.github.io/pothole-reporter/`.

## Put it on your phone

1. Open that address in Chrome on your phone.
2. Tap the sign once and choose Allow when it asks for location.
3. Chrome menu (⋮) → Add to Home screen (or Install app).

## Updating

Replace the changed files in the repository. The phone picks up the new version the next time the app opens with signal.

## Notes

- Road names come from OpenStreetMap (Nominatim). Reports are kept on the phone until you mark them as sent.
- VicRoads reports go to enquiries@roads.vic.gov.au. Add your council's email in "Your details" for local-road potholes.
- The VicRoads/council sorting uses Melton City Council's published list of VicRoads-controlled roads.
