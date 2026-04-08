/**
 * build_locations.js
 * Combines USFS Office Locations and Recreation Sites into forest_locations.json
 *
 * Data sources (pre-downloaded as JSON):
 *   offices_raw.json  - from EDW_FSOfficeLocations_01 ArcGIS service
 *   rec_batch_*.json  - from EDW_RecInfraRecreationSites_02 ArcGIS service
 *
 * Run: /usr/local/bin/node build_locations.js
 */

const fs = require('fs');

const offices = require('./offices_raw.json').features;
console.log(`Loaded ${offices.length} office locations`);

const recSites = [];
for (let i = 0; i <= 20; i++) {
  const file = `./rec_batch_${i}.json`;
  if (!fs.existsSync(file)) break;
  const batch = require(file).features;
  if (!batch || batch.length === 0) break;
  recSites.push(...batch);
}
console.log(`Loaded ${recSites.length} recreation sites`);

const officeList = offices
  .map(o => o.attributes)
  .filter(a => a.LATITUDE && a.LONGITUDE && a.FOREST_NAME);

// Group rec sites by 4-char SECURITY_ID prefix
const secGroups = {};
for (const r of recSites) {
  const a = r.attributes;
  if (!a.LATITUDE || !a.LONGITUDE) continue;
  const prefix = (a.SECURITY_ID || '').substring(0, 4);
  if (!prefix || prefix.length < 4) continue;
  if (!secGroups[prefix]) secGroups[prefix] = { lats: [], lngs: [], sites: [] };
  secGroups[prefix].lats.push(a.LATITUDE);
  secGroups[prefix].lngs.push(a.LONGITUDE);
  secGroups[prefix].sites.push(a);
}

console.log(`Unique SECURITY_ID prefixes: ${Object.keys(secGroups).length}`);

function dist(lat1, lng1, lat2, lng2) {
  return Math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2);
}

// Map each prefix to nearest forest by centroid-to-office distance
const prefixToForest = {};
for (const [prefix, group] of Object.entries(secGroups)) {
  const cLat = group.lats.reduce((a, b) => a + b, 0) / group.lats.length;
  const cLng = group.lngs.reduce((a, b) => a + b, 0) / group.lngs.length;
  let bestDist = Infinity, bestForest = null;
  for (const off of officeList) {
    const d = dist(cLat, cLng, off.LATITUDE, off.LONGITUDE);
    if (d < bestDist) { bestDist = d; bestForest = off.FOREST_NAME; }
  }
  prefixToForest[prefix] = bestForest || 'Unknown';
}

// Build final structure
const forests = {};

for (const a of officeList) {
  const f = a.FOREST_NAME;
  if (!forests[f]) forests[f] = [];
  forests[f].push({
    n: a.NAME, t: 'Office', d: a.DISTRICT_NAME || '',
    lat: Math.round(a.LATITUDE * 1e6) / 1e6,
    lng: Math.round(a.LONGITUDE * 1e6) / 1e6
  });
}

for (const [prefix, group] of Object.entries(secGroups)) {
  const forestName = prefixToForest[prefix];
  if (!forestName || forestName === 'Unknown') continue;
  if (!forests[forestName]) forests[forestName] = [];
  for (const s of group.sites) {
    forests[forestName].push({
      n: s.SITE_NAME, t: s.SITE_TYPE || 'Rec Site', d: '',
      lat: Math.round(s.LATITUDE * 1e6) / 1e6,
      lng: Math.round(s.LONGITUDE * 1e6) / 1e6
    });
  }
}

// Deduplicate and sort
for (const f of Object.keys(forests)) {
  const seen = new Set();
  forests[f] = forests[f].filter(loc => {
    const key = `${loc.n}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  forests[f].sort((a, b) => a.n.localeCompare(b.n));
}

const forestNames = Object.keys(forests).sort();
let totalLocs = 0;
for (const f of forestNames) {
  totalLocs += forests[f].length;
  console.log(`  ${f}: ${forests[f].length} locations`);
}
console.log(`\nTotal: ${forestNames.length} forests, ${totalLocs} locations`);

const json = JSON.stringify(forests);
fs.writeFileSync('forest_locations.json', json);
console.log(`Wrote forest_locations.json (${(json.length / 1024).toFixed(0)} KB)`);

// Clean up temp files
for (let i = 0; i <= 20; i++) {
  const file = `./rec_batch_${i}.json`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
if (fs.existsSync('./offices_raw.json')) fs.unlinkSync('./offices_raw.json');
console.log('Cleaned up temp files');
