/* eslint-disable */
// Apply the translations from scripts/missing-translations.json to each of the
// 15 dictionaries. PT entries are inserted as identity (key === value).
// EN/ES go into SettingsContext.tsx, the other 12 into constants/i18n/<lang>.ts.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'missing-translations.json'), 'utf8'));

const KEYS = DATA._keys_order;
const SETTINGS_LANGS = ['pt', 'en', 'es'];
const EXTRA_LANGS = ['fr', 'de', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl'];

// Escape a string for use inside a single-quoted JS string literal.
function escSingle(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildEntries(lang) {
  const values = lang === 'pt' ? KEYS : DATA[lang];
  if (!values || values.length !== KEYS.length) {
    throw new Error(`Missing or wrong-length translations for ${lang}`);
  }
  const lines = [];
  for (let i = 0; i < KEYS.length; i++) {
    const k = escSingle(KEYS[i]);
    const v = escSingle(values[i]);
    lines.push(`  '${k}': '${v}',`);
  }
  return lines.join('\n');
}

// Find the closing of a top-level lang block inside SettingsContext.tsx.
// Each block starts with "^  <lang>: {" and ends at the matching "^  },".
function findSettingsBlockClose(src, lang) {
  const openRe = new RegExp(`^  ${lang}\\s*:\\s*\\{`, 'm');
  const m = src.match(openRe);
  if (!m) throw new Error(`could not find lang block: ${lang}`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  let inStr = null;
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
  // i is now just past the closing '}'. Return the index of that '}'.
  return i - 1;
}

function patchSettings() {
  let src = fs.readFileSync(SETTINGS, 'utf8');
  // Patch in reverse order so earlier indexes stay stable
  const langs = [...SETTINGS_LANGS].sort((a, b) => {
    const idxA = src.indexOf(`\n  ${a}: {`);
    const idxB = src.indexOf(`\n  ${b}: {`);
    return idxB - idxA; // descending
  });
  for (const lang of langs) {
    const closeIdx = findSettingsBlockClose(src, lang);
    const entries = buildEntries(lang);
    const before = src.slice(0, closeIdx);
    const after = src.slice(closeIdx);
    const insertion = `\n    // ---- Auto-added missing keys (i18n audit) ----\n` +
      entries.split('\n').map(l => '  ' + l).join('\n') + '\n  ';
    src = before + insertion + after;
  }
  fs.writeFileSync(SETTINGS, src);
  console.log('Patched SettingsContext.tsx for pt/en/es');
}

function patchExtra(lang) {
  const file = path.join(I18N_DIR, `${lang}.ts`);
  let src = fs.readFileSync(file, 'utf8');
  // Find the closing '};' at end of file's top-level object.
  // File pattern: "export const <lang>: Record<string, string> = { ... };"
  const m = src.match(/=\s*\{/);
  if (!m) throw new Error(`no opening brace in ${file}`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  let inStr = null;
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
  const closeIdx = i - 1; // position of '}'
  const entries = buildEntries(lang);
  const insertion = `\n  // ---- Auto-added missing keys (i18n audit) ----\n${entries}\n`;
  const before = src.slice(0, closeIdx);
  const after = src.slice(closeIdx);
  src = before + insertion + after;
  fs.writeFileSync(file, src);
  console.log(`Patched constants/i18n/${lang}.ts`);
}

patchSettings();
for (const lang of EXTRA_LANGS) patchExtra(lang);
console.log('Done.');
