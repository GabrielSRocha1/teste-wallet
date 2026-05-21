import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
import 'react-native-url-polyfill/auto';

// Polyfill DOM Event / EventTarget for Hermes — required by @wallet-standard/wallet
// (RegisterWalletEvent extends Event at module load time and crashes otherwise).
import { EventTarget as ETShim } from 'event-target-shim';

if (typeof globalThis.EventTarget === 'undefined') {
  globalThis.EventTarget = ETShim;
}

if (typeof globalThis.Event === 'undefined') {
  class Event {
    constructor(type, init) {
      // Backing `_type` so subclasses can override `get type()` without
      // failing on the prototype getter (AppReadyEvent does this).
      this._type = String(type);
      this.bubbles = !!(init && init.bubbles);
      this.cancelable = !!(init && init.cancelable);
      this.composed = !!(init && init.composed);
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.timeStamp = Date.now();
    }
    get type() {
      return this._type;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {}
    stopImmediatePropagation() {}
  }
  globalThis.Event = Event;
}

if (typeof globalThis.CustomEvent === 'undefined') {
  class CustomEvent extends globalThis.Event {
    constructor(type, init) {
      super(type, init);
      this.detail = init && 'detail' in init ? init.detail : null;
    }
  }
  globalThis.CustomEvent = CustomEvent;
}

// Polyfill AbortSignal.timeout — algumas versões do Hermes não trazem.
// É usado nos fetch de swap (cambio.tsx) com timeout de 10s.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function (ms) {
    const controller = new AbortController();
    setTimeout(() => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      controller.abort(err);
    }, ms);
    return controller.signal;
  };
}

// Nota: NÃO patchamos window.addEventListener/dispatchEvent.
// O @wallet-standard/app já tem try/catch em torno dessas chamadas
// (registers fallam com console.error benigno em RN). Patchar essas
// funções interfere com o sistema de SyntheticEvent do React Native
// e gera warnings em massa sobre eventos reusados.
