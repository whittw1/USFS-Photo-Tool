# Vendored libraries

Bundled with the app so exports work offline on the iOS build, which has no
service worker to cache CDN scripts. Do not edit these files; to upgrade, replace
a file with the new version's minified build, check it against the cdnjs SRI
hash, update the table below, and bump `CACHE_NAME` in `sw.js`.

| File | Library | Version | Source | License |
|---|---|---|---|---|
| `jszip.min.js` | JSZip | 3.10.1 | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | MIT or GPLv3 (used under MIT) — `LICENSE-jszip.md` |
| `exceljs.min.js` | ExcelJS | 4.4.0 | https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js | MIT — `LICENSE-exceljs.txt` |

SRI hashes (verified against `https://api.cdnjs.com/libraries/<lib>/<version>?fields=sri` on 2026-09-27):

- `jszip.min.js`: `sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==`
- `exceljs.min.js`: `sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==`
