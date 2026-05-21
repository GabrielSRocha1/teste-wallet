export interface Country {
  name: string;
  flag: string;
  code: string;
  dial_code: string;
}

export const countries: Country[] = [
  { name: 'Brasil', flag: '🇧🇷', code: 'BR', dial_code: '+55' },
  { name: 'Estados Unidos', flag: '🇺🇸', code: 'US', dial_code: '+1' },
  { name: 'Portugal', flag: '🇵🇹', code: 'PT', dial_code: '+351' },
  { name: 'Angola', flag: '🇦🇴', code: 'AO', dial_code: '+244' },
  { name: 'Moçambique', flag: '🇲🇿', code: 'MZ', dial_code: '+258' },
  { name: 'Cabo Verde', flag: '🇨🇻', code: 'CV', dial_code: '+238' },
  { name: 'Guiné-Bissau', flag: '🇬🇼', code: 'GW', dial_code: '+245' },
  { name: 'São Tomé e Príncipe', flag: '🇸🇹', code: 'ST', dial_code: '+239' },
  { name: 'Timor-Leste', flag: '🇹🇱', code: 'TL', dial_code: '+670' },
  { name: 'Guiné Equatorial', flag: '🇬🇶', code: 'GQ', dial_code: '+240' },
  { name: 'Argentina', flag: '🇦🇷', code: 'AR', dial_code: '+54' },
  { name: 'Chile', flag: '🇨🇱', code: 'CL', dial_code: '+56' },
  { name: 'Colômbia', flag: '🇨🇴', code: 'CO', dial_code: '+57' },
  { name: 'México', flag: '🇲🇽', code: 'MX', dial_code: '+52' },
  { name: 'Espanha', flag: '🇪🇸', code: 'ES', dial_code: '+34' },
  { name: 'Reino Unido', flag: '🇬🇧', code: 'GB', dial_code: '+44' },
  { name: 'França', flag: '🇫🇷', code: 'FR', dial_code: '+33' },
  { name: 'Alemanha', flag: '🇩🇪', code: 'DE', dial_code: '+49' },
  { name: 'Itália', flag: '🇮🇹', code: 'IT', dial_code: '+39' },
  { name: 'Japão', flag: '🇯🇵', code: 'JP', dial_code: '+81' },
  { name: 'China', flag: '🇨🇳', code: 'CN', dial_code: '+86' },
  { name: 'Canadá', flag: '🇨🇦', code: 'CA', dial_code: '+1' },
  { name: 'Paraguai', flag: '🇵🇾', code: 'PY', dial_code: '+595' },
  { name: 'Uruguai', flag: '🇺🇾', code: 'UY', dial_code: '+598' },
];
