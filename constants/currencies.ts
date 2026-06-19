import type { Currency } from '@/constants/settings-storage';

export interface CurrencyOption {
  code: Currency;
  flag: string;
  nativeName: string;
  englishName: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', flag: '🇺🇸', nativeName: 'US Dollar',           englishName: 'US Dollar' },
  { code: 'EUR', flag: '🇪🇺', nativeName: 'Euro',                englishName: 'Euro' },
  { code: 'BRL', flag: '🇧🇷', nativeName: 'Real Brasileiro',     englishName: 'Brazilian Real' },
  { code: 'PYG', flag: '🇵🇾', nativeName: 'Guaraní Paraguayo',   englishName: 'Paraguayan Guarani' },
  { code: 'CNY', flag: '🇨🇳', nativeName: '人民币',                englishName: 'Chinese Yuan' },
  { code: 'JPY', flag: '🇯🇵', nativeName: '日本円',                englishName: 'Japanese Yen' },
  { code: 'KRW', flag: '🇰🇷', nativeName: '대한민국 원',           englishName: 'South Korean Won' },
  { code: 'RUB', flag: '🇷🇺', nativeName: 'Российский рубль',    englishName: 'Russian Ruble' },
  { code: 'SAR', flag: '🇸🇦', nativeName: 'ريال سعودي',          englishName: 'Saudi Riyal' },
  { code: 'INR', flag: '🇮🇳', nativeName: 'भारतीय रुपया',           englishName: 'Indian Rupee' },
  { code: 'TRY', flag: '🇹🇷', nativeName: 'Türk Lirası',         englishName: 'Turkish Lira' },
  { code: 'PLN', flag: '🇵🇱', nativeName: 'Złoty polski',        englishName: 'Polish Zloty' },
];

export const getCurrencyOption = (code: Currency): CurrencyOption => {
  return SUPPORTED_CURRENCIES.find(c => c.code === code) || SUPPORTED_CURRENCIES[0];
};
