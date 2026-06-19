import type { Language } from '@/constants/settings-storage';
import type { ImageSourcePropType } from 'react-native';

export interface LanguageOption {
  code: Language;
  /** Emoji flag — preservado por compat; Android não renderiza Regional Indicator,
   *  então a UI usa `flagAsset` (PNG bundlado). */
  flag: string;
  /** PNG da bandeira via flagcdn.com — fallback online se algum caller pedir URL. */
  flagUrl: string;
  /** PNG bundlado em assets/flags — funciona offline. Fonte primária da UI. */
  flagAsset: ImageSourcePropType;
  nativeName: string;
  englishName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', flag: '🇺🇸', flagUrl: 'https://flagcdn.com/w80/us.png', flagAsset: require('../assets/flags/us.png'), nativeName: 'English',     englishName: 'English' },
  { code: 'es', flag: '🇪🇸', flagUrl: 'https://flagcdn.com/w80/es.png', flagAsset: require('../assets/flags/es.png'), nativeName: 'Español',     englishName: 'Spanish' },
  { code: 'pt', flag: '🇧🇷', flagUrl: 'https://flagcdn.com/w80/br.png', flagAsset: require('../assets/flags/br.png'), nativeName: 'Português',   englishName: 'Portuguese' },
  { code: 'fr', flag: '🇫🇷', flagUrl: 'https://flagcdn.com/w80/fr.png', flagAsset: require('../assets/flags/fr.png'), nativeName: 'Français',    englishName: 'French' },
  { code: 'de', flag: '🇩🇪', flagUrl: 'https://flagcdn.com/w80/de.png', flagAsset: require('../assets/flags/de.png'), nativeName: 'Deutsch',     englishName: 'German' },
  { code: 'it', flag: '🇮🇹', flagUrl: 'https://flagcdn.com/w80/it.png', flagAsset: require('../assets/flags/it.png'), nativeName: 'Italiano',    englishName: 'Italian' },
  { code: 'zh', flag: '🇨🇳', flagUrl: 'https://flagcdn.com/w80/cn.png', flagAsset: require('../assets/flags/cn.png'), nativeName: '中文',         englishName: 'Chinese' },
  { code: 'ja', flag: '🇯🇵', flagUrl: 'https://flagcdn.com/w80/jp.png', flagAsset: require('../assets/flags/jp.png'), nativeName: '日本語',       englishName: 'Japanese' },
  { code: 'ko', flag: '🇰🇷', flagUrl: 'https://flagcdn.com/w80/kr.png', flagAsset: require('../assets/flags/kr.png'), nativeName: '한국어',       englishName: 'Korean' },
  { code: 'ru', flag: '🇷🇺', flagUrl: 'https://flagcdn.com/w80/ru.png', flagAsset: require('../assets/flags/ru.png'), nativeName: 'Русский',     englishName: 'Russian' },
  { code: 'ar', flag: '🇸🇦', flagUrl: 'https://flagcdn.com/w80/sa.png', flagAsset: require('../assets/flags/sa.png'), nativeName: 'العربية',     englishName: 'Arabic' },
  { code: 'hi', flag: '🇮🇳', flagUrl: 'https://flagcdn.com/w80/in.png', flagAsset: require('../assets/flags/in.png'), nativeName: 'हिन्दी',         englishName: 'Hindi' },
  { code: 'tr', flag: '🇹🇷', flagUrl: 'https://flagcdn.com/w80/tr.png', flagAsset: require('../assets/flags/tr.png'), nativeName: 'Türkçe',      englishName: 'Turkish' },
  { code: 'nl', flag: '🇳🇱', flagUrl: 'https://flagcdn.com/w80/nl.png', flagAsset: require('../assets/flags/nl.png'), nativeName: 'Nederlands',  englishName: 'Dutch' },
  { code: 'pl', flag: '🇵🇱', flagUrl: 'https://flagcdn.com/w80/pl.png', flagAsset: require('../assets/flags/pl.png'), nativeName: 'Polski',      englishName: 'Polish' },
];

export const getLanguageOption = (code: Language): LanguageOption => {
  return SUPPORTED_LANGUAGES.find(l => l.code === code) || SUPPORTED_LANGUAGES[0];
};
