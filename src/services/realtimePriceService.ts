import { getSwapApiBaseUrl } from './apiUrl';

const API_URL = getSwapApiBaseUrl();

/**
 * Estado de saúde reportado aos assinantes de erros. Permite que UIs mostrem
 * indicador de "preços defasados há Xs" em vez de exibir valores stale sem aviso.
 */
export interface PriceFetchError {
  message: string;
  /** Timestamp do último fetch bem-sucedido (0 se nunca). */
  lastSuccessAt: number;
  /** Quantos fetches consecutivos falharam até agora. */
  consecutiveFailures: number;
}

type PriceListener = (prices: Record<string, number>) => void;
type ErrorListener = (err: PriceFetchError) => void;

/**
 * (F6) Padrão lazy: polling só começa quando o PRIMEIRO subscriber se inscreve
 * e PARA quando o último cancela. Antes desta correção, o singleton iniciava
 * polling no constructor — o app pagava 1 fetch a cada 4s mesmo sem nenhuma
 * tela exibindo preços. Em escala (1000 users), é 15k req/min desperdiçadas.
 */
class RealtimePriceService {
  private listeners: PriceListener[] = [];
  private errorListeners: ErrorListener[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private currentPrices: Record<string, number> = {};
  private lastSuccessAt = 0;
  private consecutiveFailures = 0;
  /**
   * (F6) Flag que indica se o constructor já rodou autostart legado. Para não
   * quebrar callers existentes que confiam em `currentPrices` populado, mantemos
   * comportamento de fetch inicial uma vez; mas o polling contínuo só roda
   * enquanto há subscribers.
   */
  private autoStartedOnce = false;

  constructor() {
    // (F6) NÃO inicia polling no constructor — espera primeiro subscribe.
    // Disparamos apenas um fetch inicial best-effort para popular cache logo
    // no boot — sem agendar polling.
    this._kickstartInitialFetch();
  }

  private _kickstartInitialFetch(): void {
    if (this.autoStartedOnce) return;
    this.autoStartedOnce = true;
    this.fetchPrices().catch(() => undefined);
  }

  start() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.fetchPrices(); // Fetch immediately
    this.pollInterval = setInterval(() => this.fetchPrices(), 4000);
    console.log('[RealtimePriceService] Iniciado polling de preços (REST)');
  }

  stop() {
    this.isPolling = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async fetchPrices() {
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/prices`, { headers: { 'ngrok-skip-browser-warning': '1' } });

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      const data = await response.json();

      const formattedPrices: Record<string, number> = {};

      if (data && typeof data === 'object') {
        const pricesPayload = data.prices ? data.prices : data;

        for (const [symbol, pObj] of Object.entries(pricesPayload)) {
          // Normalização do símbolo (BDC como principal)
          const finalSymbol = symbol === 'BODE' ? 'BDC' : symbol;

          if (typeof pObj === 'number') {
            formattedPrices[finalSymbol] = pObj;
          } else if (pObj && (pObj as any).USD) {
            formattedPrices[finalSymbol] = (pObj as any).USD;
          }
        }

        this.currentPrices = formattedPrices;
        this.lastSuccessAt = Date.now();
        this.consecutiveFailures = 0;
        this.notify(formattedPrices);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.consecutiveFailures++;
      console.warn('[RealtimePriceService] Erro ao buscar preços:', message);
      // Notifica assinantes de erro. UIs podem exibir indicador de staleness
      // (ex: "preços defasados há 30s"). Backward compatible: assinantes que
      // só usam `subscribe()` continuam funcionando sem mudança.
      this.notifyError({
        message,
        lastSuccessAt: this.lastSuccessAt,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  /**
   * Inscreve um componente para receber atualizações instantâneas de preço.
   *
   * (F6) Polling é iniciado no PRIMEIRO subscribe e parado quando o último
   * unsubscribe acontece. Sem subscribers = sem polling = zero RPC waste.
   *
   * @returns Função para cancelar a inscrição (unsubscribe).
   */
  subscribe(callback: (prices: Record<string, number>) => void) {
    this.listeners.push(callback);

    // Envia o último preço imediatamente se já tiver
    if (Object.keys(this.currentPrices).length > 0) {
      callback(this.currentPrices);
    }

    // (F6) Primeiro subscriber → liga o polling.
    if (this.listeners.length === 1) {
      this.start();
    }

    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
      // (F6) Sem subscribers de prices E sem subscribers de erro → para polling.
      if (this.listeners.length === 0 && this.errorListeners.length === 0) {
        this.stop();
      }
    };
  }

  private notify(prices: Record<string, number>) {
    this.listeners.forEach(callback => {
      try {
        callback(prices);
      } catch (e) {
        // Listener com bug não pode quebrar a notificação dos outros.
        console.error('[RealtimePriceService] listener crashed:', e);
      }
    });
  }

  private notifyError(err: PriceFetchError) {
    this.errorListeners.forEach(callback => {
      try {
        callback(err);
      } catch (e) {
        console.error('[RealtimePriceService] error listener crashed:', e);
      }
    });
  }

  /**
   * Inscreve um componente para receber notificações de falha no fetch.
   * Útil para mostrar badge "preços defasados há Xs" na UI.
   *
   * (F6) Idem `subscribe`: error listeners também contam para keep-alive do
   * polling. Caso típico: tela de status que só quer saber se prices estão
   * falhando — sem essa contagem, polling pararia e o badge ficaria preso.
   *
   * @returns Função de unsubscribe.
   */
  subscribeError(callback: ErrorListener): () => void {
    this.errorListeners.push(callback);
    // (F6) Primeiro listener (de qualquer tipo) → liga polling.
    if (this.listeners.length === 0 && this.errorListeners.length === 1) {
      this.start();
    }
    return () => {
      this.errorListeners = this.errorListeners.filter(l => l !== callback);
      if (this.listeners.length === 0 && this.errorListeners.length === 0) {
        this.stop();
      }
    };
  }

  /** Snapshot de saúde para health-check / debug. */
  getHealth(): { lastSuccessAt: number; consecutiveFailures: number; isPolling: boolean } {
    return {
      lastSuccessAt: this.lastSuccessAt,
      consecutiveFailures: this.consecutiveFailures,
      isPolling: this.isPolling,
    };
  }

  /**
   * Força uma reconexão se necessário - agora apenas força um fetch
   */
  reconnect() {
    if (!this.isPolling) {
        this.start();
    } else {
        this.fetchPrices(); // Force immediate update
    }
  }
}

export const realtimePriceService = new RealtimePriceService();
export default realtimePriceService;
