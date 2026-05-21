# Integração Verum Wallet — Portal vesting.verumcrypto.com

Este documento é o guia técnico para os desenvolvedores do portal `vesting.verumcrypto.com` integrarem o conector da Verum Wallet.

---

## Como funciona

Quando o usuário abre a aba **Vesting** dentro do app Verum Wallet:

1. O app nativo injeta `window.verum` (e `window.solana` como alias) **antes** de qualquer script da página carregar.
2. Se o usuário já tem sessão ativa, `window.verum.isConnected === true` e `window.verum.publicKey` já está preenchido.
3. O `verum-vesting-connector.js` detecta isso e chama o callback `onStatusChange('connected', publicKey)` **instantaneamente**, sem nenhum clique do usuário.
4. Transações e assinaturas continuam exigindo aprovação explícita do usuário (modal nativo do app).

---

## Implementação

### 1. Incluir o script no portal

Adicione ao `<head>` da página, **antes** de qualquer outro script:

```html
<script src="/verum-vesting-connector.js"></script>
```

### 2. Inicializar na carga da página

```javascript
// main.js ou App.js
async function setupVerumWallet() {
  const connector = window.verumConnector;

  const available = await connector.init(function (status, publicKey) {
    if (status === 'connected') {
      // Atualiza UI: esconde o botão "Conectar" e mostra o endereço
      myApp.setWalletAddress(publicKey);
      myApp.loadVestingData();
    } else if (status === 'disconnected') {
      myApp.clearWalletState();
    }
  });

  if (!available) {
    // Usuário não está dentro do app Verum — mostra botões normais de wallet
    console.log('Verum Wallet não detectada. Mostrando seleção de carteira.');
    return;
  }

  // Se já estava conectado (sessão ativa), init já disparou o callback acima.
  // Se não, mostre o botão "Conectar com Verum" com destaque.
  if (connector.isConnected) {
    console.log('Auto-connect bem-sucedido:', connector.publicKey);
  }
}

document.addEventListener('DOMContentLoaded', setupVerumWallet);
```

### 3. Botão de conexão manual (quando necessário)

```javascript
document.getElementById('btn-conectar-verum').addEventListener('click', async () => {
  const connector = window.verumConnector;
  try {
    const publicKey = await connector.connect();
    console.log('Conectado:', publicKey);
  } catch (err) {
    console.error('Usuário recusou a conexão.');
  }
});
```

---

## Protocolo de mensagens completo

O app nativo e o portal comunicam via `ReactNativeWebView.postMessage` (mobile) ou `window.parent.postMessage` (web/iframe).

### Portal → App (requests)

| Tipo | Campos |
|---|---|
| `VERUM_CONNECT_REQUEST` | `id`, `origin` |
| `VERUM_DISCONNECT` | `origin` |
| `VERUM_SIGN_TX_REQUEST` | `id`, `transaction` (base64), `origin` |
| `VERUM_SIGN_ALL_REQUEST` | `id`, `transactions` (base64[]), `origin` |
| `VERUM_SIGN_MSG_REQUEST` | `id`, `message` (base64), `origin` |

### App → Portal (responses)

| Tipo | Campos |
|---|---|
| `VERUM_CONNECT_RESPONSE` | `id`, `publicKey` |
| `VERUM_CONNECT_REJECTED` | `id`, `reason` |
| `VERUM_SIGN_TX_RESPONSE` | `id`, `signedTransaction` (base64) |
| `VERUM_SIGN_TX_REJECTED` | `id`, `reason` |
| `VERUM_SIGN_ALL_RESPONSE` | `id`, `signedTransactions` (base64[]) |
| `VERUM_SIGN_ALL_REJECTED` | `id`, `reason` |
| `VERUM_SIGN_MSG_RESPONSE` | `id`, `signature` (base64), `publicKey` |
| `VERUM_SIGN_MSG_REJECTED` | `id`, `reason` |

---

## Deteção de ambiente

```javascript
const isInsideVerumApp = !!(window.verum && window.verum.isVerum);
const isWebView = typeof window.ReactNativeWebView !== 'undefined';
```

---

## Resultado esperado

- Usuário abre aba Vesting → já vê saldo e botões "Claim" ativos, **sem nenhum clique extra**.
- Verum aparece como **FAST CONNECT** no modal de seleção de carteiras.
- Transações de claim continuam pedindo confirmação no modal nativo do app.
