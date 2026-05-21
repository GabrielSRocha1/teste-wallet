import AsyncStorage from '@react-native-async-storage/async-storage';

export const setBiometricsEnabled = async (enabled: boolean) => {
  await AsyncStorage.setItem('biometricsEnabled', JSON.stringify(enabled));
  if (!enabled) {
    await clearLastAuthTime();
  }
};

export const getBiometricsEnabled = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem('biometricsEnabled');
  return value ? JSON.parse(value) : false;
};

export const setAuthFrequency = async (freq: string) => {
  await AsyncStorage.setItem('authFrequency', freq);
};

export const getAuthFrequency = async (): Promise<string> => {
  return (await AsyncStorage.getItem('authFrequency')) || 'always';
};

export const updateLastAuthTime = async () => {
  await AsyncStorage.setItem('lastAuthTime', Date.now().toString());
};

export const clearLastAuthTime = async () => {
  await AsyncStorage.removeItem('lastAuthTime');
};

export const getLastAuthTime = async (): Promise<number> => {
  const value = await AsyncStorage.getItem('lastAuthTime');
  return value ? parseInt(value) : 0;
};

export const requiresAuthentication = async (): Promise<boolean> => {
  const enabled = await getBiometricsEnabled();
  if (!enabled) return false;

  const freq = await getAuthFrequency();
  if (freq === 'never') return false;
  if (freq === 'always') return true;

  const lastTime = await getLastAuthTime();
  const timePassed = Date.now() - lastTime;

  const intervals: Record<string, number> = {
    '1min': 60000,
    '5min': 300000,
    '10min': 600000,
    '15min': 900000,
    '30min': 1800000,
    '1hour': 3600000,
    '4hours': 14400000,
    '8hours': 28800000,
    '24hours': 86400000,
  };

  const intervalAllowed = intervals[freq] || 0;
  return timePassed >= intervalAllowed;
};

