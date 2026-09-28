# USFS Photo Collector — Architecture

**Document date:** 2026-09-10, updated 2026-09-28 · reflects service-worker cache `v1.16`, iOS marketing version 1.1, build 12 committed 2026-09-27 (not yet archived/uploaded when this was written).

This is the deep-dive technical reference. Companion documents:
- [README.md](README.md) — feature overview and function index (partially stale; this document supersedes it where they disagree)
- [WEB_TO_TESTFLIGHT_PLAYBOOK.md](WEB_TO_TESTFLIGHT_PLAYBOOK.md) — the iOS build/upload pipeline
- [AZURE_DEPLOYMENT_PLAYBOOK.md](AZURE_DEPLOYMENT_PLAYBOOK.md) — the web hosting pipeline
- [Status.md](Status.md) — current deployment status

---

## 1. What this is

A field data-collection app for U.S. Forest Service environmental audits, used by HGS Engineering auditors. An auditor walks a facility, and for each finding captures: forest + location (GPS-assisted), protocol area, Team Guide citation, score, description, coordinates, and photos. Everything persists on-device with zero connectivity; at the end of the day the auditor exports a ZIP containing renamed photos, a CSV, and a styled Excel findings report, delivered through the iOS share sheet.

Forked from the DLA Audit Photo Tool. All on-device keys are prefixed `usfs_` so both apps can coexist on one device without data collisions.

### Sibling apps and the fork contract

This app belongs to a family of HGS field apps:

| App | Relationship | Location |
|---|---|---|
| DLA Audit Photo Tool | Parent — this app was forked from it | its own repo |
| NPS Audit Photo Collector | Child — forked from this app (Sept 2026) for National Park Service audits: NPS park locations instead of forests, Finding/Observation scoring, and its own audit questions | `~/Desktop/Claude Apps/NPS Audit Tool` |
| HGS LOTO field app | Related, not a fork — the durable photo-storage fix (§7) was built there first, after a photo-loss incident, then applied here | its own repo |

The siblings are deliberately **separate forks, not one multi-client app**. A single app that asked "which client?" was considered and rejected: client-specific differences reach well beyond locations (scoring, report sorting, branding, export names), shared storage would make every export/delete/integrity path client-aware, and a regression in shared code could break every client at once, including this one while it's in field use.

The cost of forking is **fix drift** — a bug fixed in one sibling must be ported to the others by hand. The contract that keeps that cheap:
- Every sibling uses its own storage prefix (`usfs_`, `nps_`, …) for localStorage keys, the IndexedDB name, the filesystem photo directory, and the SW cache name, so siblings coexist on one device.
- Code outside each sibling's client-specific sections stays **textually identical** — no reformatting, renaming, or restructuring of shared code — so a fix ports as a clean copy-paste.
- Bugs found in one sibling should be checked in the others. The September 2026 fixes (§5, §10, §11) were found by a code review of the NPS app, and most existed here unchanged.

## 2. System context

```
┌────────────────────────────┐        push to main        ┌──────────────────────────┐
│  Repo (GitHub whittw1/     │ ─────────────────────────▶ │  GitHub Actions →        │
│  USFS-Photo-Tool, main)    │                            │  Azure Static Web Apps   │
└────────────┬───────────────┘                            │  (public URL, PWA)       │
             │  npm run sync                              └────────────┬─────────────┘
             ▼                                                         │ first load caches app
┌────────────────────────────┐   Xcode archive + upload   ┌────────────▼─────────────┐
│  www/ → ios/App/App/public │ ─────────────────────────▶ │  Field devices           │
│  (Capacitor iOS shell)     │        TestFlight          │  (iPad/iPhone: native    │
└────────────────────────────┘                            │  app; browser: PWA)      │
                                                          └──────────────────────────┘
```

Two delivery channels share one codebase:

1. **Web PWA** — live at https://salmon-mud-07f7aa310.7.azurestaticapps.net (Azure Static Web Apps, resource `usfs-data-collector`). Auto-deploys on every push to `main` via `.github/workflows/azure-static-web-apps.yml`. Works fully offline after first load via the service worker.
2. **Native iOS** — the same files wrapped in a Capacitor 8 WKWebView shell, distributed through TestFlight as **"USFS Photos"** (`com.hgsengineering.usfsphotocollector`). The native channel additionally gets durable filesystem photo storage (§7) and the native share sheet. It loads the app's files from its own bundle rather than through a service worker (§12).

There is **no backend, no server, no authentication, and no telemetry**. Every byte of user data lives on the device until the user exports it. The Azure URL is public; the app makes no third-party requests at all — only same-origin fetches for its own files (including the vendored libraries, §4).

## 3. Repository layout

