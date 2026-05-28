/**
 * VerumVestingConnector v3
 *
 * Script incluído pelo portal (ex.: vesting.verumcrypto.com via
 * <Script src="/verum-vesting-connector.js" strategy="beforeInteractive">).
 *
 * Contrato esperado pelo portal:
 *   window.verumConnector.on('connected', cb)   // cb(publicKeyString)
 *   await window.verumConnector.init()           // true se houver provider
 *   // no 'connected', o portal chama o wallet-adapter: connect('verum')
 *
 * Funciona em três ambientes:
 *
 *  1. WebView nativo  → o app injeta window.verum; aqui só expomos a API
 *                       window.verumConnector e repassamos os eventos.
 *  2. Iframe (web)    → NÃO dá para injetar JS cross-origin a partir do app.
 *                       Mas ESTE script roda DENTRO do iframe, então ele mesmo
 *                       define window.verum como um provider-ponte (postMessage)
 *                       com a wallet-pai. Assim o VerumWalletAdapter do portal
 *                       encontra window.verum, NÃO redireciona para URL morta, e
 *                       conecta exatamente como no nativo.
 *  3. Standalone      → sem wallet-pai; não há provider (init() → false).
 *
 * Protocolo postMessage (idêntico ao tratado pelo dapp-browser da wallet):
 *   iframe → pai:  { type, id, origin, ...payload }
 *   pai → iframe:  { type, id, publicKey | signedTransaction(s) | signature | reason }
 */

