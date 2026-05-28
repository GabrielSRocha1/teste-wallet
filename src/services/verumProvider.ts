/**
 * VerumProvider — Gerador do script de injeção para WebView/iframe.
 *
 * O script resultante define window.verum e window.solana no contexto
 * da página carregada ANTES de qualquer outro script da página.
 *
 * ─── Protocolo de mensagens ──────────────────────────────────────────────────
 *
 *  WebView → App Nativo:
 *    ReactNativeWebView.postMessage(JSON)
 *
 *  iframe → App (web):
 *    window.parent.postMessage(obj, origin)
 *
 *  App Nativo → WebView:
 *    webViewRef.injectJavaScript('window.verum.__cb(id, result, error)')
 *
 *  App (web) → iframe:
 *    iframeRef.contentWindow.postMessage(obj, vestingOrigin)
 *
 * ─── Tipos de mensagem (WebView → App) ───────────────────────────────────────
 *  VERUM_CONNECT_REQUEST      { id, origin }
 *  VERUM_DISCONNECT           { origin }
 *  VERUM_SIGN_TX_REQUEST      { id, transaction: base64, origin }
 *  VERUM_SIGN_ALL_REQUEST     { id, transactions: base64[], origin }
 *  VERUM_SIGN_MSG_REQUEST     { id, message: base64, origin }
 *
 * ─── Tipos de resposta (App → WebView via injectJavaScript / postMessage) ────
 *  VERUM_CONNECT_RESPONSE     { id, publicKey }
 *  VERUM_CONNECT_REJECTED     { id, reason }
 *  VERUM_SIGN_TX_RESPONSE     { id, signedTransaction: base64 }
 *  VERUM_SIGN_TX_REJECTED     { id, reason }
 *  VERUM_SIGN_ALL_RESPONSE    { id, signedTransactions: base64[] }
 *  VERUM_SIGN_ALL_REJECTED    { id, reason }
 *  VERUM_SIGN_MSG_RESPONSE    { id, signature: base64, publicKey: string }
 *  VERUM_SIGN_MSG_REJECTED    { id, reason }
 */

export type VerumNetwork = 'mainnet' | 'devnet';

export interface VerumProviderOptions {
  /** Rede ativa — obrigatório, falha explícita se ausente */
  network: VerumNetwork;
  /** Se já existe sessão ativa, preenche publicKey imediatamente */
  publicKey?: string | null;
  /** Ativa logs estruturados no console do WebView */
  debug?: boolean;
}

export const VERUM_MSG = {
  // WebView → App
  CONNECT_REQUEST:  'VERUM_CONNECT_REQUEST',
  DISCONNECT:       'VERUM_DISCONNECT',
  SIGN_TX_REQUEST:  'VERUM_SIGN_TX_REQUEST',
  SIGN_ALL_REQUEST: 'VERUM_SIGN_ALL_REQUEST',
  SIGN_MSG_REQUEST: 'VERUM_SIGN_MSG_REQUEST',

  // App → WebView
  CONNECT_RESPONSE:  'VERUM_CONNECT_RESPONSE',
  CONNECT_REJECTED:  'VERUM_CONNECT_REJECTED',
  SIGN_TX_RESPONSE:  'VERUM_SIGN_TX_RESPONSE',
  SIGN_TX_REJECTED:  'VERUM_SIGN_TX_REJECTED',
  SIGN_ALL_RESPONSE: 'VERUM_SIGN_ALL_RESPONSE',
  SIGN_ALL_REJECTED: 'VERUM_SIGN_ALL_REJECTED',
  SIGN_MSG_RESPONSE: 'VERUM_SIGN_MSG_RESPONSE',
  SIGN_MSG_REJECTED: 'VERUM_SIGN_MSG_REJECTED',

  // Handshake (Iframe)
  INIT_REQUEST:      'VERUM_INIT_REQUEST',
  INIT_RESPONSE:     'VERUM_INIT_RESPONSE',
} as const;

