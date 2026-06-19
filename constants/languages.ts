import type { Language } from '@/constants/settings-storage';

export interface LanguageOption {
  code: Language;
  flag: string;
  nativeName: string;
  englishName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', flag: '🇺🇸', nativeName: 'English',     englishName: 'English' },
  { code: 'es', flag: '🇪🇸', nativeName: 'Español',     englishName: 'Spanish' },
  { code: 'pt', flag: '🇧🇷', nativeName: 'Português',   englishName: 'Portuguese' },
  { code: 'fr', flag: '🇫🇷', nativeName: 'Français',    englishName: 'French' },
  { code: 'de', flag: '🇩🇪', nativeName: 'Deutsch',     englishName: 'German' },
  { code: 'it', flag: '🇮🇹', nativeName: 'Italiano',    englishName: 'Italian' },
  { code: 'zh', flag: '🇨🇳', nativeName: '中文',         englishName: 'Chinese' },
  { code: 'ja', flag: '🇯🇵', nativeName: '日本語',       englishName: 'Japanese' },
  { code: 'ko', flag: '🇰🇷', nativeName: '한국어',       englishName: 'Korean' },
  { code: 'ru', flag: '🇷🇺', nativeName: 'Русский',     englishName: 'Russian' },
  { code: 'ar', flag: '🇸🇦', nativeName: 'العربية',     englishName: 'Arabic' },
  { code: 'hi', flag: '🇮🇳', nativeName: 'हिन्दी',         englishName: 'Hindi' },
  { code: 'tr', flag: '🇹🇷', nativeName: 'Türkçe',      englishName: 'Turkish' },
  { code: 'nl', flag: '🇳🇱', nativeName: 'Nederlands',  englishName: 'Dutch' },
  { code: 'pl', flag: '🇵🇱', nativeName: 'Polski',      englishName: 'Polish' },
];

export const getLanguageOption = (code: Language): LanguageOption => {
  return SUPPORTED_LANGUAGES.find(l => l.code === code) || SUPPORTED_LANGUAGES[0];
};
