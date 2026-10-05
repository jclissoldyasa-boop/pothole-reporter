# Pothole Reporter

One tap logs a pothole's GPS location, road, travel direction and time, sorts it to VicRoads or the council for that spot (e.g. Melton, Moorabool), and opens a filled-in email to send.

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
- VicRoads reports go to enquiries@roads.vic.gov.au.
- Each local-road pothole goes to the council for that spot, found from OpenStreetMap council boundaries (Overpass API). Reports from different councils on one trip get their own email button.
- Moorabool's email (info@moorabool.vic.gov.au) is built in. For other councils, add the email once in "Your details" and it's remembered.
- Roads with a Victorian M, A, B or C route number go to VicRoads. In Melton, the council's published list of VicRoads-controlled roads is also used.