| Path | Role |
|---|---|
| `index.html` | **The entire application** — all HTML, CSS, and JavaScript (~4,000 lines). No build step, no framework, no modules. |
| `sw.js` | Service worker: offline caching + update discipline (§12). |
| `manifest.json` | PWA manifest (`display: browser`, green theme `#2e7d32`). |
| `team_guide_citations.json` | 6,445 searchable citations (~federal US + FS + 7 state supplements). Array of `{c, s, d, r}` (§9). |
| `forest_locations.json` | 112 forests → 32,354 named GPS locations. `{ "Forest Name": [{n, t, d, lat, lng}, …] }` (§8). |
| `build_citations.js` | Node script that regenerates the citations JSON from Team Guide markdown files (§14.1). |
| `build_locations.js` | Node script that regenerates forest locations from USFS ArcGIS exports (§14.2). |
| `package.json` | Capacitor deps + the `build` / `sync` / `open` scripts. `@capacitor/filesystem` is the only plugin beyond core. |
| `capacitor.config.json` | Bundle id, app name "USFS Photos", `webDir: www`. |
| `www/` | Build output — a copy of the static files, what Capacitor bundles. Regenerated by `npm run build`; never edit directly. |
| `ios/` | Capacitor-generated Xcode project. Version/build numbers live in `ios/App/App.xcodeproj/project.pbxproj` (both Debug and Release configs). |
| `staticwebapp.config.json` | Azure routes/headers — cache-control per file (§13). |
| `privacy.html` | Privacy policy page required for App Store review. |
| `vendor/` | Bundled JSZip + ExcelJS, with `README.md` (versions, sources, SRI hashes) and license files (§4). |
| `.claude/launch.json` | Local dev-server config for Claude Code's browser preview (`python3 -m http.server 8080`). |
| `Forest Service App Location Description and Totals.docx`, `Team Guide Cheat Sheet.docx` | Source documents (the cheat sheet feeds the hardcoded `COMMON_CITATIONS` list). |

## 4. Application structure inside index.html

One `<script>` block, organized into banner-commented sections in this order:

1. **Constants** — photo slots, defaults, all storage keys
2. **State** — module-level `let` variables (no state library)
3. **Init** — `init()`, called at the bottom of the script on parse
4. **Region/Forest data** — `REGION_MAP`, `loadForestData()`, R9 score visibility
5. **Location list** — picker modal, haversine, GPS auto-suggest, `.txt` import
6. **Dynamic photo slots** — add/remove/renumber Photos 3+
7. **Score buttons** — `toggleScore()`, `setScoreButtons()`
8. **Save & New / Clear / Saved panel / Edit** — entry CRUD
9. **Photo handling** — capture/browse inputs, resize pipeline, IndexedDB layer
10. **Durable photo storage** — Capacitor Filesystem layer, migration, integrity (§7)
11. **Photo settings** — resolution/quality dialog
12. **Export** — dialog, date filter, ZIP/CSV/XLSX build, integrity guard, post-export delete (§11)
13. **Backup/Import** — metadata-only JSON
14. **Geolocation** — `captureGPS()`, display, accuracy coloring
15. **Team Guide citation search** — synonyms, hints, chips, recents (§9)
16. **Common Citations** — cheat-sheet quick-pick modal
17. **Persistence** — autosave, `saveAll()`/`loadAll()`, storage monitor
18. **Utilities** — CSV quoting, datestamp, `shareOrDownload()`, toast, overflow menu

All UI event wiring is inline `onclick`/`oninput`/`onchange` attributes plus two document-level click listeners (close citation results, close overflow menu). All rendering is string-built `innerHTML`; user text is escaped through `esc()` (a div-textContent round-trip) before interpolation.

### External dependencies (exactly two, both pinned, both vendored)

| Library | Version | Source | Used for |
|---|---|---|---|
| JSZip | 3.10.1 | `vendor/jszip.min.js` | Building the export ZIP |
| ExcelJS | 4.4.0 | `vendor/exceljs.min.js` | The styled two-sheet XLSX (SheetJS was replaced in mid-2026 because its community edition cannot style cells) |

Both are **bundled with the app** in `vendor/` (since 2026-09-27; they previously loaded from cdnjs). That matters most on iOS: the iOS app has no service worker (§12), so CDN scripts were only available offline while the web view's ordinary HTTP cache happened to hold them — an iPad exporting with no signal could fail. Now the iOS build ships them inside the app bundle (package.json's `build` script copies `vendor/*.js` into `www/vendor/`), and the web's service worker precaches the same local files. `vendor/README.md` records the exact versions, sources, SRI hashes, and licenses (both MIT); to upgrade, replace the file, re-verify the hash, and bump `CACHE_NAME`. `runExport()` still guards against either library failing to load, with "Export library didn't load — restart the app and try again".

### Design system

Light theme only, defined as CSS custom properties on `:root`: background `#f4f6fa`, cards `#ffffff`, **FS green accent `#2e7d32`** (also the header gradient `#1b5e20 → #2e7d32 → #43a047` and the XLSX header fill), danger `#dc2626`, success `#16a34a`, warning `#ca8a04`, 12px radius. Matches the HGS Portal house style with the green swapped in. One breakpoint at 640px collapses the header buttons into an overflow (⋯) menu. Safe-area insets are respected top (header) and bottom (fixed bottom bar).

## 5. State model

Module-level variables (the entire runtime state):

| Variable | Type | Meaning |
|---|---|---|
| `savedEntries` | array | All saved entries (persisted to `usfs_saved`) |
| `currentPhotos` | object | Draft entry's photos, keyed by slot id |
| `currentEntryId` | string | Draft entry id, `e_<epoch-ms>_<4 base36 chars>` from `genId()` |
| `currentGPS` | object\|null | `{latitude, longitude, accuracy}` |
| `editingIndex` | number\|null | Index into `savedEntries` while editing; null = new-entry mode |
| `extraPhotoSlots` | array | Slot ids `p_extra_0…` currently in the DOM |
| `siteList` | array | Location names for the picker (forest-derived or imported) |
| `forestData` | object | Parsed `forest_locations.json` |
| `selectedForest` | string | Persisted to `usfs_selected_forest` |
| `locationRadius` | 'nearby'\|'all' | Picker radius toggle (10 mi) |
| `tgCitations` / `tgLoaded` / `tgRecent` / `tgAreaFilter` | — | Citation search state |
| `idbAvailable` | bool | Set false the moment any IndexedDB operation fails |
| `photoDB` | IDBDatabase | Cached open handle |
| `exportDateMode` | string | 'all' \| 'today' \| 'yesterday' \| 'custom' |
| `_lastExportedIds` | array | Ids offered for post-export deletion |

