import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { Database, Row } from '../types/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

console.log('[Supabase] Configurado com URL:', supabaseUrl);
console.log('[Supabase] Chave Anon presente:', !!supabaseAnonKey, supabaseAnonKey.substring(0, 10) + '...');

// Mock storage for Node/Pre-rendering environment
const noopStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

// Custom storage selection
const getAuthStorage = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return noopStorage;
  }
  return AsyncStorage;
};

/**
 * Cliente Supabase tipado com o schema completo do banco.
 *
 * Uso:
 *   supabase.from('usuarios').select('*')     // ← autocomplete de tabelas
 *   supabase.from('notificacoes').insert({...}) // ← tipos validados
 *   supabase.rpc('get_all_balances', {...})     // ← args + retorno tipados
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getAuthStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Fix: Prevent "Lock broken by another request with the 'steal' option"
    // By providing a custom lock function that skips browser Web Locks API on Web
    lock: Platform.OS === 'web' ? (async (name, timeout, fn) => await fn()) : undefined,
  },
});

/** Re-exporta tipos úteis para uso direto nos services */
// Database já está importado no topo; re-exporta para outros módulos
export type { Database } from '../types/database.types';

// Helpers genéricos derivados do schema — re-exportados de database.types.ts
// para manter um único ponto de verdade e suportar Views (ex: transacoes).
export type {
  TableName,
  ViewName,
  Row,
  InsertRow,
  UpdateRow,
  FiatCurrency,
  PriceSource,
  SecurityEventType,
  VestingStatus,
  SwapStatus,
  JsonObject,
} from '../types/database.types';

// Aliases de tabelas específicas para conveniência
export type Usuario         = Row<'usuarios'>;
export type Wallet          = Row<'wallets'>;
export type Balance         = Row<'balances'>;
export type TransactionRow  = Row<'transactions'>;
export type Transacao       = Row<'transactions'>;
export type DepositOrder    = Row<'deposit_orders'>;
export type ContratoVesting = Row<'contratos_vesting'>;
export type VestingRelease  = Row<'vesting_releases'>;
export type SwapOrder       = Row<'swap_orders'>;
export type Notificacao     = Row<'notificacoes'>;
export type ExchangeRate    = Row<'exchange_rates'>;
export type UserPreference  = Row<'user_preferences'>;
export type SecurityLog     = Row<'security_logs'>;
export type MarketData      = Row<'market_data'>;
export type PriceFeed       = Row<'price_feeds'>;
export type SupportedToken  = Row<'supported_tokens'>;
