import { Alert, Platform } from 'react-native';

/**
 * Alerta cross-platform. `Alert.alert` do react-native é um no-op no
 * react-native-web — então no navegador qualquer erro/confirmação some
 * silenciosamente. Aqui usamos `window.alert` no web e `Alert.alert` no nativo.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(text);
    } else {
      console.warn('[notify]', text);
    }
    return;
  }
  Alert.alert(title, message);
}
