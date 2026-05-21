import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_STORAGE_KEY = '@VerumCrypto:user';

export const saveUser = async (user: { email: string; fullName?: string | null }) => {
  try {
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch (error) {
    console.error('Error saving user:', error);
  }
};

export const getUser = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem(USER_STORAGE_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
};

export const clearUser = async () => {
  try {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing user:', error);
  }
};
