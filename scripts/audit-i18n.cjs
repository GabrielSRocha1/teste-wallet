/* eslint-disable */
// Audit translation coverage across all 15 supported languages.
// Strategy:
//   - PT dictionary in constants/SettingsContext.tsx is the master key set.
//   - EN and ES are also inside SettingsContext.tsx.
//   - The other 12 are in constants/i18n/<lang>.ts as exported objects.
//   - Compare every dict against PT and also against t('...') usages in code.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');

const LANGS = ['en','es','pt','fr','de','it','zh','ja','ko','ru','ar','hi','tr','nl','pl'];
const EXTRA_LANGS = ['fr','de','it','zh','ja','ko','ru','ar','hi','tr','nl','pl'];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

// Extract object body for a given language block inside SettingsContext.tsx
function extractBlockFromSettings(src, langCode) {
  // Match e.g. "  pt: {" then balance braces until the matching closing "  },"
  const re = new RegExp(`^\\s{2}${langCode}\\s*:\\s*\\{`, 'm');
  const m = src.match(re);
  if (!m) return null;
  const start = m.index + m[0].length; // position right after the {
  let depth = 1;
  let i = start;
  // Walk char by char respecting strings to find matching brace
  let inStr = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    i++;
  }
  return src.slice(start, i - 1);
}

function extractBlockFromExtraFile(src) {
  // file format: export const <lang>: Record<string, string> = { ... };
  const m = src.match(/=\s*\{/);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  let inStr = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    i++;
  }
  return src.slice(start, i - 1);
}

// Parse "  'key': 'value'," (or with double quotes). Keys may contain escaped chars.
// We only need the keys; we walk the source and pull each top-level property name.
function extractKeys(blockSrc) {
  const keys = new Set();
  if (!blockSrc) return keys;
  let i = 0;
  let depth = 0; // tracks nested { } inside values (shouldn't happen but safe)
  while (i < blockSrc.length) {
    const ch = blockSrc[i];
    if (depth === 0 && (ch === "'" || ch === '"' || ch === '`')) {
      // Possible key start - read string then check for following ':'
      const quote = ch;
      let j = i + 1;
      let str = '';
      while (j < blockSrc.length) {
        const cj = blockSrc[j];
        if (cj === '\\' && j + 1 < blockSrc.length) {
          str += blockSrc[j + 1];
          j += 2;
          continue;
        }
        if (cj === quote) break;
        str += cj;
        j++;
      }
      // After closing quote, skip whitespace, look for ':'
      let k = j + 1;
      while (k < blockSrc.length && /\s/.test(blockSrc[k])) k++;
      if (blockSrc[k] === ':') {
        keys.add(str);
        // jump past the value: walk until we hit a comma at depth 0
        let m = k + 1;
        let valDepth = 0;
        let valStr = null;
        while (m < blockSrc.length) {
          const cm = blockSrc[m];
          const pm = blockSrc[m - 1];
          if (valStr) {
            if (cm === '\\') { m += 2; continue; }
            if (cm === valStr) valStr = null;
          } else {
            if (cm === "'" || cm === '"' || cm === '`') valStr = cm;
            else if (cm === '{' || cm === '[' || cm === '(') valDepth++;
            else if (cm === '}' || cm === ']' || cm === ')') {
              if (valDepth === 0) break;
              valDepth--;
            } else if (cm === ',' && valDepth === 0) break;
          }
          m++;
        }
        i = m + 1;
        continue;
      } else {
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return keys;
}

const settingsSrc = readFile(SETTINGS);

const dicts = {};
for (const lang of ['pt','en','es']) {
  const block = extractBlockFromSettings(settingsSrc, lang);
  dicts[lang] = extractKeys(block);
}
for (const lang of EXTRA_LANGS) {
  const file = path.join(I18N_DIR, `${lang}.ts`);
  const block = extractBlockFromExtraFile(readFile(file));
  dicts[lang] = extractKeys(block);
}

// Load used keys (already extracted via grep)
const usedKeysPath = process.argv[2] || '/tmp/used_keys.txt';
let usedKeys = new Set();
if (fs.existsSync(usedKeysPath)) {
  // NOTE: do NOT trim — t() string literals may carry significant leading/trailing
  // spaces (string concatenation in JSX like `{t('Prefix ')}{var}{t(' suffix')}`).
  usedKeys = new Set(readFile(usedKeysPath).split('\n').filter(line => line.length > 0));
}

// Build report
const report = {
  totalsPerLang: {},
  ptBase: dicts.pt.size,
  usedKeysCount: usedKeys.size,
  usedKeysMissingInPt: [...usedKeys].filter(k => !dicts.pt.has(k)),
  perLang: {},
};

for (const lang of LANGS) {
  report.totalsPerLang[lang] = dicts[lang].size;
  const missingFromPt = [...dicts.pt].filter(k => !dicts[lang].has(k));
  const usedMissing = [...usedKeys].filter(k => dicts.pt.has(k) && !dicts[lang].has(k));
  report.perLang[lang] = {
    totalKeys: dicts[lang].size,
    missingPtKeysCount: missingFromPt.length,
    missingPtKeysSample: missingFromPt.slice(0, 30),
    usedKeysMissingCount: usedMissing.length,
    usedKeysMissingSample: usedMissing.slice(0, 30),
  };
}

console.log('=== TRANSLATION AUDIT ===');
console.log('PT (master) keys:', report.ptBase);
console.log('t() unique strings found in code:', report.usedKeysCount);
console.log('t() strings NOT in PT dictionary:', report.usedKeysMissingInPt.length);
console.log('');
console.log('Per-language coverage:');
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('LANG', 6), pad('KEYS', 8), pad('MISS_FROM_PT', 14), 'USED_MISSING');
for (const lang of LANGS) {
  const r = report.perLang[lang];
  console.log(pad(lang, 6), pad(r.totalKeys, 8), pad(r.missingPtKeysCount, 14), r.usedKeysMissingCount);
}

// Detailed: list missing keys per language
const outPath = path.join(ROOT, 'scratch', 'i18n-audit.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('\nFull report:', outPath);