### The entry object

```js
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Eagle Creek Campground — Heppner Ranger District",  // duplicate of location (legacy)
  location:          "Eagle Creek Campground — Heppner Ranger District",
  protocolArea:      "Water Quality",              // one of 18 dropdown values ('' allowed)
  teamGuideCitation: "WQ.10.1.US — 40 CFR ...",    // "CODE — regulation" or bare code or ''
  score:             "Finding",                     // REQUIRED to save (validated)
  details:           "Observed sediment discharge…",
  latitude:  40.7341, longitude: -122.9418,        // null when no GPS
  gpsAccuracy: 8.5,                                 // meters, null when no GPS
  timestamp: "2026-09-10T14:30:00.000Z",           // creation time; preserved across edits
  exportedAt: "2026-09-10T18:02:11.000Z",          // stamped by runExport(); absent = never exported
  photos: {
    p_main:    { timestamp, thumbnail, fileType: 'image/jpeg', dbKey, unsaved? },
    p_wide:    { … },
    p_extra_0: { … }
  }
}
```

Key details:
- `photos[slot].thumbnail` is an **inline base64 data URL** (~80 px wide, JPEG q=0.4) stored *inside the entry in localStorage* — it's what the saved list and slot previews render without touching the photo stores.
- `photos[slot].dbKey` is the pointer to the full-resolution bytes: `photoDBKey(entryId, slotId)` = entryId with non-alphanumerics replaced by `_`, then `__`, then the slot id, e.g. `e_1711234567890_a1b2__p_main`. The same key addresses all three storage tiers. **Exception — photos taken while editing** get a unique suffix (`…__p_main_<base36 time>`) so a retake never overwrites the saved entry's photo: **Save Edit** deletes the replaced/removed old photos, **Cancel** deletes the discarded retakes (`discardDraftPhotos()`). Save Edit never trades a good original for nothing: while any capture is still being read or written (`photoCaptureBusy()`, §10) it refuses with "A photo is still being saved — tap Save again in a moment", and a retake whose write failed (`unsaved === true`) is dropped in favour of the original photo for that slot, with a message saying so. Any code that deletes photo bytes must first check `photoKeyInSavedEntries()`.
- Extra slot ids are `p_extra_<next unused index>` — never the slot count, which collides after a middle slot is removed.
- `photos[slot].unsaved === true` means the durable write **failed verification** at capture time (§7).
- **Score is mandatory**: `saveEntryAndNew()` and `saveEdit()` both refuse with a toast until a score button is selected.
- **Saves are confirmed**: `saveAll()` returns false when localStorage is full; Save & New then rolls the entry back out of memory and Save Edit restores the previous version, both keeping the form intact and showing an alert — the app never shows "✔ Saved" for data that didn't persist.
- **Edit mode tracks its entry by object, not position**: `editingIndex` is recomputed after any deletion (`deleteEntry`, post-export delete), and deleting the entry being edited exits edit mode. Edit mode also survives a reload: the draft's `currentEntryId` only matches a saved entry's id while that entry is being edited, so `loadAll()` resumes edit mode when it finds a match (otherwise Save & New would create a duplicate with the same id and photo keys).
- Scores: `Finding` and `General` always; `Safety`, `Observation`, `Positive`, `Corrected On Site` are **Region 9-only** buttons, shown by `updateScoreVisibility()` only when the selected region starts with `R09` *and* a forest is chosen. De-selecting R9 clears any hidden R9 score already picked.

### Complete on-device key inventory

| Store | Key | Contents |
|---|---|---|
| localStorage | `usfs_saved` | JSON array of all saved entries (incl. thumbnails) |
| localStorage | `usfs_current` | Autosaved draft: form fields + `currentPhotos` + slot list + GPS + entry id |
| localStorage | `usfs_photo_settings` | `{maxWidth, maxHeight, quality, preset}` |
| localStorage | `usfs_site_list` | Imported `.txt` location list (fallback when no forest selected) |
| localStorage | `usfs_selected_forest` | Forest name, restored on launch |
| localStorage | `usfs_recent_tg` | Last 10 selected citation codes, most recent first |
| localStorage | `photo_full_<dbKey>` | **Fallback-only** full-res photo as data URL (§7 tier 3) |
| IndexedDB | db `usfs_photos_v1`, store `photos` | `{data: ArrayBuffer, type, size}` keyed by dbKey |
| Native FS | `DATA/usfs_photos/<sanitized dbKey>.jpg` | Durable full-res JPEG (native app only) |
| SW Cache | `usfs-collector-v1.16` | App shell + manifest + data JSON + the two vendored libraries (web only — see §12) |
| localStorage | `usfs_saved_damaged_<epoch>` | Only present if a damaged saved-entry list was set aside on load (§6) |

`autoSaveCurrent()` runs on effectively every input event, so a mid-entry app kill (including iOS killing the WebView while the camera is open — a real iOS behavior) restores the full draft, thumbnails included, on next launch.

## 6. Startup sequence (`init()`)

