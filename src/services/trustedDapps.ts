import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'verum_trusted_dapps';

export interface TrustedDApp {
  origin: string;
  publicKey: string;
  addedAt: number;
}

class TrustedDAppsService {
  private trusted: TrustedDApp[] = [];
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized) return;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        this.trusted = JSON.parse(data);
      }
    } catch (e) {
      console.error('[TrustedDApps] Erro ao carregar:', e);
    }
    this.initialized = true;
  }

  async isTrusted(origin: string, publicKey: string): Promise<boolean> {
    await this.ensureInitialized();
    // Verifica se a combinação origem + chave está na lista
    return this.trusted.some(t => t.origin === origin && t.publicKey === publicKey);
  }

  async addTrusted(origin: string, publicKey: string): Promise<void> {
    await this.ensureInitialized();
    if (await this.isTrusted(origin, publicKey)) return;

    this.trusted.push({
      origin,
      publicKey,
      addedAt: Date.now(),
    });

    await this.save();
    console.log(`[TrustedDApps] '${origin}' marcado como confiável para ${publicKey}`);
  }

  async removeTrusted(origin: string): Promise<void> {
    await this.ensureInitialized();
    this.trusted = this.trusted.filter(t => t.origin !== origin);
    await this.save();
  }

  async clearAll(): Promise<void> {
    this.trusted = [];
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  private async save() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.trusted));
    } catch (e) {
      console.error('[TrustedDApps] Erro ao salvar:', e);
    }
  }
}

export const trustedDapps = new TrustedDAppsService();
export default trustedDapps;
