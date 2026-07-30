# USFS Photo Collector — Status

**Last updated:** 2026-07-29

## Status: ✅ Fully Functional (deployed to production, active development ongoing)

- **Web (PWA):** Live at https://salmon-mud-07f7aa310.7.azurestaticapps.net on Azure Static Web Apps, with auto-deploy on push to `main`. Works fully offline after first load via service worker (cache `usfs-collector-v1.11`).
- **iOS (TestFlight):** Wrapped with Capacitor 8 and shipped to TestFlight — currently marketing version 1.1, build 9. Includes privacy policy page required for App Store review.
- **Deployed 2026-07-29:** Export improvements (date-range filter, post-export batch delete, ExcelJS styled Findings Report) and the citation-search overhaul (area filter chips, synonym matching, ranking hints, recent picks, match highlighting) are live, along with the expanded 6,445-citation index covering KY/MI/MN/MO/OR/TN/WA state supplements. Also fixed a service-worker caching bug where stale JSON data could survive cache bumps for up to 24 hours.
- **All work committed and deployed** as of 2026-07-29: score-required validation on save is live on the web app, and the iOS-side records (app rename to "USFS Photos", encryption-compliance plist key, version 1.1/build 9, updated icon) are committed. Git matches production.

## What the App Does

USFS Photo Collector is a single-file Progressive Web App (all HTML/CSS/JS in `index.html`, no build step) for U.S. Forest Service field audit photo documentation, forked from the DLA Audit Photo Tool. Field auditors use it on a phone or iPad to log findings: each entry captures a location (picked from a bundled forest-location list with a Nearby/All GPS radius toggle), a Protocol Area, a Team Guide citation (searchable index of 6,445 citations including 7 state supplements, plus a Common Citations quick-pick filtered by protocol area, including Region 9–specific score buttons), a condition description, tap-to-select score buttons, GPS coordinates with accuracy indicators, and any number of photos (camera capture or library import, client-side compressed). Everything is stored on-device (localStorage + IndexedDB) so it works with zero connectivity in the field. When done, the auditor exports a ZIP containing consistently named photos (`MMDDYY_District_Location_NNNN.jpg`), a CSV, and a styled two-sheet Excel workbook (a formatted "Findings Report" plus a raw entries sheet, built with ExcelJS). Storage monitoring, previous-day entry reminders, and JSON backup/import round out the safety features.

## Current Capabilities

- Offline-first PWA + native iOS shell (Capacitor → TestFlight)
- Forest/district location picker with GPS-based Nearby filtering
- Team Guide citation search (6,445 citations incl. 7 state supplements) with area filter chips, synonym matching, smart ranking, recent picks, and Common Citations quick-picks
- Score buttons (with Region 9–only variants shown contextually)
- Photo capture/import with configurable compression; unlimited photo slots
- GPS auto-capture on first photo, color-coded accuracy
- ZIP export: named photos + CSV + styled XLSX Findings Report (photo-number ranges)
- Date-range export filter and post-export batch delete (live as of 2026-07-29)
- Storage usage bar with warning thresholds; JSON backup/restore
- HGS Portal light theme with FS green gradient header

## Future Plans / Ideas Discussed

- Optionally add Entra ID authentication in front of the Azure public URL
- Reuse the Azure deployment and TestFlight playbooks (both written up in this repo) for sibling apps, e.g. the DLA Audit Photo Tool
- Possible switch of the report's photo numbers from 3-digit to 4-digit padding to match filenames (noted, deliberately not done)
- Version/build bumps are only done on explicit request (team policy)
