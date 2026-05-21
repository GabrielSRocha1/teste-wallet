import AsyncStorage from '@react-native-async-storage/async-storage';

// Por padrão, retornamos true (modo escuro) caso o usuário nunca tenha alterado
export const getIsDarkMode = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem('isDarkMode');
    return value !== null ? JSON.parse(value) : true;
  } catch (e) {
    return true;
  }
};

export const setIsDarkModeStorage = async (isDark: boolean) => {
  try {
    await AsyncStorage.setItem('isDarkMode', JSON.stringify(isDark));
  } catch (e) {
    console.error('Erro ao salvar preferência de tema', e);
  }
};
