import type { Currency } from '@/constants/settings-storage';
import type { ImageSourcePropType } from 'react-native';

export interface CurrencyOption {
  code: Currency;
  /** Emoji flag — preservado por compat; UI usa `flagAsset` por causa do Android. */
  flag: string;
  /** PNG da bandeira via flagcdn.com (fallback online). */
  flagUrl: string;
  /** PNG bundlado em assets/flags — funciona offline. */
  flagAsset: ImageSourcePropType;
  nativeName: string;
  englishName: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', flag: '🇺🇸', flagUrl: 'https://flagcdn.com/w80/us.png', flagAsset: require('../assets/flags/us.png'), nativeName: 'US Dollar',           englishName: 'US Dollar' },
  { code: 'EUR', flag: '🇪🇺', flagUrl: 'https://flagcdn.com/w80/eu.png', flagAsset: require('../assets/flags/eu.png'), nativeName: 'Euro',                englishName: 'Euro' },
  { code: 'BRL', flag: '🇧🇷', flagUrl: 'https://flagcdn.com/w80/br.png', flagAsset: require('../assets/flags/br.png'), nativeName: 'Real Brasileiro',     englishName: 'Brazilian Real' },
  { code: 'PYG', flag: '🇵🇾', flagUrl: 'https://flagcdn.com/w80/py.png', flagAsset: require('../assets/flags/py.png'), nativeName: 'Guaraní Paraguayo',   englishName: 'Paraguayan Guarani' },
  { code: 'CNY', flag: '🇨🇳', flagUrl: 'https://flagcdn.com/w80/cn.png', flagAsset: require('../assets/flags/cn.png'), nativeName: '人民币',                englishName: 'Chinese Yuan' },
  { code: 'JPY', flag: '🇯🇵', flagUrl: 'https://flagcdn.com/w80/jp.png', flagAsset: require('../assets/flags/jp.png'), nativeName: '日本円',                englishName: 'Japanese Yen' },
  { code: 'KRW', flag: '🇰🇷', flagUrl: 'https://flagcdn.com/w80/kr.png', flagAsset: require('../assets/flags/kr.png'), nativeName: '대한민국 원',           englishName: 'South Korean Won' },
  { code: 'RUB', flag: '🇷🇺', flagUrl: 'https://flagcdn.com/w80/ru.png', flagAsset: require('../assets/flags/ru.png'), nativeName: 'Российский рубль',    englishName: 'Russian Ruble' },
  { code: 'SAR', flag: '🇸🇦', flagUrl: 'https://flagcdn.com/w80/sa.png', flagAsset: require('../assets/flags/sa.png'), nativeName: 'ريال سعودي',          englishName: 'Saudi Riyal' },
  { code: 'INR', flag: '🇮🇳', flagUrl: 'https://flagcdn.com/w80/in.png', flagAsset: require('../assets/flags/in.png'), nativeName: 'भारतीय रुपया',           englishName: 'Indian Rupee' },
  { code: 'TRY', flag: '🇹🇷', flagUrl: 'https://flagcdn.com/w80/tr.png', flagAsset: require('../assets/flags/tr.png'), nativeName: 'Türk Lirası',         englishName: 'Turkish Lira' },
  { code: 'PLN', flag: '🇵🇱', flagUrl: 'https://flagcdn.com/w80/pl.png', flagAsset: require('../assets/flags/pl.png'), nativeName: 'Złoty polski',        englishName: 'Polish Zloty' },
];

export const getCurrencyOption = (code: Currency): CurrencyOption => {
  return SUPPORTED_CURRENCIES.find(c => c.code === code) || SUPPORTED_CURRENCIES[0];
};
