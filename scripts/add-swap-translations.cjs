/* eslint-disable */
// Insere as traduções das 6 strings novas do fluxo swap-then-send (transferir.tsx
// + swapAndSendService.ts) em cada um dos 15 dicionários.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const SETTINGS_LANGS = ['pt', 'en', 'es'];
const EXTRA_LANGS = ['fr', 'de', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl'];

const KEYS = [
  'Trocando ativo por SOL e enviando ao destinatário...',
  'Convertido automaticamente de',
  'via swap on-chain',
  'slippage',
  'Swap concluído mas envio do SOL ao destinatário falhou.',
  'O SOL recebido está na sua carteira — tente reenviar manualmente para o destinatário.',
];

const TRANSLATIONS = {
  pt: KEYS, // identity
  en: [
    'Swapping asset to SOL and sending to recipient...',
    'Auto-converted from',
    'via on-chain swap',
    'slippage',
    'Swap completed but sending SOL to recipient failed.',
    'The received SOL is in your wallet — try resending manually to the recipient.',
  ],
  es: [
    'Intercambiando activo por SOL y enviando al destinatario...',
    'Convertido automáticamente de',
    'vía swap on-chain',
    'slippage',
    'Swap completado pero el envío de SOL al destinatario falló.',
    'El SOL recibido está en tu cartera — intenta reenviar manualmente al destinatario.',
  ],
  fr: [
    "Échange de l'actif en SOL et envoi au destinataire...",
    'Converti automatiquement depuis',
    'via swap on-chain',
    'slippage',
    "Swap terminé mais l'envoi du SOL au destinataire a échoué.",
    'Le SOL reçu est dans votre portefeuille — essayez de le renvoyer manuellement au destinataire.',
  ],
  de: [
    'Asset wird in SOL getauscht und an Empfänger gesendet...',
    'Automatisch konvertiert von',
    'via On-Chain-Swap',
    'Slippage',
    'Swap abgeschlossen, aber Senden von SOL an Empfänger fehlgeschlagen.',
    'Das empfangene SOL ist in Ihrer Wallet — versuchen Sie, es manuell an den Empfänger zu senden.',
  ],
  it: [
    "Scambio dell'asset in SOL e invio al destinatario...",
    'Convertito automaticamente da',
    'via swap on-chain',
    'slippage',
    "Swap completato ma l'invio del SOL al destinatario è fallito.",
    'Il SOL ricevuto è nel tuo portafoglio — prova a inviarlo manualmente al destinatario.',
  ],
  zh: [
    '正在将资产兑换为 SOL 并发送给收款人...',
    '自动转换自',
    '通过链上兑换',
    '滑点',
    '兑换完成，但向收款人发送 SOL 失败。',
    '收到的 SOL 在您的钱包中——请尝试手动重新发送给收款人。',
  ],
  ja: [
    '資産を SOL に交換して受取人に送信中...',
    '自動変換元:',
    'オンチェーンスワップ経由',
    'スリッページ',
    'スワップは完了しましたが、受取人への SOL 送信に失敗しました。',
    '受け取った SOL はウォレットにあります — 受取人へ手動で再送信してください。',
  ],
  ko: [
    '자산을 SOL로 스왑하여 수신자에게 전송 중...',
    '자동 변환:',
    '온체인 스왑을 통해',
    '슬리피지',
    '스왑은 완료되었지만 수신자에게 SOL 전송에 실패했습니다.',
    '수신한 SOL은 귀하의 지갑에 있습니다 — 수신자에게 수동으로 다시 보내십시오.',
  ],
  ru: [
    'Обмен актива на SOL и отправка получателю...',
    'Автоматически конвертировано из',
    'через ончейн своп',
    'проскальзывание',
    'Своп выполнен, но отправка SOL получателю не удалась.',
    'Полученный SOL находится в вашем кошельке — попробуйте отправить его получателю вручную.',
  ],
  ar: [
    'تبديل الأصل إلى SOL وإرساله إلى المستلم...',
    'تم التحويل تلقائيا من',
    'عبر تبادل على السلسلة',
    'الانزلاق',
    'اكتمل التبادل لكن إرسال SOL إلى المستلم فشل.',
    'SOL المستلم في محفظتك — حاول إعادة إرساله يدويا إلى المستلم.',
  ],
  hi: [
    'संपत्ति को SOL में बदलकर प्राप्तकर्ता को भेजा जा रहा है...',
    'से स्वचालित रूप से रूपांतरित',
    'ऑन-चेन स्वैप के माध्यम से',
    'स्लिपेज',
    'स्वैप पूर्ण लेकिन प्राप्तकर्ता को SOL भेजना विफल।',
    'प्राप्त SOL आपके वॉलेट में है — मैन्युअल रूप से प्राप्तकर्ता को पुनः भेजने का प्रयास करें।',
  ],
  tr: [
    "Varlık SOL'a takas ediliyor ve alıcıya gönderiliyor...",
    'Otomatik dönüştürüldü',
    'zincir üstü takas ile',
    'kayma',
    'Takas tamamlandı ancak alıcıya SOL gönderimi başarısız.',
    'Alınan SOL cüzdanınızda — alıcıya manuel olarak yeniden göndermeyi deneyin.',
  ],
  nl: [
    'Activum wordt geruild voor SOL en naar ontvanger gestuurd...',
    'Automatisch geconverteerd van',
    'via on-chain swap',
    'slippage',
    'Swap voltooid maar verzending van SOL naar ontvanger mislukt.',
    'De ontvangen SOL staat in je wallet — probeer handmatig opnieuw te verzenden naar de ontvanger.',
  ],
  pl: [
    'Wymiana aktywa na SOL i wysyłanie do odbiorcy...',
    'Automatycznie skonwertowane z',
    'przez swap on-chain',
    'slippage',
    'Swap zakończony, ale wysłanie SOL do odbiorcy nie powiodło się.',
    'Otrzymany SOL jest w Twoim portfelu — spróbuj wysłać go ponownie ręcznie do odbiorcy.',
  ],
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

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
  const openRe = new RegExp(`^  ${lang}\\s*:\\s*\\{`, 'm');
  const m = src.match(openRe);
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
  // Ordem decrescente de posição pra não invalidar índices anteriores
  const langs = [...SETTINGS_LANGS].sort((a, b) => {
    return src.indexOf(`\n  ${b}: {`) - src.indexOf(`\n  ${a}: {`);
  });
  for (const lang of langs) {
    const closeIdx = findSettingsBlockClose(src, lang);
    const entries = buildEntries(lang);
    const insertion =
      `\n    // ---- Auto-added swap-then-send keys ----\n` +
      entries.split('\n').map(l => '  ' + l).join('\n') + '\n  ';
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
  const insertion = `\n  // ---- Auto-added swap-then-send keys ----\n${buildEntries(lang)}\n`;
  src = src.slice(0, closeIdx) + insertion + src.slice(closeIdx);
  fs.writeFileSync(file, src);
  console.log(`Patched constants/i18n/${lang}.ts`);
}

patchSettings();
for (const lang of EXTRA_LANGS) patchExtra(lang);
console.log('Done.');