(function () {
  'use strict';

  if (window.verumConnector) return;

  var REQUEST_TIMEOUT_MS = 120000;

  // ─── Estado ───────────────────────────────────────────────────────────────

  var _wallet = null;
  var _publicKey = null;
  var _isConnected = false;
  var _onStatus = null;
  var _cEvents = {};        // eventos do connector ('connected'/'disconnected')
  var _pending = {};        // requests da ponte: id → {resolve, reject, timeout}

  // ─── Utilitários ────────────────────────────────────────────────────────────

  function log(msg, data) {
    if (typeof console !== 'undefined') {
      data !== undefined
        ? console.log('[VerumConnector] ' + msg, data)
        : console.log('[VerumConnector] ' + msg);
    }
  }

  function notifyStatus(status, pk) {
    if (typeof _onStatus === 'function') {
      try { _onStatus(status, pk); } catch (e) { /* não bloqueia */ }
    }
  }

  function emitConnector(ev, data) {
    (_cEvents[ev] || []).forEach(function (cb) { try { cb(data); } catch (e) {} });
  }

  // ID via CSPRNG (Math.random é previsível). Script plain — sem imports do bundle.
  function nextId() {
    var cryptoObj = (typeof window !== 'undefined' ? window.crypto : null) ||
                    (typeof self !== 'undefined' ? self.crypto : null);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      var buf = new Uint8Array(8);
      cryptoObj.getRandomValues(buf);
      var hex = '';
      for (var i = 0; i < buf.length; i++) {
        var b = buf[i].toString(16);
        hex += b.length === 1 ? '0' + b : b;
      }
      return 'vc' + hex;
    }
    return 'vc' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  function bytesToB64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function b64ToBytes(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // base58 → Uint8Array (VerumWalletAdapter faz new PublicKey(publicKey.toBytes())).
  function bs58ToBytes(s) {
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
    for (var k = 0; s[k] === '1' && k < s.length - 1; k++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  function makePublicKey(s) {
    return {
      _s: s,
      toString: function () { return this._s; },
      toBase58: function () { return this._s; },
      toJSON:   function () { return this._s; },
      toBytes:  function () { return bs58ToBytes(this._s); },
      equals:   function (o) { return o && (o.toString() === this._s || o === this._s); },
    };
  }

  // Serializa Transaction/VersionedTransaction/Uint8Array → base64 (igual ao nativo).
  function serializeTx(tx) {
    var bytes;
    if (tx instanceof Uint8Array) bytes = tx;
    else if (tx && tx.version !== undefined) bytes = tx.serialize();
    else if (tx && typeof tx.serialize === 'function') bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    else throw new Error('INVALID_PAYLOAD');
    return bytesToB64(bytes);
  }

  function dispatchConnected(pk) {
    try {
      window.dispatchEvent(new CustomEvent('verum#connected', { detail: { publicKey: pk } }));
    } catch (e) {}
  }

  // ─── Detecção de ambiente ────────────────────────────────────────────────────

  var _isWebView = typeof window.ReactNativeWebView !== 'undefined';
  var _isIframe  = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  var _hasInjected = !!(window.verum && window.verum.isVerum) ||
                     !!(window.solana && window.solana.isVerum);
  var _bridgeMode = _isIframe && !_isWebView && !_hasInjected;

  // ─── Ponte postMessage (iframe) ──────────────────────────────────────────────

  function postToParent(data) {
    try { window.parent.postMessage(data, '*'); } catch (e) { log('Falha postMessage', e); }
  }

  function bridgeRequest(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = nextId();
      var timeout = setTimeout(function () {
        if (_pending[id]) { delete _pending[id]; reject(new Error('TIMEOUT')); }
      }, REQUEST_TIMEOUT_MS);
      _pending[id] = { resolve: resolve, reject: reject, timeout: timeout };
      var msg = { type: type, id: id, origin: window.location.origin };
      if (payload) for (var k in payload) if (payload.hasOwnProperty(k)) msg[k] = payload[k];
      postToParent(msg);
    });
  }

  function settleBridge(id, value, error) {
    var p = _pending[id];
    if (!p) return;
    clearTimeout(p.timeout);
    delete _pending[id];
    error ? p.reject(error) : p.resolve(value);
  }

  // ─── Provider-ponte (window.verum no iframe) ─────────────────────────────────

  function buildBridgeProvider() {
    return {
      isVerum: true,
      isPhantom: true,
      isConnected: false,
      connected: false,
      publicKey: null,
      network: 'mainnet',
      _events: {},

      on: function (e, cb) { (this._events[e] || (this._events[e] = [])).push(cb); return this; },
      off: function (e, cb) {
        if (this._events[e]) this._events[e] = this._events[e].filter(function (f) { return f !== cb; });
        return this;
      },
      emit: function (e, d) {
        (this._events[e] || []).forEach(function (cb) { try { cb(d); } catch (err) {} });
      },

      __setConnected: function (pkStr) {
        this.connected = true;
        this.isConnected = true;
        this.publicKey = makePublicKey(pkStr);
        this.emit('connect', this.publicKey);
        this.emit('accountChanged', this.publicKey);
      },

      connect: function () {
        var self = this;
        if (self.connected && self.publicKey) return Promise.resolve({ publicKey: self.publicKey });
        return bridgeRequest('VERUM_CONNECT_REQUEST').then(function () {
          return { publicKey: self.publicKey };
        });
      },

      disconnect: function () {
        postToParent({ type: 'VERUM_DISCONNECT', origin: window.location.origin });
        this.connected = false;
        this.isConnected = false;
        this.publicKey = null;
        this.emit('disconnect');
        return Promise.resolve();
      },

      signTransaction: function (tx) {
        return bridgeRequest('VERUM_SIGN_TX_REQUEST', { transaction: serializeTx(tx) })
          .then(function (b64) { return b64ToBytes(b64); });
      },

      signAllTransactions: function (txs) {
        return bridgeRequest('VERUM_SIGN_ALL_REQUEST', { transactions: txs.map(serializeTx) })
          .then(function (arr) { return arr.map(function (b) { return b64ToBytes(b); }); });
      },

      signMessage: function (message) {
        return bridgeRequest('VERUM_SIGN_MSG_REQUEST', { message: bytesToB64(message) })
          .then(function (r) { return { signature: b64ToBytes(r.signature), publicKey: r.publicKey }; });
      },
    };
  }

  if (_bridgeMode) {
    var bridge = buildBridgeProvider();
    window.verum = bridge;
    if (!window.solana) window.solana = bridge;

    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object' || !d.type) return;

      switch (d.type) {
        case 'VERUM_CONNECT_RESPONSE':
        case 'VERUM_INIT_RESPONSE':
          if (d.publicKey) {
            bridge.__setConnected(d.publicKey);
            if (d.id) settleBridge(d.id, { publicKey: d.publicKey });
            _publicKey = d.publicKey; _isConnected = true;
            notifyStatus('connected', d.publicKey);
            emitConnector('connected', d.publicKey);
            dispatchConnected(d.publicKey);
          }
          break;

        case 'VERUM_CONNECT_REJECTED':
          if (d.id) settleBridge(d.id, null, new Error(d.reason || 'USER_REJECTED'));
          break;

        case 'VERUM_SIGN_TX_RESPONSE':
          if (d.id) settleBridge(d.id, d.signedTransaction);
          break;
        case 'VERUM_SIGN_TX_REJECTED':
          if (d.id) settleBridge(d.id, null, new Error(d.reason || 'USER_REJECTED'));
          break;

        case 'VERUM_SIGN_ALL_RESPONSE':
          if (d.id) settleBridge(d.id, d.signedTransactions);
          break;
        case 'VERUM_SIGN_ALL_REJECTED':
          if (d.id) settleBridge(d.id, null, new Error(d.reason || 'USER_REJECTED'));
          break;

        case 'VERUM_SIGN_MSG_RESPONSE':
          if (d.id) settleBridge(d.id, { signature: d.signature, publicKey: d.publicKey });
          break;
        case 'VERUM_SIGN_MSG_REJECTED':
          if (d.id) settleBridge(d.id, null, new Error(d.reason || 'USER_REJECTED'));
          break;
      }
    });

    // Handshake: pergunta ao pai se já existe sessão ativa (fast connect).
    postToParent({ type: 'VERUM_INIT_REQUEST', origin: window.location.origin });
  }

  // ─── Resolução do provider ────────────────────────────────────────────────────

  function resolveProvider() {
    if (window.verum && window.verum.isVerum) return window.verum;
    if (window.solana && window.solana.isVerum) return window.solana;
    return null;
  }

  // ─── API pública window.verumConnector ────────────────────────────────────────

  var connector = {
    get publicKey()   { return _publicKey;   },
    get isConnected() { return _isConnected; },
    get wallet()      { return _wallet;      },

    on: function (event, cb) {
      (_cEvents[event] || (_cEvents[event] = [])).push(cb);
      return connector;
    },
    off: function (event, cb) {
      if (_cEvents[event]) _cEvents[event] = _cEvents[event].filter(function (f) { return f !== cb; });
      return connector;
    },

    init: async function (onStatusChange) {
      _onStatus = onStatusChange || null;
      log('Inicializando...', { bridgeMode: _bridgeMode, hasInjected: _hasInjected });

      var provider = resolveProvider();
      if (!provider) { log('Verum Wallet não detectada neste ambiente.'); return false; }
      _wallet = provider;

      // Já conectado (sessão ativa / push do pai) — avisa o portal.
      if (provider.connected && provider.publicKey) {
        _publicKey = provider.publicKey.toString();
        _isConnected = true;
        notifyStatus('connected', _publicKey);
        emitConnector('connected', _publicKey);
      }

      // Eventos do provider injetado/ponte.
      if (typeof provider.on === 'function') {
        provider.on('connect', function (pk) {
          _publicKey = pk ? pk.toString() : null; _isConnected = true;
          notifyStatus('connected', _publicKey);
          emitConnector('connected', _publicKey);
        });
        provider.on('disconnect', function () {
          _publicKey = null; _isConnected = false;
          notifyStatus('disconnected', null);
          emitConnector('disconnected', null);
        });
        provider.on('accountChanged', function (pk) {
          _publicKey = pk ? pk.toString() : null;
          notifyStatus('connected', _publicKey);
          emitConnector('connected', _publicKey);
        });
      }

      window.addEventListener('verum#connected', function (e) {
        if (e.detail && e.detail.publicKey) {
          _publicKey = e.detail.publicKey; _isConnected = true;
          notifyStatus('connected', _publicKey);
          emitConnector('connected', _publicKey);
        }
      });

      return true;
    },

    connect: async function () {
      if (!_wallet) _wallet = resolveProvider();
      if (!_wallet) throw new Error('Wallet não inicializada.');
      if (_isConnected && _publicKey) return _publicKey;

      var resp = await _wallet.connect();
      var pk = resp && resp.publicKey ? resp.publicKey.toString() : null;
      if (pk) { _publicKey = pk; _isConnected = true; notifyStatus('connected', pk); emitConnector('connected', pk); }
      return pk;
    },

    disconnect: async function () {
      if (_wallet) { try { await _wallet.disconnect(); } catch (e) {} }
      _publicKey = null; _isConnected = false;
      notifyStatus('disconnected', null);
      emitConnector('disconnected', null);
    },
  };

  window.verumConnector = connector;
  log('Pronto.');
})();
