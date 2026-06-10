/**
 * useQRScanner — hook para a tela de PAGAR (leitura de QR Code).
 *
 * - Recebe o resultado bruto do scanner de câmera (string)
 * - Chama qrCodeService.parseQRPayload() + validateQR()
 * - Se válido: retorna ParsedPayment para popular a tela de pagamento
 * - Se expirado: retorna erro "QR Code expirado, peça um novo"
 * - Se rede inválida ou mint não permitida: retorna erro específico
 */

import { useState, useCallback } from 'react';
import qrCodeService, { QRPayload } from '../services/qrCodeService';

// ─── Tipos exportados ────────────────────────────────────────────────────────

export type { QRPayload };

export interface ParsedPayment {
  network: QRPayload['network'];
  recipient: string;
  amount: number;
  token: string;
  mintAddress?: string;
  expiresAt: Date;
  isExpired: boolean;
}

export interface UseQRScannerResult {
  parsedPayment: ParsedPayment | null;
  error: string | null;
  isLoading: boolean;
  /** Processa o resultado bruto do scanner. */
  processRawScan: (rawData: string) => void;
  /** Limpa o estado para escanear novamente. */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQRScanner(): UseQRScannerResult {
  const [parsedPayment, setParsedPayment] = useState<ParsedPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // ── Reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setParsedPayment(null);
    setError(null);
    setIsLoading(false);
  }, []);

  // ── Processamento do scan ────────────────────────────────────────────────

  const processRawScan = useCallback((rawData: string) => {
    if (!rawData?.trim()) {
      setError('QR Code vazio ou ilegível.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setParsedPayment(null);

    try {
      // 1. Parse
      const payload = qrCodeService.parseQRPayload(rawData);

      // 2. Validação
      const { valid, reason } = qrCodeService.validateQR(payload);

      if (!valid) {
        setError(reason ?? 'QR Code inválido.');
        setIsLoading(false);
        return;
      }

      // 3. Rede suportada
      const supportedNetworks: QRPayload['network'][] = [
        'solana',
        'ethereum',
        'bsc',
        'polygon',
      ];
      if (!supportedNetworks.includes(payload.network)) {
        setError(`Rede não suportada: ${payload.network}`);
        setIsLoading(false);
        return;
      }

      if (__DEV__) console.log('[useQRScanner] QR válido:', payload);

      const payment: ParsedPayment = {
        network: payload.network,
        recipient: payload.recipient,
        amount: payload.amount,
        token: payload.token,
        mintAddress: payload.mintAddress,
        expiresAt: payload.expiresAt,
        isExpired: payload.isExpired,
      };

      setParsedPayment(payment);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Erro ao ler o QR Code.';
      console.error('[useQRScanner] processRawScan error:', err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { parsedPayment, error, isLoading, processRawScan, reset };
}

export default useQRScanner;
