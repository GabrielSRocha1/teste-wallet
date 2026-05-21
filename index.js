import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import 'react-native-url-polyfill/auto';

// Polyfills globais antes de qualquer outro import
global.Buffer = Buffer;

// Não sobrescrever o process completamente se ele já existir (para não quebrar envs do Expo)
if (typeof global.process === 'undefined') {
  global.process = require('process');
} else {
  // Se existir, garantimos que tem as funções básicas que libs esperam
  const shimProcess = require('process');
  for (const key in shimProcess) {
    if (!(key in global.process)) {
      global.process[key] = shimProcess[key];
    }
  }
}
// Removida a linha global.crypto = require('crypto') que causava conflito no celular

// Algumas libs procuram no window ou em global sem 'global.'
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.process = global.process;
}

// O btoa/atob as vezes é exigido por libs de web3
if (typeof btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof atob === 'undefined') {
  global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}

// Importa a entrada padrão do expo-router
import 'expo-router/entry';
