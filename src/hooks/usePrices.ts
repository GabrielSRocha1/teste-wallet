import { useSettings } from '../../constants/SettingsContext';

export type { SupportedCurrency } from '../../constants/SettingsContext';

export function usePrices() {
  const { prices, convertToCrypto } = useSettings();
  
  // O loading e error agora podem ser omitidos ou buscados se adicionarmos ao context
  // Por enquanto, consideramos que os preços estão sempre disponíveis ou sendo atualizados no fundo
  return { 
    prices, 
    loading: Object.keys(prices).length === 0, 
    error: null, 
    convertToCrypto 
  };
}

export default usePrices;