1. Generate a fresh `currentEntryId`.
2. Open IndexedDB and run a **write→read→delete probe** with a 4-byte test record; any failure flips `idbAvailable = false` for the session.
3. `loadAll()` — restore saved entries and the autosaved draft (form fields, GPS, thumbnails, extra photo slots rebuilt into the DOM). Saved entries are validated: non-object elements are dropped and `repairEntry()` coerces the fields the UI formats (coordinates to numbers or null, text fields to strings, `photos` to an object), so one bad value can't crash startup. If the list is unreadable (bad JSON, or not an array), the raw text is copied to `usfs_saved_damaged_<epoch>` before anything can overwrite it, and the user gets an alert. Imported backups go through the same `repairEntry()` via `normaliseEntry()`.
4. Render saved panel, header badge, storage bar; queue the previous-day reminder toast (fires at 1.5 s if any entry's timestamp is from an earlier calendar day).
5. `navigator.storage.persist()` — ask the browser/WebView not to evict our origin's storage (best-effort, wrapped in try/catch).
6. `migratePhotosToFS()` → then `runIntegrityCheck(false)` (§7).
7. `loadForestData()` — fetch `forest_locations.json`, populate the Region/Forest dropdowns, restore the persisted forest selection, apply R9 score-button visibility.
8. If no forest is stored, fall back to the imported `.txt` site list.
9. **Same-day location carry-over**: if the location field is empty, prefill it from the most recent entry saved *today* (auditors save many entries at one site).

Independently of `init()`, the script's top level kicks off `loadCitations()` and `loadRecentTg()` for the citation search.

## 7. Photo storage — the three-tier durable design

**Why this exists:** iOS can silently evict WKWebView storage (IndexedDB *and* localStorage) under disk pressure — a sibling HGS app lost a day of field photos this way. Since August 2026 (build 11), full-resolution photos on the native app are written to a **real file** in the app's DATA container via `@capacitor/filesystem`, which iOS does not evict. The web/PWA build (no native bridge) continues to rely on IndexedDB.

### Write path — `storePhotoBytes(dbKey, dataUrl)` → `{ok, where}`

Tries tiers in order, **verifying each write before claiming success**:

1. **Native filesystem** (`where:'fs'`): `Filesystem.writeFile` to `usfs_photos/<key>.jpg` in `DATA`, then `Filesystem.stat` to confirm the file exists with size > 0. Only attempted when `window.Capacitor.isNativePlatform()` is true and the plugin is present (`fsPlugin()` returns null otherwise, making every fs helper a no-op on the web).
2. **IndexedDB** (`where:'idb'`): put `{data: ArrayBuffer, type, size}`; an exception flips `idbAvailable = false`.
3. **localStorage** (`where:'fallback'`): the data URL under `photo_full_<key>` — last resort only, tiny quota, itself evictable. Read back to confirm.
4. Nothing stuck → `{ok:false, where:'none'}`.

### Capture-time verification (`handlePhoto`)

The photo slot shows an amber `…` badge while the write is in flight. On `{ok:true}` it becomes the green ✓ badge and a toast reports the size; on failure the badge becomes a red **⚠ NOT SAVED**, `photos[slot].unsaved = true`, and a warning toast says "Export & clear now". Nothing fails silently.

### Read path — `loadPhotoBytes(dbKey)`

Filesystem → IndexedDB → localStorage fallback, first hit wins, returning `{bytes: Uint8Array, type}`. `photoBytesExist()` is the same walk returning a boolean. Used by export and the integrity check.

### Migration — `migratePhotosToFS()` (once per launch, native only)

Lists all IndexedDB keys, lists the filesystem directory (`fsPresentKeySet()`), and copies every IDB-only photo to the filesystem (base64-encoded in 32 KB chunks — `uint8ToBase64` avoids the `String.fromCharCode.apply` stack overflow above ~100 KB). Shows "Secured N photos to durable storage" if it moved anything. IDB copies are left in place as redundancy.

### Reconnecting after WebKit drops the database

WebKit closes IndexedDB connections — after the app sits in the background, or when its storage process restarts — and every transaction on the old handle then fails. Every IndexedDB operation (`openPhotoDB`, `savePhotoToDB`, `getPhotoFromDB`, `deletePhotoFromDB`, `getAllPhotoKeys`, `estimateIDBSize`) goes through `withPhotoDB()`, which on a dropped-connection error (`lostPhotoDB()`) forgets the dead handle (`forgetPhotoDB()`) and retries once on a fresh one; `openPhotoDB()` also clears the cached handle on `onclose`/`onversionchange`. Without this (before 2026-09-28), every stored photo read as missing and new photos fell to the localStorage fallback until the page was reloaded. This block is ported verbatim from the NPS sibling and must stay textually identical to it.

### Deletion

`deletePhotoFromDB(key)` removes **all three tiers** (localStorage fallback, filesystem, IndexedDB — its promise resolves only once the filesystem and IndexedDB copies are both gone), and works even when IndexedDB is unavailable. Callers:
- single-entry delete (which previously orphaned photo bytes — fixed in build 11) and post-export batch delete;
- Save Edit, for the photos the edit replaced or removed;
- `discardDraftPhotos()` — Cancel Edit, loading another entry over an unsaved draft, and deleting the entry being edited;
- a successful retake, for the slot's previous draft photo;
- a capture whose form was cleared before its write finished.

Every caller except entry deletion first checks `photoKeyInSavedEntries()`, so a photo still referenced by a saved entry is never removed.

### Integrity badge

`runIntegrityCheck()` diffs the set of dbKeys referenced by entries + draft against the union of keys present in all three tiers (`presentPhotoKeySet()`). The header badge shows green "✓ N photos safe" or red "⚠ X of N photos MISSING"; tapping it re-checks and, in verbose mode, alerts with the affected entry locations and points the user at earlier exports for recovery. `updateIntegrityBadge()` debounces re-checks 500 ms after any photo mutation.

## 8. Location system

Three sources feed the location field, in priority order:

1. **Bundled forest data** (`forest_locations.json`): `{ "Forest Name": [ {n: name, t: type, d: district, lat, lng} ] }` — 112 forests, 32,354 locations (offices + recreation sites). Selecting a forest maps them to display strings `"Name — District"` and enables the GPS features.
2. **Imported `.txt` list** (`usfs_site_list`): one location per line, `#` comments, used only when no forest is selected.
3. **Free typing** — the field is a plain text input; anything goes.

Static data in code: `REGION_MAP` (9 USFS regions → forest names; R07 doesn't exist, matching reality) and the derived reverse lookup `FOREST_TO_REGION`. The Region dropdown filters the Forest dropdown; both selections persist.

GPS-powered behaviors (all use `haversineMi()`, earth radius 3958.8 mi):

- **Picker sorting**: with a fix, the location picker sorts by distance and shows a per-row distance chip; the **Nearby (10 mi) / All** toggle filters (Nearby silently falls back to All when nothing is within radius).
- **Auto-detect forest** (`autoDetectForest`): if no forest is selected when a fix arrives, scan *every* location in every forest for the nearest one; adopt that forest (and its region) when < 100 mi.
- **Auto-suggest location** (`autoSuggestLocation`): if the location field is empty, fill it with the nearest location in the selected forest when < 50 mi, with a toast showing the distance.

## 9. Team Guide citation search

**Data:** `team_guide_citations.json` — 6,445 records of `{c: code, s: section label, d: description, r: regulatory reference}`. Codes are `AREA.question.sub.JURISDICTION` (e.g. `HW.10.1.US`, `PM.1.1.FS`, `AE.10.1.MI`); jurisdictions are `US` (federal, Dec 2023), `FS` (Forest Service supplement, Sep 2008), and state supplements `KY MI MN MO OR TN WA`. Loaded lazily on startup; `loadCitations()` returns whether the index is loaded, and rejects non-OK or non-array responses. If a search runs before the data is available, it makes **one** fetch attempt per search and, on failure, says the citations couldn't load and to connect once — it never retries in a loop (it used to, at hundreds of fetches per second while offline).

**Search algorithm** (`_filterCitations`, debounced 150 ms):

1. Empty/1-char query → show the sticky **area chip row** plus either the active area's first 50 citations, or the **Recent picks** list (last 10 selected codes from `usfs_recent_tg`), or a hint.
2. Query terms are split on whitespace; each term expands through `TG_SYNONYM_MAP` (~33 groups of field vocabulary — "msds"→"safety data sheet", the many "burn pile" variants, "ust"→"underground storage tank", etc.). Multi-word phrase keys match against the whole query.
3. Every term (in some synonym variant) must appear in the citation's concatenated haystack (`c + s + d + r`, lowercased). Scoring per hit: +10 if the variant appears in the code, +5 if in the regulation reference, +2 for the exact typed term / +1 for a synonym.
4. **Protocol-area hints** (`TG_PROTOCOL_HINTS`, ~100 regex→area→bonus rules ported from fs-reference-web's `field_notes.py`) add area-level bonuses — e.g. a query matching `/refrigerant/` boosts every `AE.*` citation by 15.
5. **Question hints** (`TG_QUESTION_HINTS`) boost specific question ids hard — e.g. "large capacity septic" +30 on `WQ.114.3` (also matched with the `.US`/`.FS` suffix stripped).
6. Active area chip filters to that code prefix. Top 30 by score render with `<mark>` highlighting of every matched variant (`_highlight` escapes regex chars, longest-first to protect longer matches).

Selecting a citation writes `"CODE — regulation"` (or bare code) into the hidden `teamGuideCitation` input, renders the green summary card, and pushes the code onto the recents list (capped at 10, persisted).

**Common Citations** (★ Common) is a separate hardcoded cheat-sheet modal (`COMMON_CITATIONS`, sourced from `Team Guide Cheat Sheet.docx`) of ~17 high-frequency codes grouped by category, filtered by the selected Protocol Area through `PROTOCOL_TO_CATEGORIES`; picking one routes through the normal `selectCitation` path when the code exists in the full index.

## 10. Photo capture pipeline

1. **Camera** (`takePhoto`): the `<input type=file accept=image/* capture=environment>` is **destroyed and recreated on every tap** — iOS caches a stale file on reused inputs. **Library** (`browsePhoto`): same input without `capture`, which makes iOS open the photo picker instead.
2. `handlePhoto` reads the file as a data URL, draws it into a canvas scaled to fit the configured max box (default 1920×1080; presets 1280×720 / 2560×1440 / custom / original-no-resize), re-encodes JPEG at the configured quality (default 0.80). Settings persist in `usfs_photo_settings`; the settings dialog shows a rough size estimate (`w·h·q·0.00015` KB, clamped 50 KB–3 MB).
3. A second canvas produces the ~80 px thumbnail (JPEG q=0.4) stored inline in the entry.
4. Bytes go through the verified durable-write path (§7); the slot badge reflects the outcome.
5. **GPS auto-capture**: if the draft has no fix yet, a silent `captureGPS(true)` fires with each photo (high accuracy, 15 s timeout, no error UI in silent mode).
6. **Capture registry**: `photoCaptureStarted(key)` / `photoCaptureDone(key)` track every photo still being read, resized or written (cleared on every exit, including unreadable files via `img.onerror`/`reader.onerror`); `photoCaptureBusy()` is what Save Edit checks. Entries older than 30 s are ignored, so a capture that died can never block saving for good. Ported verbatim from NPS.
7. **Save & New during processing**: if the form moves to another entry before the image has decoded, the photo is dropped with a "retake it" warning rather than landing in the wrong entry. If the entry is saved while the bytes are still being written, the write finishes against the photo record the entry already holds (its `unsaved` flag is updated and re-persisted), and the new blank form is left untouched. A photo whose form was cleared (not saved) mid-write has its bytes deleted.

Photos 1–2 are fixed slots (`p_main`, `p_wide`); "Add Photo" appends `p_extra_N` slots, removable and renumbered live; edit mode and draft-restore both rebuild extra slots from data.

Note: going through `<input type=file>` means **iOS strips EXIF and re-encodes** — GPS lives in the entry record, not the image file, by design.

## 11. Export pipeline (`runExport`)

**Dialog:** shows the naming preview, a date filter (chips All / Today / Yesterday / Custom with two date inputs, defaulting to today), and a live count "N entries will be exported" / "M of N match this filter".

**The unsaved-draft rule (`draftIsNewEntry()`):** the form counts as an extra entry only when it is *not* in edit mode and has a description, citation, score, or photo. A location alone doesn't count — Save & New deliberately keeps the location filled in, and counting it used to put a blank phantom row in every export. Protocol Area is excluded for the same reason: `clearEntryForm()` carries it over to the next entry too. While editing, the form is an existing saved entry, so the export uses its saved version. The same rule drives export, the export count and preview, backups, and the "unsaved data will be lost" prompt in `editEntry()`.

**Selection:** deep-clone `savedEntries`, append the draft (with its live form values) if `draftIsNewEntry()`, then filter by the date range (`entryInRange` on `timestamp`; open-ended bounds allowed). Empty result → abort with a toast.

**Photo naming:** one **global 4-digit sequence** across the whole export (`0001…`), ordered by entry, then slot (`p_main`, `p_wide`, extras by index). Name = `MMDDYY_District_Location_NNNN` where the location string is split on any of `-> → > – — | /` and the **last two segments** are kept (district + site), each sanitized to `[a-zA-Z0-9_- ]`, spaces→underscores. Extension is `.jpg` unless the stored MIME says PNG.

**ZIP contents** (`USFS_Export_MMDDYY.zip`, via JSZip):

```
photos/MMDDYY_District_Location_0001.jpg …
USFS_Report_MMDDYY.xlsx
USFS_Data_MMDDYY.csv
```

**CSV** — columns: `Entry #, Location, Latitude, Longitude, GPS Accuracy (m), Protocol Area, Team Guide Citation, Score, Description, Timestamp, Photo 1…Photo N` (N = max photos on any entry, min 2). Coordinates fixed to 6 decimals; `quote()` handles commas/quotes/newlines.

**XLSX** (ExcelJS, two sheets):

- **Sheet 1 "Findings Report"** (opens first, styled): columns `Location(36) | Condition(60) | Score(12) | FindingDate(13) | Question(16) | Photos(18)`. Rows sorted: citation-bearing entries first (alphanumeric by code), then citationless non-General findings, then General/blank — original order as tiebreak. `Question` = the citation code before " — ", else the protocol area's 2-letter code (`AREA_CODE` map), else "—". `Photos` = the entry's photo sequence numbers as **3-digit** collapsed ranges (`001–003, 005`) — intentionally 3-digit vs the 4-digit filenames; flip the `padStart(3,…)` in `formatPhotoNumbers` if that ever changes. Styling: bold white-on-green (`FF2E7D32`) 28 px header, frozen first row, gridlines off, Arial 10, thin `FFC8CDD9` borders everywhere, Condition left/others centered, wrap text, row heights estimated from character counts (~55 chars/line Condition, ~32 Location, 15 px/line + 6).
- **Sheet 2 "USFS Entries"** (raw): the same columns as the CSV; `Entry #`, GPS columns, and all photo columns **hidden** by default so reviewers see a clean sheet but the data is still there.

**Integrity guard:** every missing photo (all three storage tiers empty for a referenced dbKey) is counted during the ZIP build; if any are missing, a `confirm()` names the affected entries and forces an explicit choice between "export anyway (incomplete)" and cancel. A short export can never ship silently.

**Delivery:** `shareOrDownload()` — Web Share API with a `File` (native share sheet on iOS; the user typically AirDrops or saves to Files), falling back to an `<a download>` blob click in desktop browsers. It returns **false when the user cancels the share sheet** (`AbortError`); `runExport()` then stops with "Export cancelled — nothing marked as exported", so nothing is stamped as exported or offered for deletion. `saveBackup()` handles cancel the same way. (A download in a desktop browser can't be confirmed, so that path counts as delivered.)

**After a successful export:**
1. Every exported entry in `savedEntries` is stamped `exportedAt` (the clones exported are matched back by id). The saved list renders a green "✓ exported" or amber "⚠ not exported" badge per entry, and single-entry delete confirms with the entry's export status ("NO export record — this entry may never have left the device!").
2. The post-export dialog offers to **batch-delete the exported entries** (photos included, all tiers); it exits edit mode/clears the draft if those were part of the export. "Keep on device" declines.
3. Photo bytes (including `photo_full_*` localStorage fallback copies) are removed only when their entries are deleted — through the post-export prompt or a single delete — via `deletePhotoFromDB()`, which clears all three tiers even when IndexedDB is unavailable. (Exports used to purge *every* fallback copy, including photos of entries outside the date filter or kept on the device.)

## 12. Service worker (`sw.js`)

Small but load-bearing — it has caused more field bugs than any other file.

- `CACHE_NAME = 'usfs-collector-v1.16'` — **must be bumped whenever any cached file changes** (`index.html`, `sw.js` itself, `manifest.json`, either data JSON, the `vendor/` libraries). The bump is what makes installed web/PWA copies pick up changes.
- **The service worker is web-only.** The iOS app loads its files from Capacitor's `capacitor://localhost` scheme and has no App-Bound Domains configured, and iOS web views only run service workers for app-bound http(s) domains — so in the iOS app `register()` fails silently (its promise is caught) and the app always runs the files in its bundle. iOS picks up changes only through a new TestFlight build, and SW caching problems can't affect it. (WEB_TO_TESTFLIGHT_PLAYBOOK.md describes a SW serving stale files inside the iOS app; given the above, that was most likely a web-channel symptom.)
- Precache list: `./`, `index.html`, `manifest.json`, both data JSONs, `vendor/jszip.min.js`, `vendor/exceljs.min.js`.
- **Install:** `cache.addAll` with every request created as `new Request(url, {cache:'reload'})`. The `reload` is critical: without it the SW install reads through the **browser HTTP cache**, and a stale `max-age` copy of the data JSON gets baked into the brand-new SW cache — this exact bug shipped day-old citation data in July 2026 despite a cache bump. `skipWaiting()` activates immediately.
- **Activate:** delete every cache whose name ≠ current, then `clients.claim()`.
- **Fetch:** requests that are navigations or end in `.html`, `/`, or `.json` are **network-first** — fetched with `{cache:'no-cache'}` (forces conditional revalidation, cheap ETag 304s) — with the response copied into the cache and the cache as offline fallback. Only `ok`, non-redirected responses are cached; an error page or redirect never replaces a good cached copy — the cached copy is served instead. (The realistic trigger is a transient 404/5xx, e.g. mid-deploy. A Wi-Fi login portal mostly can't impersonate the app because the site is HTTPS — the interception fails TLS and the fetch falls back to the cache anyway.) Everything else (the vendored libraries) is cache-first.

The Azure config (§13) is the server half of the same fix: the data JSONs are served `public, no-cache` so the client always revalidates; `sw.js`, `index.html`, and `manifest.json` are `no-cache, no-store, must-revalidate`.

## 13. Hosting and deployment

**Web:** push to `main` → GitHub Actions (`azure-static-web-apps.yml`) → Azure Static Web Apps (`usfs-data-collector`, ~1 min deploys). **There is no staging environment: every push to `main` is a production deploy** to the URL field auditors use, so test locally first. To verify a deploy: `gh run list --limit 1` shows the Actions run, then diff the live files against the repo (`curl -s <site>/index.html | diff -q - index.html`, same for `sw.js`) and confirm the live `CACHE_NAME`. `staticwebapp.config.json` additionally sets a navigation fallback to `index.html` (excluding JSON and images), JSON MIME types, and security headers (nosniff, DENY framing, strict referrer). No auth is configured; adding Entra ID in front of the URL is a discussed-but-not-done option.

**iOS:** `npm run sync` (copies the file list in package.json's `build` script into `www/`, then `npx cap sync ios` into `ios/App/App/public/`) → bump `CURRENT_PROJECT_VERSION` in **both** Debug and Release blocks of `project.pbxproj` (Apple rejects reused build numbers; `MARKETING_VERSION` is user-facing and bumped rarely) → `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination generic/platform=iOS archive -allowProvisioningUpdates`, then `xcodebuild -exportArchive` with an ExportOptions plist of `method: app-store-connect`, `destination: upload`, `signingStyle: automatic`, and `manageAppVersionAndBuildNumber: false` (so Xcode never renumbers the build behind the version policy) — or the Xcode GUI: Product → Archive → Distribute. "Upload succeeded" means App Store Connect has it; TestFlight processing then takes ~10 minutes, and each new build resets TestFlight's 90-day expiry. Signing is automatic under team `QV4MJ85JSK`; `ITSAppUsesNonExemptEncryption=false` in Info.plist skips the export-compliance prompt. Info.plist carries camera/photo-library/location usage strings and references the version fields via `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — never hardcode there. Full checklist in the TestFlight playbook.

**The dual-channel skew rule:** the web app updates the moment a user reloads twice (SW update dance); the iOS app only updates when someone archives and uploads a new build (it has no service worker — §12). Between iOS builds the two channels intentionally run different versions of the same file, so a web fix is not a field fix for iPad users until the next TestFlight build ships.

## 14. Data build pipelines (developer-side, Node, no npm deps)

### 14.1 `build_citations.js`
Parses Team Guide markdown files from `~/Desktop/Claude Apps/fs-reference-web/backend/data/team_guide` (shared with the fs-reference-web project). Filenames like `usae-Dec-23`, `fspm-Sep-08`, `kyae-oct-23` encode jurisdiction (first 2 chars) + area code (rest) → the `AREA_NAMES` map produces section labels ("Air Emissions", "FS: Pesticide Management", "MI: Hazardous Waste", …). Writes `team_guide_citations.json` **and** the `www/` copy. Run `node build_citations.js` after any Team Guide update, then bump the SW cache.

### 14.2 `build_locations.js`
Consumes pre-downloaded USFS ArcGIS EDW exports: `offices_raw.json` (`EDW_FSOfficeLocations_01`) and `rec_batch_*.json` (`EDW_RecInfraRecreationSites_02`). Offices map directly to their forest; recreation sites carry no forest name, so they're grouped by 4-char `SECURITY_ID` prefix and each group is assigned to the forest of the **nearest office** to the group centroid (flat lat/lng distance — fine at this scale). Coordinates rounded to 6 decimals, entries deduped on name+rounded coords, sorted per forest; temp inputs deleted afterward. Output is the minified `forest_locations.json`.

## 15. Security & privacy posture

- All data is client-side; the app makes no network writes anywhere, and loads no third-party code at runtime (libraries are vendored and hash-verified). Exports leave the device only through the user's own share-sheet action.
- No accounts, no auth, no cookies, no analytics. The public Azure URL serves only the static app.
- XSS surface: the saved-entries list, citation search results, and the selected-citation card pass text through `esc()`. The location picker puts each name into an inline `onclick`, so names are escaped for both layers — backslashes and apostrophes for the JavaScript string, then `&` and `"` for the HTML attribute (19 real forest names contain double quotes, e.g. `DIMOND "O"`, and could not be picked before 2026-09-28). The app never renders remote content.
- The privacy policy (`privacy.html`) exists to satisfy App Store review; it accurately states data never leaves the device.

## 16. Known constraints & sharp edges (institutional memory)

1. **Wi-Fi-only iPads have no GPS hardware** — location comes from Wi-Fi BSSID lookup and is useless in the backcountry. Use cellular-SKU iPads (GNSS works without a SIM), an external Bluetooth GPS (Bad Elf/Garmin GLO — iOS treats it as the system source), or an iPhone. Tethering does *not* relay the phone's GPS.
2. **iOS storage eviction** is why the filesystem tier exists (§7). Don't "simplify" photo storage back to IDB-only.
3. **The SW cache name is the web release mechanism.** Changed a cached file? Bump `CACHE_NAME` or web/PWA users won't see it. Keep the `cache:'reload'` / `no-cache` fetch options — removing them reintroduces the stale-JSON bug. (The iOS app ignores all of this; its release mechanism is the build number.)
4. **`<input type=file>` recreation** on every camera tap is deliberate (iOS stale-file bug). So is the missing `capture` attribute on Browse.
5. **iOS re-encodes photos and strips EXIF** through file inputs; original-quality/EXIF capture would require the Capacitor Camera plugin.
6. **SheetJS community edition can't style cells** — that's why ExcelJS, despite ~950 KB minified.
7. **Version bumps are by explicit request only** (team policy) — both the iOS build number and any user-facing version.
8. **`www/` is generated** — edit root files, run `npm run sync`.
9. The 3-digit Photos column vs 4-digit filenames in the XLSX report is a deliberate user preference, not a bug.
10. Storage warnings measure the **tightest** limit: the ~5 MB localStorage entry store (entries + thumbnails, counted conservatively at 2 bytes/char — usually the one that fills first on iPads, where photos are files) or photo storage against the smaller of the 80 MB working cap and the browser's real quota. Over 50% → yellow + throttled toast (≤1/5 min); over 90% → red. Note the bottom-bar indicator element (`#storageIndicator`) has been hidden by CSS since the initial fork and is never shown — only the toasts are visible.

## 17. How to extend safely (checklist)

- There is **no automated test suite** — verification is manual, against the real code in a browser. Serve the folder locally (`python3 -m http.server 8080`, or the `.claude/launch.json` config); port 8080 is also the NPS sibling's default, so use another port if both run at once. Drive the app's own global functions from the browser console to reproduce edge cases (e.g. stub `window.confirm`, `navigator.share`, or `Storage.prototype.setItem` to simulate cancel/quota paths), and restore any stubs and test data afterward.
- Editing `index.html`/data JSON → test locally as above, **bump `CACHE_NAME`**, push to `main` (web ships to production immediately), verify the deploy (§13), and note the iOS channel stays behind until the next TestFlight build.
- Fixed a bug? Check the sibling apps for the same code (§1).
- New cached asset → add to `URLS_TO_CACHE` *and* bump the cache name *and* (if it must ship in the iOS bundle) add it to package.json's `build` copy list.
- New entry field → touch all of: the form HTML, `saveEntryAndNew()`, `saveEdit()`, `editEntry()`, `autoSaveCurrent()`/`loadAll()`, `normaliseEntry()`/`repairEntry()`, `draftHasContent()` if the field makes a draft "real", the CSV row, both XLSX sheets, and the saved-panel renderer.
- New photo behavior → preserve the verify-after-write contract, the three-tier delete, and the edit-mode key suffix; never delete a photo key without `photoKeyInSavedEntries()`.
- New code that mutates `savedEntries` while edit mode may be active → recompute `editingIndex` from the edited entry object.
- Anything touching citations/locations data → regenerate via the build scripts, never hand-edit the JSON.
