# USFS Photo Collector

A Progressive Web App (PWA) for USFS field photo documentation with GPS tracking, searchable Team Guide citation lookup, and offline support. Forked from the DLA Audit Photo Tool.

## Quick Start

1. Open the app URL on your phone/tablet
2. Tap **"Add to Home Screen"** for an app-like experience
3. The app works fully offline after the first load

## Architecture

Single-page PWA — all UI, logic, and styling in one `index.html` file with no build step. Designed for mobile field use.

```
USFS-Photo-Tool/
├── index.html                   ← Entire app (HTML + CSS + JS)
├── sw.js                        ← Service worker for offline caching
├── manifest.json                ← PWA manifest
├── team_guide_citations.json    ← 2,387 searchable Team Guide citations
├── build_citations.js           ← Node.js script to rebuild citation index from MD files
```

### Storage

| Layer | Purpose | Key Prefix |
|-------|---------|------------|
| localStorage | Entry metadata, thumbnails, location list, settings, auto-save | `usfs_*` |
| IndexedDB (`usfs_photos_v1`) | Full-resolution photo binary data | `entryId__slotId` |
| Service Worker cache (`usfs-collector-v1.1`) | App shell + citation JSON for offline use | — |

Unique `usfs_*` keys prevent collision with the DLA app if both are used on the same device.

### External Dependencies (CDN)

- **JSZip 3.10.1** — ZIP file creation for export
- **SheetJS (xlsx) 0.18.5** — XLSX spreadsheet generation

## Features

### Location Management
- Importable location list from `.txt` files (one location per line, `#` for comments)
- Autocomplete dropdown powered by HTML `<datalist>`
- Supports hierarchical locations (e.g., `Region 5 -> Forest -> District -> Site`)

### Protocol Area
- Static dropdown with all 18 Team Guide sections (15 US + 3 FS)
- Value carries over between entries at the same location

### Team Guide Citation Search
- **2,387 citations** parsed from 19 Team Guide MD files (US Dec 2023 + FS Sep 2008)
- Searchable by keyword, citation code, CFR/USC number, or topic
- Results show code, section, description, and regulatory reference
- Selected citation displays as a card with full details
- **Works fully offline** — JSON cached by service worker on first load
- To rebuild the index from updated MD files: `node build_citations.js`

### Photo Capture
- 2 default photo slots (Photo 1, Photo 2) + unlimited extra slots
- Client-side resize and JPEG compression (configurable: 720p/1080p/1440p/original)
- Default: 1920x1080 at 80% quality (~200-400 KB per photo)
- iOS-safe: file input is destroyed and recreated each capture to prevent stale state

### GPS Tracking
- Manual capture via GPS button
- Auto-capture on first photo of an entry (silent, no error toast)
- Accuracy color-coded: green (≤20m), yellow (≤100m), red (>100m)
- Coordinates displayed as `XX.XXXXXX°N, YY.YYYYYY°W`

### Export
- **Photo naming format:** `MMDDYY_District_Location_0001.jpg`
  - Automatically extracts the last two segments from hierarchical locations
  - Sequential 4-digit numbering across all photos
- **ZIP contents:** photos folder + CSV + XLSX spreadsheet
- Spreadsheet columns: Entry #, Location, Lat, Lon, GPS Accuracy, Protocol Area, Team Guide Citation, Description, Timestamp, Photos

### Storage Monitoring
- **Usage bar** in the bottom bar showing current MB used with color-coded progress
  - Green: under 40 MB
  - Yellow: 40+ MB (warning toast)
  - Red: 72+ MB (critical alert)
- **Old entry reminder** on app launch if entries exist from a previous day
- Estimates usage from both localStorage and IndexedDB

### Backup / Import
- JSON backup export (metadata only, no photo bytes)
- Import with merge or replace options
- Entry normalization on import

## Data Model

Each saved entry:

