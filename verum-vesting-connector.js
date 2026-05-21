/**
 * VerumVestingConnector v2
 *
 * Script incluído pelo portal vesting.verumcrypto.com para integrar com a
 * Verum Wallet. Detecta window.verum (injetado pelo app nativo via WebView)
 * e realiza a conexão automaticamente quando existe sessão ativa.
 *
 * Protocolo de comunicação:
 *  - Mobile (WebView): window.verum está disponível; usa ReactNativeWebView bridge
 *  - Web (iframe): window.verum está disponível; usa postMessage cross-origin
 *
 * Uso no portal vesting:
 *   <script src="verum-vesting-connector.js"></script>
 *   await window.verumConnector.init(onStatusChange);
 */

(function () {
  'use strict';

  // Evita inicialização dupla
  if (window.verumConnector) return;

  var PROVIDER_TIMEOUT_MS = 3000;

  // ─── Estado interno ─────────────────────────────────────────────────────────

  var _wallet      = null;
  var _publicKey   = null;
  var _isConnected = false;
  var _onStatus    = null;
  var _pending     = {}; // Fila para postMessage cross-origin

  // ─── Utilitários ───────────────────────────────────────────────────────────

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

  // Gera ID de request usando CSPRNG do navegador (não Math.random — previsível).
  // Arquivo é JS plain carregado pelo portal; não pode importar módulos do bundle.
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
    // Fallback defensivo — em browsers modernos jamais alcançado.
    return 'vc' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  // ─── Detecção do ambiente ──────────────────────────────────────────────────

  var _isWebView = typeof window.ReactNativeWebView !== 'undefined';
  var _isIframe  = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  // ─── Detecção do provider ──────────────────────────────────────────────────

  /**
   * Aguarda o provider ser injetado pelo app nativo (event 'verum#initialized')
   * ou retorna imediatamente se já estiver disponível.
   */
  function waitForProvider() {
    return new Promise(function (resolve) {
      // Provider já disponível (Mobile / Injeção Direta)
      if (window.verum && window.verum.isVerum) {
        return resolve(window.verum);
      }
      if (window.solana && window.solana.isVerum) {
        return resolve(window.solana);
      }

      // Se for Iframe e não encontrou provider injetado, cria o Mock Provider
      if (_isIframe && !_isWebView) {
        log('Ambiente iframe detectado. Criando ponte postMessage...');
        return resolve(createMockProvider());
      }

      var timer = null;
      var onInit = function () {
        clearTimeout(timer);
        var provider = (window.verum && window.verum.isVerum)
          ? window.verum
          : (window.solana && window.solana.isVerum ? window.solana : null);
        resolve(provider);
      };

      window.addEventListener('verum#initialized', onInit, { once: true });
      document.addEventListener('verum#initialized', onInit, { once: true });

      timer = setTimeout(function () {
        window.removeEventListener('verum#initialized', onInit);
        document.removeEventListener('verum#initialized', onInit);
        var provider = (window.verum && window.verum.isVerum)
          ? window.verum
          : (window.solana && window.solana.isVerum ? window.solana : null);
        
        if (!provider && _isIframe) {
           log('Timeout na injeção. Usando ponte postMessage.');
           return resolve(createMockProvider());
        }
        resolve(provider);
      }, PROVIDER_TIMEOUT_MS);
    });
  }

  /**
   * Cria um mock do window.verum para funcionar via postMessage
   * quando o portal está em um iframe no navegador.
   */
  function createMockProvider() {
    var mock = {
      isVerum:     true,
      isConnected: false,
      publicKey:   null,
      
      _events: {},
      on:   function(e, cb) { (this._events[e] || (this._events[e] = [])).push(cb); },
      emit: function(e, d) { (this._events[e] || []).forEach(function(f){ f(d); }); },

      connect: function() {
        return new Promise(function(resolve, reject) {
          var id = nextId();
          _pending[id] = { resolve: resolve, reject: reject };
          window.parent.postMessage({ type: 'VERUM_CONNECT_REQUEST', id: id, origin: window.location.origin }, '*');
        });
      },

      disconnect: function() {
        window.parent.postMessage({ type: 'VERUM_DISCONNECT', origin: window.location.origin }, '*');
        this.isConnected = false;
        this.publicKey = null;
        this.emit('disconnect');
        return Promise.resolve();
      },

      signTransaction: function(tx) {
        // Nota: O portal precisa converter a transação para Base64 antes (ou o conector faz)
        // Como o Mock é interno, assumimos que o app pai lidará com o formato.
        return Promise.reject('Método não suportado via bridge direto. Use o adaptador oficial se possível.');
      }
    };

    // Escuta respostas do app pai
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || typeof d !== 'object' || !d.type) return;

      log('Recebeu mensagem do pai:', d.type);

      if (d.type === 'VERUM_CONNECT_RESPONSE' || d.type === 'VERUM_INIT_RESPONSE') {
        mock.isConnected = true;
        mock.publicKey   = d.publicKey;
        // Se for resposta a um request pendente (connect)
        if (d.id && _pending[d.id]) {
          _pending[d.id].resolve({ publicKey: d.publicKey });
          delete _pending[d.id];
        }
        // Emite eventos
        mock.emit('connect', d.publicKey);
        window.dispatchEvent(new CustomEvent('verum#connected', { detail: { publicKey: d.publicKey } }));
      }
      
      if (d.type === 'VERUM_CONNECT_REJECTED') {
        if (d.id && _pending[d.id]) {
          _pending[d.id].reject(d.reason || 'USER_REJECTED');
          delete _pending[d.id];
        }
      }
    });

    // Solicita estado inicial ao carregar (Handshake)
    window.parent.postMessage({ type: 'VERUM_INIT_REQUEST', origin: window.location.origin }, '*');

    return mock;
  }

  // ─── Handlers de estado ────────────────────────────────────────────────────

  function onConnected(pk) {
    _publicKey   = pk ? pk.toString() : null;
    _isConnected = true;
    log('Estado: Conectado', _publicKey);
    notifyStatus('connected', _publicKey);
  }

  function onDisconnected() {
    _publicKey   = null;
    _isConnected = false;
    log('Estado: Desconectado');
    notifyStatus('disconnected', null);
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  var connector = {
    get publicKey()   { return _publicKey;   },
    get isConnected() { return _isConnected; },
    get wallet()      { return _wallet;      },

    init: async function (onStatusChange) {
      _onStatus = onStatusChange || null;
      log('Inicializando conector...');

      var provider = await waitForProvider();

      if (!provider) {
        log('Verum Wallet não detectada.');
        return false;
      }

      _wallet = provider;
      
      // Estado atual
      if (_wallet.isConnected && _wallet.publicKey) {
        onConnected(_wallet.publicKey.toString());
      }

      // Eventos
      if (typeof _wallet.on === 'function') {
        _wallet.on('connect',    function (pk) { onConnected(pk); });
        _wallet.on('disconnect', onDisconnected);
        _wallet.on('accountChanged', function (pk) { onConnected(pk); });
      }

      window.addEventListener('verum#connected', function (e) {
        if (e.detail && e.detail.publicKey) onConnected(e.detail.publicKey);
      });

      return true;
    },

    connect: async function () {
      if (!_wallet) throw new Error('Wallet não inicializada.');
      if (_isConnected && _publicKey) return _publicKey;

      try {
        var resp = await _wallet.connect({ onlyIfTrusted: true }).catch(function () {
          return _wallet.connect();
        });
        var pk = resp && resp.publicKey ? resp.publicKey.toString() : null;
        if (pk) onConnected(pk);
        return pk;
      } catch (err) {
        log('Erro na conexão:', err);
        throw err;
      }
    },

    disconnect: async function () {
      if (_wallet) try { await _wallet.disconnect(); } catch (e) {}
      onDisconnected();
    },
  };

  window.verumConnector = connector;
  log('Pronto.');
})();
