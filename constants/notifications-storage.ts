import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATIONS_ENABLED_KEY = 'notifications_enabled';

/**
 * Saves the notification enabled state to persistent storage.
 * @param enabled - Boolean indicating if notifications should be enabled.
 */
export const setNotificationsEnabled = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, JSON.stringify(enabled));
  } catch (error) {
    console.error('Error saving notification setting:', error);
  }
};

/**
 * Retrieves the notification enabled state from persistent storage.
 * Defaults to true if no value is found.
 * @returns A promise that resolves to a boolean.
 */
export const getNotificationsEnabled = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    return value !== null ? JSON.parse(value) : true;
  } catch (error) {
    console.error('Error loading notification setting:', error);
    return true;
  }
};
