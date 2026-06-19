import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  // useSettings can throw if Provider isn't mounted (e.g., very early crashes).
  // Fall back to English literals in that case so the screen never blanks.
  let translate: (k: string) => string;
  try {
    translate = useSettings().t;
  } catch {
    translate = (k: string) => {
      const EN_FALLBACK: Record<string, string> = {
        'Algo deu errado': 'Something went wrong',
        'Encontramos um erro inesperado. Sua carteira está segura — nenhuma transação foi enviada. Toque em "Tentar novamente" abaixo.':
          'We hit an unexpected error. Your wallet is safe — no transaction was sent. Tap "Try again" below.',
        'Tentar novamente': 'Try again',
      };
      return EN_FALLBACK[k] || k;
    };
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{translate('Algo deu errado')}</Text>
        <Text style={styles.subtitle}>
          {translate('Encontramos um erro inesperado. Sua carteira está segura — nenhuma transação foi enviada. Toque em "Tentar novamente" abaixo.')}
        </Text>
        {__DEV__ && (
          <Text style={styles.devError} selectable>
            {error.message}
          </Text>
        )}
        <TouchableOpacity style={styles.btn} onPress={onReset} activeOpacity={0.85}>
          <Text style={styles.btnText}>{translate('Tentar novamente')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return <ErrorFallback error={error} onReset={this.reset} />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  title: {
    fontFamily: F.title,
    color: V.gold,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: F.semi,
    color: V.text,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  devError: {
    fontFamily: F.semi,
    color: V.danger,
    fontSize: 12,
    backgroundColor: V.surface1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: V.gold,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: F.bold,
    color: V.bg,
    fontSize: 15,
  },
});
