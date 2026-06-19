/* eslint-disable */
// Insere 10 strings da UI de recovery (transferir.tsx) em cada um dos 15 dicionários.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS = path.join(ROOT, 'constants', 'SettingsContext.tsx');
const I18N_DIR = path.join(ROOT, 'constants', 'i18n');
const SETTINGS_LANGS = ['pt', 'en', 'es'];
const EXTRA_LANGS = ['fr', 'de', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl'];

const KEYS = [
  'Reenviando SOL ao destinatário...',
  'Estado de recovery perdido. Reabra a tela e tente o envio do zero.',
  'Reenvio falhou',
  'Não foi possível reenviar o SOL agora. Tente novamente em instantes.',
  'SWAP CONCLUÍDO — ENVIO PENDENTE',
  'SOL AGUARDANDO REENVIO',
  'DESTINATÁRIO',
  'HASH DO SWAP (CONFIRMADO)',
  'REENVIAR SOL',
  'FECHAR (REENVIAR DEPOIS)',
];

const TRANSLATIONS = {
  pt: KEYS,
  en: [
    'Resending SOL to recipient...',
    'Recovery state lost. Reopen the screen and try the send again from scratch.',
    'Resend failed',
    'Could not resend SOL right now. Please try again in a moment.',
    'SWAP COMPLETED — SEND PENDING',
    'SOL AWAITING RESEND',
    'RECIPIENT',
    'SWAP HASH (CONFIRMED)',
    'RESEND SOL',
    'CLOSE (RESEND LATER)',
  ],
  es: [
    'Reenviando SOL al destinatario...',
    'Estado de recuperación perdido. Reabre la pantalla e inténtalo de nuevo desde cero.',
    'Reenvío fallido',
    'No se pudo reenviar SOL ahora. Intenta nuevamente en unos instantes.',
    'SWAP COMPLETADO — ENVÍO PENDIENTE',
    'SOL ESPERANDO REENVÍO',
    'DESTINATARIO',
    'HASH DEL SWAP (CONFIRMADO)',
    'REENVIAR SOL',
    'CERRAR (REENVIAR DESPUÉS)',
  ],
  fr: [
    'Renvoi du SOL au destinataire...',
    "État de récupération perdu. Rouvrez l'écran et recommencez l'envoi depuis le début.",
    'Échec du renvoi',
    "Impossible de renvoyer SOL pour l'instant. Réessayez dans un instant.",
    'SWAP TERMINÉ — ENVOI EN ATTENTE',
    'SOL EN ATTENTE DE RENVOI',
    'DESTINATAIRE',
    'HASH DU SWAP (CONFIRMÉ)',
    'RENVOYER SOL',
    'FERMER (RENVOYER PLUS TARD)',
  ],
  de: [
    'SOL wird erneut an Empfänger gesendet...',
    'Recovery-Status verloren. Öffnen Sie den Bildschirm erneut und versuchen Sie den Versand von vorne.',
    'Erneuter Versand fehlgeschlagen',
    'SOL konnte gerade nicht erneut gesendet werden. Bitte versuchen Sie es in einem Moment erneut.',
    'SWAP ABGESCHLOSSEN — VERSAND AUSSTEHEND',
    'SOL WARTET AUF ERNEUTEN VERSAND',
    'EMPFÄNGER',
    'SWAP-HASH (BESTÄTIGT)',
    'SOL ERNEUT SENDEN',
    'SCHLIESSEN (SPÄTER ERNEUT SENDEN)',
  ],
  it: [
    'Reinvio SOL al destinatario...',
    "Stato di recupero perso. Riapri la schermata e prova di nuovo l'invio da zero.",
    'Reinvio fallito',
    'Impossibile reinviare SOL ora. Riprova tra un momento.',
    'SWAP COMPLETATO — INVIO IN ATTESA',
    'SOL IN ATTESA DI REINVIO',
    'DESTINATARIO',
    'HASH DELLO SWAP (CONFERMATO)',
    'REINVIA SOL',
    'CHIUDI (REINVIA DOPO)',
  ],
  zh: [
    '正在将 SOL 重新发送给收款人...',
    '恢复状态已丢失。请重新打开屏幕，从头重试发送。',
    '重新发送失败',
    '目前无法重新发送 SOL。请稍后再试。',
    '兑换完成——发送待处理',
    '等待重新发送的 SOL',
    '收款人',
    '兑换哈希（已确认）',
    '重新发送 SOL',
    '关闭（稍后重新发送）',
  ],
  ja: [
    'SOL を受取人に再送信中...',
    'リカバリ状態が失われました。画面を再度開き、最初から送信をやり直してください。',
    '再送信失敗',
    '現在 SOL を再送信できません。少し時間をおいて再試行してください。',
    'スワップ完了 — 送信保留中',
    '再送信待機中の SOL',
    '受取人',
    'スワップハッシュ（確認済み）',
    'SOL を再送信',
    '閉じる（あとで再送信）',
  ],
  ko: [
    '수신자에게 SOL을 다시 전송 중...',
    '복구 상태가 손실되었습니다. 화면을 다시 열고 처음부터 전송을 시도하십시오.',
    '재전송 실패',
    '지금 SOL을 재전송할 수 없습니다. 잠시 후 다시 시도하십시오.',
    '스왑 완료 — 전송 대기 중',
    '재전송 대기 중인 SOL',
    '수신자',
    '스왑 해시 (확인됨)',
    'SOL 재전송',
    '닫기 (나중에 재전송)',
  ],
  ru: [
    'Повторная отправка SOL получателю...',
    'Состояние восстановления потеряно. Откройте экран заново и повторите отправку с самого начала.',
    'Повторная отправка не удалась',
    'Не удалось повторно отправить SOL прямо сейчас. Попробуйте через мгновение.',
    'СВОП ВЫПОЛНЕН — ОТПРАВКА В ОЖИДАНИИ',
    'SOL ОЖИДАЕТ ПОВТОРНОЙ ОТПРАВКИ',
    'ПОЛУЧАТЕЛЬ',
    'ХЭШ СВОПА (ПОДТВЕРЖДЁН)',
    'ОТПРАВИТЬ SOL ЗАНОВО',
    'ЗАКРЫТЬ (ОТПРАВИТЬ ПОЗЖЕ)',
  ],
  ar: [
    'إعادة إرسال SOL إلى المستلم...',
    'فُقدت حالة الاسترداد. أعد فتح الشاشة وحاول الإرسال من البداية.',
    'فشل إعادة الإرسال',
    'تعذرت إعادة إرسال SOL الآن. حاول مرة أخرى بعد لحظات.',
    'اكتمل التبادل — الإرسال قيد الانتظار',
    'SOL في انتظار إعادة الإرسال',
    'المستلم',
    'هاش التبادل (مؤكد)',
    'إعادة إرسال SOL',
    'إغلاق (إعادة الإرسال لاحقا)',
  ],
  hi: [
    'प्राप्तकर्ता को SOL पुनः भेजा जा रहा है...',
    'रिकवरी स्थिति खो गई। स्क्रीन फिर से खोलें और शुरुआत से भेजना पुनः प्रयास करें।',
    'पुनः भेजना विफल',
    'अभी SOL पुनः नहीं भेज सकते। कृपया कुछ क्षणों में पुनः प्रयास करें।',
    'स्वैप पूर्ण — भेजना लंबित',
    'पुनः भेजने की प्रतीक्षा में SOL',
    'प्राप्तकर्ता',
    'स्वैप हैश (पुष्टि)',
    'SOL पुनः भेजें',
    'बंद करें (बाद में भेजें)',
  ],
  tr: [
    'SOL alıcıya yeniden gönderiliyor...',
    'Kurtarma durumu kayboldu. Ekranı yeniden açın ve göndermeyi baştan deneyin.',
    'Yeniden gönderme başarısız',
    'Şu anda SOL yeniden gönderilemedi. Lütfen biraz sonra tekrar deneyin.',
    'TAKAS TAMAMLANDI — GÖNDERİM BEKLEMEDE',
    'YENİDEN GÖNDERİLECEK SOL',
    'ALICI',
    'TAKAS HASHİ (ONAYLANDI)',
    "SOL'U YENİDEN GÖNDER",
    'KAPAT (DAHA SONRA GÖNDER)',
  ],
  nl: [
    'SOL wordt opnieuw naar ontvanger verzonden...',
    'Herstelstatus verloren. Open het scherm opnieuw en probeer de verzending vanaf het begin.',
    'Opnieuw verzenden mislukt',
    'SOL kan nu niet opnieuw worden verzonden. Probeer het over een moment opnieuw.',
    'SWAP VOLTOOID — VERZENDING IN AFWACHTING',
    'SOL WACHT OP HERVERZENDING',
    'ONTVANGER',
    'SWAP-HASH (BEVESTIGD)',
    'SOL OPNIEUW VERZENDEN',
    'SLUITEN (LATER VERZENDEN)',
  ],
  pl: [
    'Ponowne wysyłanie SOL do odbiorcy...',
    'Stan odzyskiwania utracony. Otwórz ekran ponownie i spróbuj wysyłki od początku.',
    'Ponowne wysłanie nie powiodło się',
    'Nie można teraz ponownie wysłać SOL. Spróbuj ponownie za chwilę.',
    'SWAP ZAKOŃCZONY — WYSYŁKA OCZEKUJĄCA',
    'SOL OCZEKUJE NA PONOWNĄ WYSYŁKĘ',
    'ODBIORCA',
    'HASH SWAPA (POTWIERDZONY)',
    'WYŚLIJ SOL PONOWNIE',
    'ZAMKNIJ (WYŚLIJ PÓŹNIEJ)',
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
    throw new Error(`Missing translations for ${lang} (expected ${KEYS.length}, got ${values?.length})`);
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
      `\n    // ---- Auto-added recovery UI keys ----\n` +
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
  const insertion = `\n  // ---- Auto-added recovery UI keys ----\n${buildEntries(lang)}\n`;
  src = src.slice(0, closeIdx) + insertion + src.slice(closeIdx);
  fs.writeFileSync(file, src);
  console.log(`Patched constants/i18n/${lang}.ts`);
}

patchSettings();
for (const lang of EXTRA_LANGS) patchExtra(lang);
console.log('Done.');
