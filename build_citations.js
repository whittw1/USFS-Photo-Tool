#!/usr/bin/env node
/**
 * Parses Team Guide MD files into a searchable JSON citation index.
 * Run: node build_citations.js
 * Output: team_guide_citations.json
 */

const fs = require('fs');
const path = require('path');

const MD_DIR = '/Users/whittw/Desktop/AI Files/FS AI Stuff/Data Repositories for Web App/US-Dec-23-Word/Teams MD Files';

// Map file prefixes to readable section names
const SECTION_NAMES = {
  'usae': 'Air Emissions',
  'uscr': 'Cultural Resources',
  'usem': 'Environmental Management',
  'ushm': 'Hazardous Materials',
  'ushw': 'Hazardous Waste',
  'usmm': 'Materials Management',
  'usnr': 'Noise & Radiation',
  'usoo': 'Oil Operations',
  'uspm': 'Pesticide Management',
  'uspo': 'Pollution Prevention',
  'usso': 'Storage Operations',
  'usst': 'Stormwater',
  'ustt': 'Tanks & Transportation',
  'uswa': 'Wastewater',
  'uswq': 'Water Quality',
  'fspm': 'FS: Pesticides',
  'fswa': 'FS: Wastewater',
  'fswq': 'FS: Water Quality',
};

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const basename = path.basename(filePath, '_compact.md').replace(/-/g, '_');
  const prefix = basename.split('_')[0]; // e.g. 'ushm', 'fspm'
  const sectionName = SECTION_NAMES[prefix] || prefix.toUpperCase();
  const isFS = prefix.startsWith('fs');
  const guideType = isFS ? 'FS' : 'US';

  const citations = [];

  // Extract checklist items: [XX.Y.Z.US/FS. Description text. (Citation)]
  // These can span multiple lines, so we need to accumulate
  let bracketBuffer = '';
  let inBracket = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for bracket start - codes like HM.1.1.US, O1.1.1.US, T1.1.1.US, SO.1.1.
    if (!inBracket && line.includes('[') && /\[[A-Z][A-Z0-9]{0,3}[\.-]\d/.test(line)) {
      bracketBuffer = line;
      inBracket = true;
      if (line.includes(']')) {
        // Single-line bracket
        inBracket = false;
        processBracket(bracketBuffer, citations, sectionName, guideType, prefix);
        bracketBuffer = '';
      }
    } else if (inBracket) {
      bracketBuffer += ' ' + line.trim();
      if (line.includes(']')) {
        inBracket = false;
        processBracket(bracketBuffer, citations, sectionName, guideType, prefix);
        bracketBuffer = '';
      }
    }

    // Also extract "Verify that..." lines associated with the last citation
    if (citations.length > 0 && /^\s*Verify that\b/i.test(line)) {
      const last = citations[citations.length - 1];
      if (!last.verifyItems) last.verifyItems = [];
      last.verifyItems.push(line.trim());
    }
  }

  return citations;
}

function processBracket(text, citations, sectionName, guideType, filePrefix) {
  // Extract the content between [ and ]
  const match = text.match(/\[([^\]]+)\]/);
  if (!match) return;

  const inner = match[1].trim();

  // Parse: CODE.NUM.NUM[.TYPE]. Description text. (CFR citation)
  // Examples:
  //   HM.1.1.US. Description (29 CFR 1910.1200(b))
  //   O1.1.1.US. Description
  //   SO.1.1. Description
  //   PM.1.1.FS. Description (FSH 2109.14)
  const codeMatch = inner.match(/^([A-Z][A-Z0-9]{0,3}[\.-]\d+[\.-]\d+(?:[\.-](?:US|FS))?)[\.\s]+(.+)$/s);
  if (!codeMatch) return;

  const code = codeMatch[1].replace(/\./g, '.'); // normalize
  let rest = codeMatch[2].trim();

  // Extract regulatory citation from parentheses at end
  let regCitation = '';
  const citMatch = rest.match(/\(([^)]*(?:CFR|USC|FSH|FSM|EO |PL |Public Law)[^)]*)\)\s*$/i);
  if (citMatch) {
    regCitation = citMatch[1].trim();
    rest = rest.substring(0, rest.lastIndexOf('(' + citMatch[1])).trim();
  } else {
    // Try to grab last parenthetical as citation
    const lastParen = rest.match(/\(([^)]+)\)\s*$/);
    if (lastParen) {
      regCitation = lastParen[1].trim();
      rest = rest.substring(0, rest.lastIndexOf('(' + lastParen[1])).trim();
    }
  }

  // Clean up trailing period
  rest = rest.replace(/\.\s*$/, '').trim();

  // Build a short description (first sentence or first 150 chars)
  let shortDesc = rest;
  const sentenceEnd = rest.search(/\.\s/);
  if (sentenceEnd > 20 && sentenceEnd < 200) {
    shortDesc = rest.substring(0, sentenceEnd + 1);
  } else if (rest.length > 150) {
    shortDesc = rest.substring(0, 147) + '...';
  }

  citations.push({
    code,
    section: sectionName,
    guideType,
    filePrefix,
    description: shortDesc,
    fullText: rest,
    citation: regCitation,
    searchText: `${code} ${sectionName} ${rest} ${regCitation}`.toLowerCase()
  });
}

// Main
const files = fs.readdirSync(MD_DIR).filter(f => f.endsWith('.md')).sort();
let allCitations = [];

for (const file of files) {
  // Skip duplicate
  if (file.includes('(1)')) continue;
  const filePath = path.join(MD_DIR, file);
  const citations = parseFile(filePath);
  allCitations = allCitations.concat(citations);
  console.log(`${file}: ${citations.length} citations`);
}

// Build lean output — search text is built client-side from code+section+desc+cite
allCitations = allCitations.map(c => {
  return {
    c: c.code,           // code e.g. HM.1.1.US
    s: c.section,        // section name e.g. "Hazardous Materials"
    d: c.description,    // short description
    r: c.citation,       // regulatory citation e.g. "29 CFR 1910.1200(b)"
  };
});

console.log(`\nTotal: ${allCitations.length} citations`);

// Write output
const outPath = path.join('/Users/whittw/Desktop/USFS-Photo-Tool', 'team_guide_citations.json');
fs.writeFileSync(outPath, JSON.stringify(allCitations, null, 0));
console.log(`Written to ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