```javascript
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Region 5 -> Shasta NF -> Weaverville District -> Eagle Creek",
  location:          "Region 5 -> Shasta NF -> Weaverville District -> Eagle Creek",
  protocolArea:      "Water Quality",
  teamGuideCitation: "WQ.10.3.US — 40 CFR 122.26(b)(14)",
  details:           "Observed sediment discharge near culvert outfall",
  latitude:          40.7341,
  longitude:         -122.9418,
  gpsAccuracy:       8.5,
  timestamp:         "2026-04-03T14:30:00.000Z",
  photos: {
    "p_main":    { timestamp, thumbnail, fileType, dbKey },
    "p_wide":    { timestamp, thumbnail, fileType, dbKey },
    "p_extra_0": { ... }
  }
}
```

## Functions

### Initialization

| Function | Description |
|----------|-------------|
| `init()` | App startup — opens IndexedDB, loads saved state, populates location list, restores auto-saved form, checks for old entries |

### Location List

| Function | Description |
|----------|-------------|
| `populateSiteDatalist()` | Fills the HTML `<datalist>` dropdown with imported locations |
| `importSiteList()` | Opens file picker for `.txt` location list import |
| `handleSiteListFile(event)` | Parses imported `.txt` file, stores in localStorage |

### Entry Management

| Function | Description |
|----------|-------------|
| `saveEntryAndNew()` | Saves current entry to `savedEntries[]`, clears form for next entry |
| `clearEntryForm(confirmFirst)` | Resets form fields, photos, GPS; optionally prompts for confirmation |
| `editEntry(index)` | Loads a saved entry back into the form for editing |
| `saveEdit()` | Persists edits to an existing entry (preserves original timestamp) |
| `cancelEdit()` | Exits edit mode without saving |
| `deleteEntry(index)` | Removes a saved entry after confirmation |
| `setEditModeUI(editing, locationName)` | Toggles button text between "Save & New" and "Save Edit" modes |

### Saved Entries Panel

| Function | Description |
|----------|-------------|
| `renderSavedPanel()` | Renders collapsible list of saved entries with thumbnails and metadata |
| `toggleSavedPanel()` | Expands/collapses the saved entries panel |
| `showSavedList()` | Opens panel and scrolls into view |
| `updateHeaderBadge()` | Updates the "X saved" badge in the header |

### Photo Handling

| Function | Description |
|----------|-------------|
| `takePhoto(slotId)` | Destroys and recreates file input (iOS fix), triggers camera |
| `handlePhoto(input, slotId)` | Reads captured image, resizes per settings, stores in IndexedDB, generates thumbnail |
| `addPhotoSlot()` | Creates a dynamic extra photo slot (Photo 3, 4, 5...) |
| `removePhotoSlot(slotId)` | Removes a dynamic photo slot and renumbers remaining |
| `renumberExtraSlots()` | Updates labels after slot removal |
| `getAllCurrentSlots()` | Returns array of all active slot IDs |

### Photo Storage (IndexedDB + localStorage fallback)

| Function | Description |
|----------|-------------|
| `openPhotoDB()` | Opens/creates the IndexedDB database |
| `savePhotoToDB(key, buf, mime)` | Writes photo ArrayBuffer to IndexedDB |
| `getPhotoFromDB(key)` | Reads photo data from IndexedDB |
| `deletePhotoFromDB(key)` | Removes photo from both IndexedDB and localStorage fallback |
| `savePhotoFallback(key, dataUrl)` | Writes base64 photo to localStorage (fallback) |
| `getPhotoFallback(key)` | Reads base64 photo from localStorage |
| `photoDBKey(entryId, slotId)` | Generates storage key: `entryId__slotId` |
| `dataUrlToUint8Array(dataUrl)` | Converts base64 data URL to Uint8Array for binary storage |

### Photo Settings

| Function | Description |
|----------|-------------|
| `getPhotoSettings()` | Returns current resolution/quality settings |
| `showSettings()` | Opens the photo settings dialog |
| `applyPhotoPreset()` | Applies a resolution preset |
| `savePhotoSettings()` | Persists settings to localStorage |
| `resetPhotoSettings()` | Restores defaults (1920x1080, 80% quality) |
| `updateEstimates()` | Updates estimated file size display |

### GPS / Geolocation

