/* eslint-disable */
// Fix 4 dict keys that should have trailing spaces (because the actual t()
// calls in code concatenate them with subsequent JSX values, e.g.
// `{t('Sua compra de ')}{amount}` — without the trailing space the value
// is mashed against the variable.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const EXTRA_LANGS = ['fr', 'de', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl'];

const KEYS_TO_FIX = [
  'Antes de sair, certifique-se de que salvou sua',
  'Não foi possível gerar o QR Code PIX porque o seu KYC ainda não foi concluído. Verifique se a verificação de identidade já foi feita acessando a página',
  'Sua compra de',
  'Tem certeza que deseja desconectar',
];

const files = [SETTINGS, ...EXTRA_LANGS.map(l => path.join(I18N_DIR, `${l}.ts`))];

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = 0;
  for (const key of KEYS_TO_FIX) {
    // Match `'<key>':` — replace with `'<key> ':`. The trailing space lives
    // inside the quoted key so it persists when the dict is read.
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`'${escaped}':`, 'g');
    src = src.replace(re, () => { changed++; return `'${key} ':`; });
  }
  if (changed > 0) {
    fs.writeFileSync(file, src);
    console.log(`Fixed ${changed} key(s) in ${path.relative(ROOT, file)}`);
  }
}
