import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * (C5) Detecta a base URL da API com precedência **env-first**.
 *
 * Antes desta correção, `getApiBaseUrl()` ignorava silenciosamente qualquer
 * `EXPO_PUBLIC_API_URL` que contivesse "localhost" ou "127.0.0.1" — dev que
 * apontasse explicitamente para localhost via .env era sobrescrito pelo
 * detector via `Constants.expoConfig.hostUri`. Inversão indesejada de prioridade.
 *
 * Regra correta:
 *   1. Se `EXPO_PUBLIC_API_URL` está setado (não-vazio), USA — independente do host.
 *      Isso permite override explícito tanto em dev (localhost) quanto em prod (HTTPS).
 *   2. Se não, plataforma web → "http://localhost:3000".
 *   3. Se não, detecta via Expo manifest (Expo Go / device físico).
 */
function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (isNonEmpty(envUrl)) return envUrl.trim();

  if (Platform.OS === 'web') {
    return 'http://localhost:3000';
  }

  // Detect Host IP from Expo manifest (Expo Go / Physical Device)
  const debuggerHost = Constants.expoConfig?.hostUri;
  const ip = debuggerHost ? debuggerHost.split(':')[0] : 'localhost';

  // Default to port 3000 as configured in the user's project
  return `http://${ip}:3000`;
}

/**
 * (C5) Mesma regra `env-first` para o backend de swap.
 */
export function getSwapApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_VERUM_SWAP_BACKEND;
  if (isNonEmpty(envUrl)) return envUrl.trim();

  if (Platform.OS === 'web') {
    return 'http://localhost:3001';
  }

  const debuggerHost = Constants.expoConfig?.hostUri;
  const ip = debuggerHost ? debuggerHost.split(':')[0] : 'localhost';

  return `http://${ip}:3001`;
}

export const API_BASE_URL = getApiBaseUrl();
export const SWAP_API_URL = getSwapApiBaseUrl();
