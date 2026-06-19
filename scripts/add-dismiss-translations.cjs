/* eslint-disable */
// Insere 4 strings do botão "Dispensar pendência" (recovery UI) em todos os dicts.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const SETTINGS_LANGS = ['pt', 'en', 'es'];
const EXTRA_LANGS = ['fr', 'de', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl'];

const KEYS = [
  'Dispensar pendência?',
  'Confirma que já resolveu este envio por outro meio? Esta pendência será apagada e não voltará a aparecer.',
  'DISPENSAR',
  'JÁ RESOLVI POR FORA — DISPENSAR',
];

const TRANSLATIONS = {
  pt: KEYS,
  en: [
    'Dismiss pending?',
    'Confirm that you already resolved this transfer through another channel? This pending item will be deleted and won\'t appear again.',
    'DISMISS',
    'ALREADY RESOLVED EXTERNALLY — DISMISS',
  ],
  es: [
    '¿Descartar pendiente?',
    '¿Confirmas que ya resolviste este envío por otro medio? Esta pendiente se eliminará y no volverá a aparecer.',
    'DESCARTAR',
    'YA RESOLVÍ POR FUERA — DESCARTAR',
  ],
  fr: [
    "Ignorer l'envoi en attente ?",
    'Confirmez-vous avoir résolu cet envoi par un autre moyen ? Cet élément en attente sera supprimé et ne réapparaîtra pas.',
    'IGNORER',
    "DÉJÀ RÉSOLU À L'EXTÉRIEUR — IGNORER",
  ],
  de: [
    'Ausstehenden Eintrag verwerfen?',
    'Bestätigen Sie, dass Sie diesen Versand auf andere Weise bereits gelöst haben? Dieser ausstehende Eintrag wird gelöscht und erscheint nicht erneut.',
    'VERWERFEN',
    'BEREITS EXTERN GELÖST — VERWERFEN',
  ],
  it: [
    'Scartare in sospeso?',
    'Confermi di aver già risolto questo invio per altra via? Questo elemento in sospeso sarà eliminato e non riapparirà.',
    'SCARTA',
    'GIÀ RISOLTO ALTROVE — SCARTA',
  ],
  zh: [
    '忽略待处理项？',
    '确认您已通过其他方式解决了此次发送？此待处理项将被删除，不会再出现。',
    '忽略',
    '已在外部解决——忽略',
  ],
  ja: [
    '保留中を破棄しますか？',
    'この送信を他の方法で既に解決したことを確認しますか？この保留中の項目は削除され、再表示されません。',
    '破棄',
    '外部で解決済み — 破棄',
  ],
  ko: [
    '대기 중인 항목을 무시하시겠습니까?',
    '이 전송을 다른 방법으로 이미 해결했음을 확인하시겠습니까? 이 대기 중인 항목은 삭제되며 다시 나타나지 않습니다.',
    '무시',
    '이미 외부에서 해결됨 — 무시',
  ],
  ru: [
    'Отклонить ожидающую отправку?',
    'Подтверждаете, что уже решили этот перевод другим способом? Ожидающая запись будет удалена и больше не появится.',
    'ОТКЛОНИТЬ',
    'РЕШЕНО ВНЕ ПРИЛОЖЕНИЯ — ОТКЛОНИТЬ',
  ],
  ar: [
    'تجاهل المعلق؟',
    'هل تؤكد أنك حللت هذا الإرسال بالفعل بطريقة أخرى؟ سيتم حذف هذا المعلق ولن يظهر مرة أخرى.',
    'تجاهل',
    'تم الحل خارجيا — تجاهل',
  ],
  hi: [
    'लंबित खारिज करें?',
    'पुष्टि करें कि आपने यह भेजना पहले से किसी अन्य माध्यम से सुलझा लिया है? यह लंबित आइटम हटा दिया जाएगा और दोबारा नहीं दिखेगा।',
    'खारिज करें',
    'बाहर पहले ही हल — खारिज करें',
  ],
  tr: [
    'Bekleyen iptal edilsin mi?',
    'Bu göndermeyi başka bir yoldan zaten çözdüğünüzü onaylıyor musunuz? Bu bekleyen öğe silinecek ve tekrar görünmeyecek.',
    'İPTAL ET',
    'DIŞARIDAN ZATEN ÇÖZÜLDÜ — İPTAL ET',
  ],
  nl: [
    'Lopende verzending negeren?',
    'Bevestigen dat je deze verzending al via een ander kanaal hebt opgelost? Deze openstaande verzending wordt verwijderd en verschijnt niet opnieuw.',
    'NEGEREN',
    'AL EXTERN OPGELOST — NEGEREN',
  ],
  pl: [
    'Odrzucić oczekujące?',
    'Potwierdzasz, że już rozwiązałeś tę wysyłkę w inny sposób? Ten oczekujący wpis zostanie usunięty i nie pojawi się ponownie.',
    'ODRZUĆ',
    'JUŻ ROZWIĄZANE NA ZEWNĄTRZ — ODRZUĆ',
  ],
};

function escSingle(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildEntries(lang) {
  const values = TRANSLATIONS[lang];
  if (!values || values.length !== KEYS.length) {
    throw new Error(`Missing translations for ${lang}`);
  }
  return KEYS.map((k, i) => `  '${escSingle(k)}': '${escSingle(values[i])}',`).join('\n');
}

function findSettingsBlockClose(src, lang) {
  const m = src.match(new RegExp(`^  ${lang}\\s*:\\s*\\{`, 'm'));
  if (!m) throw new Error(`block not found: ${lang}`);
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
  return i - 1;
}

function patchSettings() {
  let src = fs.readFileSync(SETTINGS, 'utf8');
  const langs = [...SETTINGS_LANGS].sort((a, b) => {
    return src.indexOf(`\n  ${b}: {`) - src.indexOf(`\n  ${a}: {`);
  });
  for (const lang of langs) {
    const closeIdx = findSettingsBlockClose(src, lang);
    const insertion =
      `\n    // ---- Auto-added recovery dismiss keys ----\n` +
      buildEntries(lang).split('\n').map(l => '  ' + l).join('\n') + '\n  ';
    src = src.slice(0, closeIdx) + insertion + src.slice(closeIdx);
  }
  fs.writeFileSync(SETTINGS, src);
  console.log('Patched SettingsContext.tsx (pt/en/es)');
}

function patchExtra(lang) {
  const file = path.join(I18N_DIR, `${lang}.ts`);
  let src = fs.readFileSync(file, 'utf8');
  const m = src.match(/=\s*\{/);
  if (!m) throw new Error(`no opening brace in ${file}`);
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
  const closeIdx = i - 1;
  const insertion = `\n  // ---- Auto-added recovery dismiss keys ----\n${buildEntries(lang)}\n`;
  src = src.slice(0, closeIdx) + insertion + src.slice(closeIdx);
  fs.writeFileSync(file, src);
  console.log(`Patched constants/i18n/${lang}.ts`);
}

patchSettings();
for (const lang of EXTRA_LANGS) patchExtra(lang);
console.log('Done.');
