/* eslint-disable */
// Find keys that exist in each EXTRA dict but NOT in PT (master).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const EXTRA_LANGS = ['fr','de','it','zh','ja','ko','ru','ar','hi','tr','nl','pl'];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function extractBlock(src, anchorRe) {
  const m = src.match(anchorRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, i = start, inStr = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    i++;
  }
  return src.slice(start, i - 1);
}

function extractKeys(blockSrc) {
  const keys = new Set();
  if (!blockSrc) return keys;
  let i = 0;
  while (i < blockSrc.length) {
    const ch = blockSrc[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1, str = '';
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
      let k = j + 1;
      while (k < blockSrc.length && /\s/.test(blockSrc[k])) k++;
      if (blockSrc[k] === ':') {
        keys.add(str);
        let m = k + 1, valDepth = 0, valStr = null;
        while (m < blockSrc.length) {
          const cm = blockSrc[m];
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
const ptKeys = extractKeys(extractBlock(settingsSrc, /^  pt\s*:\s*\{/m));

console.log('PT master has', ptKeys.size, 'keys.\n');

const extrasMap = {};
for (const lang of EXTRA_LANGS) {
  const dictKeys = extractKeys(extractBlock(readFile(path.join(I18N_DIR, `${lang}.ts`)), /=\s*\{/));
  const onlyInExtra = [...dictKeys].filter(k => !ptKeys.has(k));
  extrasMap[lang] = onlyInExtra;
}

// Are extra-only sets identical across the 12 langs?
const first = JSON.stringify(extrasMap.fr.sort());
let identical = true;
for (const lang of EXTRA_LANGS) {
  if (JSON.stringify(extrasMap[lang].slice().sort()) !== first) {
    identical = false;
    break;
  }
}
console.log('All 12 extra dicts have the same set of extras-only keys?', identical);
console.log(`Number of extras-only keys per lang (each): ${extrasMap.fr.length}\n`);
console.log('=== Extras-only keys (present in 12 extra dicts but NOT in PT master) ===');
extrasMap.fr.forEach((k, i) => console.log(`${i+1}. ${k}`));
