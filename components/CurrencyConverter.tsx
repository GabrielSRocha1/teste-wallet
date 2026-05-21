import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Image, ActivityIndicator } from 'react-native';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

interface CurrencyRates {
  USD: number;
  BRL: number;
  PYG: number;
}

interface CurrencyConverterProps {
  onUSDValueChange?: (value: string) => void;
  onBRLValueChange?: (value: string) => void;
  onCurrencyValueChange?: (value: string, symbol: string, currency: 'USD' | 'BRL' | 'PYG') => void;
  initialUSD?: number;
  initialBRL?: number;
  value?: string; // Valor em USD vindo de fora (sincronização)
}

export default function CurrencyConverter({ 
  onUSDValueChange, 
  onBRLValueChange, 
  onCurrencyValueChange, 
  initialUSD, 
  initialBRL,
  value 
}: CurrencyConverterProps) {
  const { t, currency } = useSettings();
  const [rates, setRates] = useState<CurrencyRates>({ USD: 1, BRL: 5.10, PYG: 7300 });
  const [loading, setLoading] = useState(true);
  
  // Single source of truth: the value in USD
  const [baseUSD, setBaseUSD] = useState<string>(() => {
    if (value !== undefined) return value;
    if (initialUSD !== undefined) return initialUSD.toString();
    if (initialBRL !== undefined) return (initialBRL / 5.10).toString();
    return '';
  });
  
  // Control which input is being edited to avoid loops
  const [activeInput, setActiveInput] = useState<'USD' | 'BRL' | 'PYG' | null>(null);

  // States for display (to handle raw text input correctly)
  const [usdText, setUsdText] = useState(() => {
    if (!baseUSD) return '';
    return parseFloat(baseUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  const [brlText, setBrlText] = useState(() => {
    if (!baseUSD) return '';
    return (parseFloat(baseUSD) * rates.BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  const [pygText, setPygText] = useState(() => {
    if (!baseUSD) return '';
    return Math.round(parseFloat(baseUSD) * rates.PYG).toLocaleString('es-PY');
  });

  // Fetch rates on mount
  useEffect(() => {
    const fetchRates = async () => {
      try {
        const response = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,USD-PYG');
        const data = await response.json();
        
        if (data.USDBRL && data.USDPYG) {
          setRates({
            USD: 1,
            BRL: parseFloat(data.USDBRL.bid),
            PYG: parseFloat(data.USDPYG.bid),
          });
        }
      } catch (error) {
        console.warn('Erro ao buscar taxas de câmbio:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRates();
  }, []);

  // Update baseUSD when value prop changes (external sync)
  useEffect(() => {
    if (value !== undefined && activeInput === null) {
      setBaseUSD(value);
    }
  }, [value]);

  // Update other fields when baseUSD changes, but only if they are NOT active
  useEffect(() => {
    // Notify parent (limita a 2 casas decimais)
    if (onUSDValueChange && activeInput !== null) {
        const numericVal = parseFloat(baseUSD);
        const currentParentVal = parseFloat(value || '');
        
        // Só notifica se houver mudança numérica real e se for o input ativo (evita loops)
        if (!isNaN(numericVal)) {
            if (numericVal.toFixed(2) !== currentParentVal.toFixed(2)) {
                onUSDValueChange(numericVal.toFixed(2));
            }
        } else if (value !== '') {
            onUSDValueChange('');
        }
    }

    if (onBRLValueChange) {
        const numericVal = parseFloat(baseUSD);
        if (!isNaN(numericVal)) {
            onBRLValueChange((numericVal * rates.BRL).toFixed(2));
        } else {
            onBRLValueChange('');
        }
    }

    if (!baseUSD || baseUSD === '') {
      if (activeInput !== 'USD') setUsdText('');
      if (activeInput !== 'BRL') setBrlText('');
      if (activeInput !== 'PYG') setPygText('');
      return;
    }

  }, [baseUSD, rates, activeInput, currency, onUSDValueChange, onBRLValueChange, value]);

  // Sincronizar os estados de texto quando o baseUSD muda externamente ou internamente
  useEffect(() => {
    if (!baseUSD || baseUSD === '') {
      setUsdText('');
      setBrlText('');
      setPygText('');
      if (onCurrencyValueChange && activeInput) {
        const symbol = activeInput === 'USD' ? '$' : activeInput === 'BRL' ? 'R$' : '₲';
        onCurrencyValueChange('', symbol, activeInput);
      }
      return;
    }

    const val = parseFloat(baseUSD);
    if (isNaN(val)) return;

    let newUsd = usdText;
    let newBrl = brlText;
    let newPyg = pygText;

    if (activeInput !== 'USD') {
      newUsd = val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      setUsdText(newUsd);
    }
    if (activeInput !== 'BRL') {
      newBrl = (val * rates.BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      setBrlText(newBrl);
    }
    if (activeInput !== 'PYG') {
      newPyg = Math.round(val * rates.PYG).toLocaleString('es-PY');
      setPygText(newPyg);
    }

    // Sync parent with formatted string on blur / load
    if (onCurrencyValueChange && activeInput === null) {
      if (currency === 'USD') onCurrencyValueChange(newUsd, '$', 'USD');
      else if (currency === 'PYG') onCurrencyValueChange(newPyg, '₲', 'PYG');
      else onCurrencyValueChange(newBrl, 'R$', 'BRL');
    }
  }, [baseUSD, rates, activeInput, currency]);

  // Handle initial values after rates are loaded
  useEffect(() => {
    if (!loading && baseUSD === '') {
      if (initialBRL !== undefined) {
        setBaseUSD((initialBRL / rates.BRL).toString());
      } else if (initialUSD !== undefined) {
        setBaseUSD(initialUSD.toString());
      }
    }
  }, [loading]);

  const handleTextChange = (text: string, type: 'USD' | 'BRL' | 'PYG') => {
    // Remove tudo que não for número, ponto ou vírgula
    let cleanText = text.replace(/[^0-9.,]/g, '');
    if (type === 'PYG') {
        cleanText = text.replace(/[^0-9]/g, '');
    }
    
    // Notify parent immediately about what is being typed
    if (onCurrencyValueChange) {
        const symbol = type === 'USD' ? '$' : type === 'BRL' ? 'R$' : '₲';
        onCurrencyValueChange(cleanText, symbol, type);
    }
    
    if (type === 'USD') {
      setUsdText(cleanText);
      const val = parseFloat(cleanText.replace(',', ''));
      if (!isNaN(val)) setBaseUSD(val.toString());
      else setBaseUSD('');
    } else if (type === 'BRL') {
      setBrlText(cleanText);
      // Converte vírgula brasileira para ponto decimal para o cálculo
      const numericStr = cleanText.replace(/\./g, '').replace(',', '.');
      const val = parseFloat(numericStr);
      if (!isNaN(val)) setBaseUSD((val / rates.BRL).toString());
      else setBaseUSD('');
    } else if (type === 'PYG') {
      if (cleanText === '') {
          setPygText('');
          setBaseUSD('');
          return;
      }
      const val = parseInt(cleanText.replace(/\./g, ''), 10);
      if (!isNaN(val)) {
          setPygText(val.toLocaleString('es-PY'));
          setBaseUSD((val / rates.PYG).toString());
      }
    }

    if (cleanText === '') setBaseUSD('');
  };

  const getHighlightStyle = (type: 'USD' | 'BRL' | 'PYG') => {
    if (currency !== type) return null;
    if (type === 'USD') return styles.usdHighlight;
    if (type === 'BRL') return styles.brlHighlight;
    if (type === 'PYG') return styles.pygHighlight;
    return null;
  };

  const getSymbolColor = (type: 'USD' | 'BRL' | 'PYG') => {
    if (currency !== type) return {};
    if (type === 'USD') return { color: '#60a5fa' };
    if (type === 'BRL') return { color: V.gold };
    if (type === 'PYG') return { color: V.success };
    return {};
  };

  const renderInput = (label: string, symbol: string, value: string, type: 'USD' | 'BRL' | 'PYG', flag: any) => {
    const curSymbol = type === 'USD' ? '$' : type === 'BRL' ? 'R$' : '₲';
    
    return (
      <View style={[styles.inputWrapper, getHighlightStyle(type)]}>
        <View style={styles.currencyInfo}>
          <Image source={flag} style={styles.flagIcon} />
          <Text style={styles.currencyLabel}>{symbol}</Text>
        </View>
        <View style={styles.inputRow}>
          <Text style={[styles.symbolPrefix, activeInput === type ? { color: V.gold } : getSymbolColor(type)]}>{curSymbol}</Text>
          <TextInput
            style={[styles.input, activeInput === type ? styles.activeInput : getSymbolColor(type)]}
            value={value}
            onChangeText={(text) => handleTextChange(text, type)}
            onFocus={() => setActiveInput(type)}
            onBlur={() => {
                setActiveInput(null);
                const val = parseFloat(baseUSD);
                if (!isNaN(val)) {
                    if (type === 'USD') setUsdText(val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                    if (type === 'BRL') setBrlText((val * rates.BRL).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                    if (type === 'PYG') setPygText(Math.round(val * rates.PYG).toLocaleString('es-PY'));
                }
            }}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor="#94a3b8"
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('Calculadora de Câmbio')}</Text>
          <Text style={styles.subtitle}>{t('(Digite o valor no campo da moeda desejada)')}</Text>
        </View>
        {loading && <ActivityIndicator size="small" color={V.gold} />}
      </View>

      <View style={styles.converterBox}>
        {renderInput(t('Dólar Americano'), 'USD', usdText, 'USD', { uri: 'https://flagcdn.com/w80/us.png' })}
        {renderInput(t('Real Brasileiro'), 'BRL', brlText, 'BRL', { uri: 'https://flagcdn.com/w80/br.png' })}
        {renderInput(t('Guarani Paraguaio'), 'PYG', pygText, 'PYG', { uri: 'https://flagcdn.com/w80/py.png' })}
      </View>
      
      {!loading && (
          <Text style={styles.rateInfo}>
            1 USD ≈ R$ {rates.BRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 1 USD ≈ ₲ {rates.PYG.toLocaleString('es-PY')}
          </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: V.border,
    marginBottom: 24,
    ...V.shadow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: V.gold,
    fontSize: 14,
    fontFamily: F.title,
    letterSpacing: 1,
  },
  subtitle: {
    color: V.muted,
    fontSize: 10,
    fontFamily: F.semi,
    marginTop: 4,
    marginBottom: 16,
  },
  converterBox: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  inputWrapper: {
    flex: 1,
    minWidth: 0,
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    padding: 12,
    borderWidth: 1,
    borderColor: V.border,
    minHeight: 80,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  brlHighlight: {
    borderColor: V.gold,
    backgroundColor: 'rgba(201, 168, 76, 0.08)',
    borderWidth: 1.5,
  },
  usdHighlight: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.06)',
    borderWidth: 1.5,
  },
  pygHighlight: {
    borderColor: V.success,
    backgroundColor: 'rgba(46,204,113,0.06)',
    borderWidth: 1.5,
  },
  currencyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  flagIcon: {
    width: 20,
    height: 14,
    borderRadius: 2,
  },
  currencyLabel: {
    color: V.text,
    fontSize: 12,
    fontFamily: F.bold,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  symbolPrefix: {
    color: V.text,
    fontSize: 16,
    fontFamily: F.bold,
  },
  input: {
    flex: 1,
    height: '100%',
    backgroundColor: 'transparent',
    minWidth: 0,
    color: V.text,
    fontSize: 16,
    fontFamily: F.bold,
    textAlign: 'left',
    padding: 0,
    outlineStyle: 'none' as any,
  },
  activeInput: {
    color: V.gold,
  },
  rateInfo: {
    color: V.muted,
    fontSize: 10,
    fontFamily: F.body,
    textAlign: 'center',
    marginTop: 14,
  }
});
