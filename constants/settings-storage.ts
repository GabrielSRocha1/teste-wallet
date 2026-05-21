import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'en' | 'es' | 'pt';
export type Currency = 'USD' | 'BRL' | 'PYG';

const LANGUAGE_KEY = 'user_language';
const CURRENCY_KEY = 'user_currency';
const NETWORK_KEY = '@solana_network';

export const getLanguage = async (): Promise<Language> => {
  const lang = await AsyncStorage.getItem(LANGUAGE_KEY);
  return (lang as Language) || 'pt';
};

export const setLanguage = async (lang: Language) => {
  await AsyncStorage.getItem(LANGUAGE_KEY);
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
};

export const getCurrency = async (): Promise<Currency> => {
  const curr = await AsyncStorage.getItem(CURRENCY_KEY);
  return (curr as Currency) || 'USD';
};

export const setCurrency = async (curr: Currency) => {
  await AsyncStorage.setItem(CURRENCY_KEY, curr);
};

export const getNetwork = async (): Promise<'mainnet' | 'devnet'> => {
  const net = await AsyncStorage.getItem(NETWORK_KEY);
  return (net as any) || 'mainnet';
};

export const setNetwork = async (net: 'mainnet' | 'devnet') => {
  await AsyncStorage.setItem(NETWORK_KEY, net);
};

export const getStorageItem = async (key: string): Promise<string | null> => {
  return await AsyncStorage.getItem(key);
};

export const setStorageItem = async (key: string, value: string) => {
  await AsyncStorage.setItem(key, value);
};

export const removeStorageItem = async (key: string) => {
  await AsyncStorage.removeItem(key);
};

// Preços
const PRICES_CACHE_KEY = '@prices_cache_v2';

export const getPricesCache = async (): Promise<any | null> => {
  const cached = await AsyncStorage.getItem(PRICES_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setPricesCache = async (prices: any) => {
  await AsyncStorage.setItem(PRICES_CACHE_KEY, JSON.stringify(prices));
};

// Saldos (Realtime)
export const getBalancesCache = async (network: string, address: string): Promise<any | null> => {
  const key = `@balances_${network}_${address}`;
  const cached = await AsyncStorage.getItem(key);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setBalancesCache = async (network: string, address: string, balances: any) => {
  const key = `@balances_${network}_${address}`;
  await AsyncStorage.setItem(key, JSON.stringify(balances));
};