export function buildVerumInjectionScript(opts: VerumProviderOptions): string {
  const { network, publicKey = null, debug = false } = opts;

  if (!network) throw new Error('[VerumProvider] network é obrigatório');

  return `
(function () {
  if (window.__verumLoaded) return;
  window.__verumLoaded = true;

  var DEBUG   = ${debug ? 'true' : 'false'};
  var NETWORK = ${JSON.stringify(network)};

  // ── Logger estruturado ─────────────────────────────────────────────────────
  function log(category, msg, data) {
    if (!DEBUG) return;
    var prefix = '[VERUM][' + category + ']';
    data !== undefined
      ? console.log(prefix, msg, data)
      : console.log(prefix, msg);
  }

  // ── Fila de callbacks pendentes (id → {resolve, reject, ts}) ─────────────
  var _cbs = {};
  var _seq = 0;
  var _pending = {}; // id por tipo de request (evita duplicatas excessivas)

  function nextId() { return 'vr' + (++_seq); }

  function enqueue(resolve, reject, type) {
    // Se já existe um connect pendente do mesmo tipo, não duplica o envio pesado
    if (type === 'connect' && _pending['connect']) {
      var existingId = _pending['connect'];
      if (_cbs[existingId]) {
        log('ROBUST', 'Reutilizando request de connect pendente', existingId);
        var oldResolve = _cbs[existingId].resolve;
        var oldReject = _cbs[existingId].reject;
        _cbs[existingId].resolve = function(res) { oldResolve(res); resolve(res); };
        _cbs[existingId].reject = function(err) { oldReject(err); reject(err); };
        return null; // Indica que não precisa enviar mensagem de novo
      }
    }

    var id = nextId();
    // (PF9) Guarda o handle do timeout para limpar no settle — antes ficavam
    // pendurados até 2min mesmo quando a request resolvia normalmente.
    var timeoutHandle = setTimeout(function() {
      if (_cbs[id]) {
        settle(id, null, 'TIMEOUT');
      }
    }, 120000);
    _cbs[id] = { resolve: resolve, reject: reject, ts: Date.now(), type: type, timeoutHandle: timeoutHandle };
    if (type) _pending[type] = id;

    return id;
  }

  function settle(id, result, error) {
    var cb = _cbs[id];
    if (!cb) return;

    // (PF9) Limpa o timeout pendente — sem isso, o timer continuava vivo até
    // 2min após resolução natural, mantendo o callback em memória.
    if (cb.timeoutHandle) {
      clearTimeout(cb.timeoutHandle);
    }

    if (cb.type && _pending[cb.type] === id) {
      delete _pending[cb.type];
    }

    delete _cbs[id];
    
    if (error) {
      log('REJECT', id, error);
      cb.reject(new WalletError(error));
    } else {
      log('RESOLVE', id);
      
      // Transformações de resultado baseadas no tipo de request
      var finalResult = result;
      
      // Se for assinatura de mensagem simples — retorna { signature, publicKey } (padrão Phantom)
      if (cb.type === 'signMsg' && result && typeof result.signature === 'string') {
        finalResult = {
          signature: decodeBase64(result.signature),
          publicKey: result.publicKey || (window.verum.publicKey ? window.verum.publicKey.toString() : ''),
        };
      }
      
      // Se for assinatura de transação única (Uint8Array da tx completa)
      if (cb.type === 'sign' && typeof result === 'string') {
        finalResult = decodeBase64(result);
      }

      // Se for assinatura de múltiplas transações (Array de Uint8Array)
      if (cb.type === 'signAll' && Array.isArray(result)) {
        finalResult = result.map(function(s) { return typeof s === 'string' ? decodeBase64(s) : s; });
      }

      // Se for conexão (sucesso do handshake)
      if (cb.type === 'connect' && result && result.publicKey) {
        // result.publicKey pode chegar como string base58 (bridge web/flat) OU
        // como objeto já empacotado (no nativo, __cb chama __setConnected antes
        // de settle). Normalizamos SEMPRE para a string base58 e empacotamos uma
        // única vez. Sem isso, o objeto era re-empacotado (_s virava objeto),
        // corrompendo toBytes() e fazendo new PublicKey() falhar no adapter do
        // dApp — a wallet mostrava "CONECTADA" mas o site nunca avançava.
        var pkRaw = result.publicKey;
        var pkStr = typeof pkRaw === 'string'
          ? pkRaw
          : (pkRaw && typeof pkRaw.toBase58 === 'function'
              ? pkRaw.toBase58()
              : (pkRaw && typeof pkRaw.toString === 'function' ? pkRaw.toString() : String(pkRaw)));
        var pk = window.verum.__initPublicKey(pkStr);
        window.verum.connected   = true;
        window.verum.isConnected = true;
        window.verum.publicKey   = pk;
        result.publicKey         = pk;
        window.verum.emit('connect', pk);
        window.verum.emit('accountChanged', pk);
        log('CONNECTED', pk.toString());
      }

      cb.resolve(finalResult);
    }
  }

  /** Helper para converter Base64 em Uint8Array compatível com Solanachain standard */
  function decodeBase64(str) {
    try {
      var bin = atob(str);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    } catch (e) {
      console.error('[VERUM][BRIDGE] Falha ao decodificar base64:', e);
      return str;
    }
  }

  // ── Erros padronizados ────────────────────────────────────────────────────
  function WalletError(code, message) {
    var msg = message || codeToMessage(code) || code;
    var err = new Error(msg);
    err.name  = 'WalletError';
    err.code  = code;
    return err;
  }

  function codeToMessage(code) {
    var map = {
      WALLET_NOT_FOUND:  'Verum Wallet não encontrada.',
      USER_REJECTED:     'Solicitação recusada pelo usuário.',
      INVALID_PAYLOAD:   'Payload de transação inválido.',
      NETWORK_MISMATCH:  'A rede da transação não corresponde à rede ativa.',
      NOT_CONNECTED:     'Carteira não conectada. Chame connect() primeiro.',
      TIMEOUT:           'A solicitação expirou.',
    };
    return map[code] || null;
  }

  // ── Detector de ambiente ──────────────────────────────────────────────────
  var _isWebView = typeof window.ReactNativeWebView !== 'undefined';
  var _isIframe  = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  log('DETECTION', 'ambiente', { isWebView: _isWebView, isIframe: _isIframe, network: NETWORK });

  // ── Envio de mensagem para o app ──────────────────────────────────────────
  function send(data) {
    var json = JSON.stringify(data);
    if (_isWebView) {
      window.ReactNativeWebView.postMessage(json);
    } else if (_isIframe) {
      window.parent.postMessage(data, '*');
    }
    log('HANDSHAKE', 'send', data.type + ' id=' + (data.id || '-'));
  }

  // ── Recepção de resposta do app (via postMessage — web/iframe) ────────────
  if (_isIframe && !_isWebView) {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object' || !d.type || !d.id) return;

      log('HANDSHAKE', 'recv', d.type);

      switch (d.type) {
        case 'VERUM_CONNECT_RESPONSE':
          window.verum.isConnected = true;
          window.verum.publicKey   = d.publicKey;
          settle(d.id, { publicKey: d.publicKey }, null);
          window.dispatchEvent(new CustomEvent('verum#connected', { detail: { publicKey: d.publicKey } }));
          break;
        case 'VERUM_CONNECT_REJECTED':
          settle(d.id, null, d.reason || 'USER_REJECTED');
          break;
        case 'VERUM_SIGN_TX_RESPONSE':
          settle(d.id, d.signedTransaction, null);
          break;
        case 'VERUM_SIGN_TX_REJECTED':
          settle(d.id, null, d.reason || 'USER_REJECTED');
          break;
        case 'VERUM_SIGN_ALL_RESPONSE':
          settle(d.id, d.signedTransactions, null);
          break;
        case 'VERUM_SIGN_ALL_REJECTED':
          settle(d.id, null, d.reason || 'USER_REJECTED');
          break;
        case 'VERUM_SIGN_MSG_RESPONSE':
          settle(d.id, { signature: d.signature, publicKey: d.publicKey }, null);
          break;
        case 'VERUM_SIGN_MSG_REJECTED':
          settle(d.id, null, d.reason || 'USER_REJECTED');
          break;
      }
    });
  }

  // ── Serialização de Transaction / VersionedTransaction ────────────────────
  function serializeTx(tx) {
    var bytes;
    // Wallet Standard (solana:signTransaction) entrega os bytes já serializados
    // como Uint8Array — não há objeto Transaction para .serialize(). Sem este
    // ramo, serializeTx lançava INVALID_PAYLOAD e a assinatura falhava só pela
    // lista de carteiras do dApp.
    if (tx instanceof Uint8Array) {
      bytes = tx;
    } else if (tx && tx.version !== undefined) {
      // VersionedTransaction (sem campo .signatures, usa .serialize() direto)
      bytes = tx.serialize();
    } else if (tx && typeof tx.serialize === 'function') {
      // Transaction legada
      bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    } else {
      throw new WalletError('INVALID_PAYLOAD');
    }
    // Evita stack overflow para arrays grandes (ex: transações complexas)
    var binary = '';
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);

  }

  // ── window.verum ──────────────────────────────────────────────────────────
  window.verum = {
    isVerum:     true,
    isPhantom:   true,
    isSolflare:  true,
    connected:   ${publicKey ? 'true' : 'false'},
    isConnected: ${publicKey ? 'true' : 'false'},
    publicKey:   null,
    network:     NETWORK,

    // ── Internal event emitter ──────────────────────────────────────────────
    _events: {},
    on: function (event, cb) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(cb);
      return this;
    },
    off: function (event, cb) {
      if (!this._events[event]) return this;
      this._events[event] = this._events[event].filter(function (f) { return f !== cb; });
      return this;
    },
    emit: function (event, data) {
      if (!this._events[event]) return;
      this._events[event].forEach(function (cb) { try { cb(data); } catch (e) { console.error(e); } });
    },

    __initPublicKey: function (pubKeyStr) {
      if (!pubKeyStr) return null;
      return {
        _s: pubKeyStr,
        toString: function () { return this._s; },
        toBase58: function () { return this._s; },
        toJSON:   function () { return this._s; },
        equals:   function (other) { 
          return other && (other.toString() === this._s || other === this._s); 
        },
        toBytes:  function () { 
          return window.verum.__b58decode(this._s);
        }
      };
    },

    __b58decode: function (s) {
      var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      var lookup = {};
      for (var i = 0; i < ALPHABET.length; i++) lookup[ALPHABET[i]] = i;
      var bytes = [0];
      for (var i = 0; i < s.length; i++) {
        var c = lookup[s[i]];
        if (c === undefined) throw new Error('Invalid base58 character');
        for (var j = 0; j < bytes.length; j++) {
          c += bytes[j] * 58;
          bytes[j] = c & 0xff;
          c >>= 8;
        }
        while (c > 0) {
          bytes.push(c & 0xff);
          c >>= 8;
        }
      }
      for (var i = 0; s[i] === '1' && i < s.length - 1; i++) bytes.push(0);
      return new Uint8Array(bytes.reverse());
    },


    // ── connect ─────────────────────────────────────────────────────────────
    connect: function (options) {
      log('DETECTION', 'connect()', 'onlyIfTrusted=' + (options && options.onlyIfTrusted));
      
      // Se já estamos conectados com uma conta vinda do app nativo, resolvemos na hora
      if (window.verum.connected && window.verum.publicKey) {
        log('AUTO', 'Conexão automática via sessão ativa', window.verum.publicKey.toString());
        return Promise.resolve({ publicKey: window.verum.publicKey });
      }

      return new Promise(function (resolve, reject) {
        var id = enqueue(resolve, reject, 'connect');
        if (id) {
          send({ type: 'VERUM_CONNECT_REQUEST', id: id, origin: window.location.origin });
        }
      });
    },

    // ── disconnect ──────────────────────────────────────────────────────────
    disconnect: function () {
      log('DETECTION', 'disconnect()', 'origin=' + window.location.origin);
      window.verum.connected = false;
      window.verum.publicKey = null;
      send({ type: 'VERUM_DISCONNECT', origin: window.location.origin });
      window.dispatchEvent(new Event('verum#disconnected'));
      window.verum.emit('disconnect');
      return Promise.resolve();
    },

    // ── signTransaction ─────────────────────────────────────────────────────
    signTransaction: function (transaction) {
      if (!window.verum.connected) return Promise.reject(new WalletError('NOT_CONNECTED'));
      log('SIGNATURE', 'signTransaction()', 'origin=' + window.location.origin);
      return new Promise(function (resolve, reject) {
        var id = enqueue(resolve, reject, 'sign');
        try {
          var serialized = serializeTx(transaction);
          send({ type: 'VERUM_SIGN_TX_REQUEST', id: id, transaction: serialized, origin: window.location.origin });
        } catch (e) {
          settle(id, null, 'INVALID_PAYLOAD');
        }
      });
    },

    // ── signAllTransactions ─────────────────────────────────────────────────
    signAllTransactions: function (transactions) {
      if (!window.verum.connected) return Promise.reject(new WalletError('NOT_CONNECTED'));
      log('SIGNATURE', 'signAllTransactions()', 'count=' + transactions.length);
      return new Promise(function (resolve, reject) {
        var id = enqueue(resolve, reject, 'signAll');
        try {
          var serialized = transactions.map(serializeTx);
          send({ type: 'VERUM_SIGN_ALL_REQUEST', id: id, transactions: serialized, origin: window.location.origin });
        } catch (e) {
          settle(id, null, 'INVALID_PAYLOAD');
        }
      });
    },

    // ── signMessage ─────────────────────────────────────────────────────────
    signMessage: function (message) {
      if (!window.verum.connected) return Promise.reject(new WalletError('NOT_CONNECTED'));
      log('SIGNATURE', 'signMessage()', 'bytes=' + message.length);
      return new Promise(function (resolve, reject) {
        var id = enqueue(resolve, reject, 'signMsg');
        try {
          var binary = '';
          var bytes = new Uint8Array(message);
          for (var i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          var encoded = btoa(binary);

          send({ type: 'VERUM_SIGN_MSG_REQUEST', id: id, message: encoded, origin: window.location.origin });
        } catch (e) {
          settle(id, null, 'INVALID_PAYLOAD');
        }
      });
    },

    // ── request (Compatibilidade Phantom/Wallet-Adapter standard) ───────────
    request: function (req) {
      log('ROBUST', 'request()', req.method);
      switch(req.method) {
        case 'connect': return window.verum.connect();
        case 'disconnect': return window.verum.disconnect();
        case 'signTransaction': return window.verum.signTransaction(req.params.transaction);
        case 'signAllTransactions': return window.verum.signAllTransactions(req.params.transactions);
        case 'signMessage': return window.verum.signMessage(req.params.message);
        default: return Promise.reject(new WalletError('METHOD_NOT_SUPPORTED'));
      }
    },

    // ── Callback interno — chamado pelo app nativo via injectJavaScript ──────
    __cb: function (id, result, error) {
      if (result && result.publicKey && typeof result.publicKey === 'string') {
        window.verum.__setConnected(result.publicKey);
        result.publicKey = window.verum.publicKey; // Substitui pela versão objeto
      }
      settle(id, result, error);
    },

    // ── Atalho para conexão imediata (sem modal) quando já existe sessão ────
    __setConnected: function (pubKeyStr) {
      window.verum.connected   = true;
      window.verum.isConnected = true;
      window.verum.publicKey   = window.verum.__initPublicKey(pubKeyStr);
      log('DETECTION', '__setConnected', pubKeyStr);

      // Standard Events
      window.dispatchEvent(new CustomEvent('verum#connected', { detail: { publicKey: pubKeyStr } }));
      window.verum.emit('accountChanged', window.verum.publicKey);
      window.verum.emit('connect', window.verum.publicKey);

      // Compatibility with standard Wallet Adapters
      window.dispatchEvent(new CustomEvent('solana#connected', { detail: { publicKey: pubKeyStr } }));
    },
  };

// Inicializa publicKey se fornecido via opts
if (${publicKey ? 'true' : 'false'}) {
  window.verum.__setConnected(${JSON.stringify(publicKey)});
}

// ── Alias window.solana (compatibilidade Phantom / Wallet Adapter) ─────────
if (!window.solana) {
  window.solana = window.verum;
  log('DETECTION', 'window.solana → alias de window.verum');
}

// ── Wallet Standard Registration (para dApps que usam @solana/wallet-adapter) ──
(function registerWalletStandard() {
  var walletObj = {
    version: '1.0.0',
    name: 'Verum Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzBBMEEwQSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI0M5QTg0QyI+VjwvdGV4dD48L3N2Zz4=',
    chains: ['solana:mainnet', 'solana:devnet'],
    accounts: [],
    _events: {},
    get features() {
      var self = this;
      return {
        'standard:connect': {
          version: '1.0.0',
          connect: function(input) {
            return window.verum.connect(input).then(function(res) {
              var pk = res && res.publicKey ? res.publicKey.toString() : '';
              if (pk) {
                self.accounts = [{ address: pk, publicKey: pk, chains: ['solana:mainnet'], features: ['standard:connect','standard:disconnect','solana:signTransaction','solana:signMessage'] }];
                self._emitChange();
              }
              return { accounts: self.accounts };
            });
          }
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: function() {
            return window.verum.disconnect().then(function() {
              self.accounts = [];
              self._emitChange();
            });
          }
        },
        'standard:events': {
          version: '1.0.0',
          on: function(event, listener) {
            if (!self._events[event]) self._events[event] = [];
            self._events[event].push(listener);
            return function() {
              self._events[event] = (self._events[event] || []).filter(function(l) { return l !== listener; });
            };
          }
        },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: function() {
            var args = Array.prototype.slice.call(arguments);
            return Promise.all(args.map(function(input) {
              return window.verum.signTransaction(input.transaction).then(function(signed) {
                return { signedTransaction: signed };
              });
            }));
          }
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: function() {
            var args = Array.prototype.slice.call(arguments);
            return Promise.all(args.map(function(input) {
              return window.verum.signMessage(input.message).then(function(sig) {
                return { signedMessage: input.message, signature: sig instanceof Uint8Array ? sig : sig.signature };
              });
            }));
          }
        }
      };
    },
    _emitChange: function() {
      var listeners = this._events['change'] || [];
      var accts = this.accounts;
      listeners.forEach(function(cb) { try { cb({ accounts: accts }); } catch(e) {} });
    }
  };

  // Registra via navigator.wallets.register() se disponível (API legada)
  if (navigator.wallets && typeof navigator.wallets.register === 'function') {
    navigator.wallets.register(walletObj);
    log('DETECTION', 'Wallet Standard registrado via navigator.wallets');
  }

  // Callback no formato exigido pelo Wallet Standard: o app entrega a API
  // { register } e a carteira chama register(walletObj). Antes o detail era
  // um objeto { register: fn }, então o app fazia detail({register}) num objeto
  // não-chamável → registro falhava silenciosamente e a Verum não aparecia na
  // lista de carteiras de dApps que usam @solana/wallet-adapter.
  function registerCallback(api) {
    if (api && typeof api.register === 'function') {
      try {
        api.register(walletObj);
        log('DETECTION', 'Wallet Standard registrado');
      } catch (e) {}
    }
  }

  // Anuncia para apps que já estão ouvindo. detail DEVE ser o próprio callback.
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: registerCallback,
    }));
  } catch (e) {}

  // Apps que inicializam depois disparam app-ready com detail = a API { register }.
  window.addEventListener('wallet-standard:app-ready', function(e) {
    registerCallback(e && e.detail);
  });
})();

log('DETECTION', 'Provider pronto', {
  network:    NETWORK,
  isWebView:  _isWebView,
  isIframe:   _isIframe,
  publicKey:  window.verum.publicKey,
  connected:  window.verum.connected
});

  window.dispatchEvent(new Event('verum#initialized'));
  document.dispatchEvent(new Event('verum#initialized'));
})();
true;
`;
}