| Function | Description |
|----------|-------------|
| `captureGPS(silent)` | Calls `navigator.geolocation.getCurrentPosition()` with high accuracy |
| `getGPS()` | GPS button handler — shows loading animation, captures coordinates |
| `clearGPS()` | Clears stored GPS for current entry |
| `updateGPSDisplay()` | Renders coordinates, accuracy color, and clear button |

### Team Guide Citation Search

| Function | Description |
|----------|-------------|
| `loadCitations()` | Fetches and caches `team_guide_citations.json` |
| `filterCitations()` | Debounced search handler — filters citations by query terms |
| `_filterCitations()` | Core search logic — multi-term matching with score-based ranking |
| `selectCitation(idx)` | Sets the hidden input value and displays citation card |
| `clearCitation()` | Clears citation selection and display |
| `restoreCitationDisplay()` | Restores citation card from saved value (edit mode / page reload) |
| `esc(s)` | HTML-escapes a string for safe display |

### Export

| Function | Description |
|----------|-------------|
| `showExportDialog()` | Opens the export dialog with naming preview |
| `closeExportDialog()` | Closes the export dialog |
| `runExport()` | Builds ZIP containing: photos folder, CSV, and XLSX |
| `updateRefPreview()` | Shows sample filename in export dialog |
| `sanitizeSegment(str)` | Cleans a string for safe use in filenames |
| `extractDistrictAndLocation(str)` | Extracts last two segments from hierarchical location strings |
| `buildPhotoName(entry, seqNum)` | Generates `MMDDYY_District_Location_NNNN` filename |

### Backup / Import

| Function | Description |
|----------|-------------|
| `saveBackup()` | Exports entries as JSON (metadata only, no photo bytes) |
| `importBackup()` | Opens file picker for `.json` backup import |
| `handleBackupFile(event)` | Parses backup JSON; offers merge or replace |
| `normaliseEntry(e)` | Normalizes imported entry fields with defaults |

### Persistence

| Function | Description |
|----------|-------------|
| `autoSaveCurrent()` | Saves in-progress form state to localStorage (survives page reload/camera) |
| `saveAll()` | Persists `savedEntries[]` to localStorage |
| `loadAll()` | Restores saved entries and form state on startup |

### Storage Monitoring

| Function | Description |
|----------|-------------|
| `checkStorage()` | Estimates total usage (localStorage + IndexedDB), updates bar, triggers warnings |
| `estimateIDBSize()` | Iterates IndexedDB records to sum photo byte sizes |
| `checkPreviousDayEntries()` | On startup, toasts a reminder if entries exist from previous days |

### Utilities

| Function | Description |
|----------|-------------|
| `genId()` | Generates unique entry ID: `e_{timestamp}_{random}` |
| `quote(val)` | CSV-safe quoting (escapes commas, quotes, newlines) |
| `datestamp()` | Returns `MMDDYY` string for filenames |
| `showToast(msg, isWarn)` | Shows a temporary notification banner |
| `toggleOverflow()` | Opens/closes the mobile overflow menu |
| `closeOverflow()` | Closes the overflow menu |

## Version History

- **1.3** — Storage monitoring and safety features
  - Storage usage bar in bottom bar (MB used, color-coded)
  - Auto-warning toast at 40 MB threshold
  - Previous-day entry reminder on app launch

- **1.2** — Team Guide citation search and Protocol Area dropdown
  - 2,387 searchable citations from 19 Team Guide files
  - Keyword/CFR/topic search with ranked results
  - Static Protocol Area dropdown (18 sections)
  - Offline citation search via service worker cache

- **1.1** — Photo naming and Team Guide Citation field
  - Photo filenames: `MMDDYY_District_Location_0001.jpg`
  - Extracts District + Location from hierarchical strings
  - Team Guide Citation text field (later replaced by search)

- **1.0** — Initial release, forked from DLA Audit Photo Tool
  - Removed Photo Log (Appendix C.2) and docx dependency
  - Location dropdown with importable `.txt` list
  - GPS capture (manual + auto with photos)
  - Export to ZIP (photos + CSV + XLSX)
  - Green accent color for USFS branding
  - Unique `usfs_*` storage keys
