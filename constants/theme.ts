/**
 * ─────────────────────────────────────────────
 *   VERUM DESIGN SYSTEM — tokens centralizados
 * ─────────────────────────────────────────────
 */
import { Platform } from 'react-native';

// ── Cores ─────────────────────────────────────
export const V = {
  // Backgrounds
  bg:          '#0A0A0A',
  surface1:    '#111111',
  surface2:    '#181818',
  surface3:    '#222222',

  // Gold
  gold:        '#C9A84C',
  goldLight:   '#F0D080',
  goldDark:    '#8A6A1A',

  // Texto
  text:        '#F0E8D0',
  muted:       '#888070',

  // Estado
  success:     '#2ECC71',
  danger:      '#E74C3C',

  // Bordas
  border:      'rgba(201,168,76,0.2)',
  borderFocus: 'rgba(201,168,76,0.5)',

  // Padding lateral global
  px:  20,

  // Border radius
  r8:  8,   // inputs, botões
  r10: 10,  // cards
  r12: 12,  // cards grandes
  r20: 20,  // pills / badges

  // Sombra aurada
  shadow: {
    shadowColor: '#C9A84C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
};

// ── Fontes (nomes registrados via expo-font) ───
export const F = {
  title:  'Cinzel_700Bold',
  body:   'Rajdhani_400Regular',
  medium: 'Rajdhani_500Medium',
  semi:   'Rajdhani_600SemiBold',
  bold:   'Rajdhani_700Bold',
  mono:   Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

// ── Espaçamentos de card ───────────────────────
export const PAD = {
  compact: 14,
  card:    16,
  modal:   36,
};

// ────────────────────────────────────────────────
// Re-export legado (mantém compatibilidade)
export const Colors = {
  light: { text: V.text, background: V.bg, tint: V.gold, icon: V.muted, tabIconDefault: V.muted, tabIconSelected: V.gold },
  dark:  { text: V.text, background: V.bg, tint: V.gold, icon: V.muted, tabIconDefault: V.muted, tabIconSelected: V.gold },
};
