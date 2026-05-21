# Diagnóstico e Solução: Integração Verum Wallet e Vesting

Este documento detalha as causas raízes dos problemas de comunicação entre a **Verum Wallet Principal** (`verumcrypto.com`) e o **Vesting** (`vesting.verumcrypto.com`), e estabelece o guia arquitetural e requisitos técnicos para que a conexão, assinaturas e autenticação funcionem perfeitamente.

---

## 1. Diagnóstico Técnico (Causas dos Problemas Atuais)

### 1. Falha ao Detectar a Wallet (Race Condition)
O `VerumWalletAdapter.ts` fazia a detecção de ambiente `window.verum` apenas no instante exato da sua instanciação (`constructor()`). Contudo, em aplicações React rodando dentro de um Mobile WebView, ou até mesmo iframes, frequentemente o carregamento do React e instanciação do adaptador ocorre frações de segundo **antes** da injeção nativa do `window.verum`.
* **Sintoma:** O site do vesting nem sempre habilita o botão de conexão ou falha silenciosamente.

### 2. Estouro de Pilha ao Assinar (Maximum Call Stack Exceeded)
Para converter o array de bytes da mensagem em Base64 e enviá-lo via RPC (`postMessage` ou interface nativa), o código utilizava `String.fromCharCode(...bytes)`. Para arrays muito grandes, a desestruturação (`...bytes`) atinge o limite do motor JavaScript, causando a falha imediata da assinatura.
* **Sintoma:** Quando o vesting solicita dados de assinatura, os dados não são transmitidos e a solicitação falha/trava na wallet provider.

### 3. Problemas de Sessão e Cross-Domain
Normalmente, cookies são bloqueados (Safari ITP ou Chrome SameSite) quando um site (`vesting.verumcrypto.com`) roda em iframe sob outro domínio, ou requisita sua API do backend sem headers compatíveis de cross-origin HTTP credentials.
* **Sintoma:** A conexão acontece, mas informações relevantes de backend (onde os fundos/status de vesting estão registrados) não conseguem ser lidas.

---

## 2. Solução Empregada (Já Implementada no Código)

Foi feita uma atualização essencial no `VerumWalletAdapter.ts` na codebase da wallet:

1. **Retry Strategy na Detecção**: Adicionado um loop simples (`setInterval`) que busca a carteira ativamente num curto período (~2 segundos). Eliminando a corrida entre Frontend Web vs Injetor Nativo.
2. **Serialização Base64 Segura**: Foi substituída a serialização insegura com sintaxe de espalhamento `...` para loops em buffer clássicos, garantindo ausência de quebras de *Call Stack*.
3. **Ponto Cego de Origem Tratado**: O Adapter recebeu documentação/comentários avisando para restringir `e.origin`.

---

## 3. Arquitetura Solicitada: Fluxo, CORS e Sessão Integrada

Para integrar **Frontend do Vesting** ←→ **API de Autenticação** ←→ **Wallet Provider**.

### 3.1. Configuração do Servidor / Backend (API)

Independentemente se está usando Ethers.js, Viem, ou Solana Web3, o protocolo seguro é o *Sign In With Web3 (SIWX / EIP-4361 adaptado)*.

1. **Adequação do CORS:**
   Configure a sua API para aceitar credenciais. **Nunca utilize `*` com credenciais.**
   ```http
   Access-Control-Allow-Origin: https://vesting.verumcrypto.com
   Access-Control-Allow-Credentials: true
   Access-Control-Allow-Headers: Content-Type, Authorization
   ```
   *(Dica: Configure uma lista no backend contendo `https://verumcrypto.com, https://vesting.verumcrypto.com` e devolva o origin dinâmico baseado no Origin Request).*

2. **Gerenciamento de Identidade (Subdomínio compartilhado)**:
   Retorne após um `/auth/verify` com validação criptográfica (usando `tweetnacl`) um Cookie fixado no "Dot Domain":
   ```javascript
   // Resposta Node.js Express Exemplo:
   res.cookie('verum_session', token, {
     domain: '.verumcrypto.com', // Atente-se ao "ponto". Compartilha com o Vesting e Main Wallet.
     httpOnly: true,
     secure: true,
     sameSite: 'None' // Requisito rígido para iframes de subdomínio funcionarem cross-site.
   });
   ```

### 3.2. Fluxo Recomendado: Aplicação de Vesting (Front-end)

Atualize o adaptador no `vesting.verumcrypto.com` com o mesmo arquivo que acabamos de modernizar. A autenticação base deve seguir exatamente a ordem:

```javascript
// 1. Instância do provider (usará proxy Iframe ou injeção WebView)
const wallet = new VerumWalletAdapter();
await wallet.connect();

// 2. Pedir o Nonce anti-replay-attack ao Backend da plataforma (com cookies inclusos se existirem)
const res = await fetch('https://api.verumcrypto.com/auth/nonce', { credentials: 'include' });
const { nonce } = await res.json();
const encodedMsg = new TextEncoder().encode(`Sign to authenticate verum vesting: ${nonce}`);

// 3. Solicitação Assinada (Irá engatilhar a VerumWallet para exibir prompt)
const { signature, publicKey } = await wallet.signMessage(encodedMsg);

// 4. Confirmar e Logar
await fetch('https://api.verumcrypto.com/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pubkey: publicKey.toBase58(),
    signature: Buffer.from(signature).toString('base64'),
    message: Buffer.from(encodedMsg).toString('base64'),
  }),
  credentials: 'include' // Obrigatório para guardar o Cookie SameSite gerado
});
```

### 3.3. Projeto da Wallet: Prevenindo Vulnerabilidades

Se o *Vesting* renderiza numa visualização desktop via **iframe**:
- O App "Pai" (a carteira `verumcrypto.com`) recebe as comunicações `VERUM_SIGN_MSQ_REQUEST` através do `message` listener.
- Obrigatório utilizar verificação rigorosa antes de chamar a Engine ou API interna:
```javascript
window.addEventListener('message', async (e) => {
  const TRUSTED_ORIGINS = ['https://vesting.verumcrypto.com', 'http://localhost:3000'];
  if (!TRUSTED_ORIGINS.includes(e.origin)) return;
  // -> Repassar o payload para aprovação do Usuário
});
```

Se o *Vesting* roda em um App nativo como `<WebView>` no React Native:
- Garanta que as Props do Webview passem cookies adequadamente.
- Não há CORS no lado do Mobile nativo, porém a requisição webview do Vesting obedece regras CORS da Web Engine Android/iOS, logo os pontos (3.1) são primordiais.
