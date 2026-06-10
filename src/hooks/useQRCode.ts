/**
 * useQRCode — hook para a tela de RECEBER.
 *
 * - Converte valor em BRL/PYG/USD para amount em token via usePrices()
 * - Gera QR Code com validade de 10 minutos
 * - Countdown: ao expirar, regenera automaticamente o QR
 * - Retorna: { qrImageBase64, paymentURL, expiresAt, secondsLeft, regenerate }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import qrCodeService from '../services/qrCodeService';
import { usePrices, SupportedCurrency } from './usePrices';
import type { SupportedToken } from '../services/qrCodeService';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UseQRCodeParams {
  recipientAddress: string;
  amount: number;
  token: SupportedToken;
  currency: SupportedCurrency;
  label?: string;
  expiresInMinutes?: number;
}

export interface UseQRCodeResult {
  qrImageBase64: string | null;
  paymentURL: string | null;
  expiresAt: Date | null;
  secondsLeft: number;
  loading: boolean;
  error: Error | null;
  /** Força a regeneração imediata do QR (resetando o timer). */
  regenerate: () => void;
}

const DEFAULT_EXPIRY_MIN = 10;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQRCode(params: UseQRCodeParams): UseQRCodeResult {
  const { convertToCrypto } = usePrices();

  const [qrImageBase64, setQrImageBase64] = useState<string | null>(null);
  const [paymentURL, setPaymentURL] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef<number>(0); // evita race conditions

  // ── Geração do QR ──────────────────────────────────────────────────────

  const generate = useCallback(async () => {
    if (!params.recipientAddress) return;

    const genId = ++generationRef.current;

    try {
      setLoading(true);
      setError(null);

      // Converte amount de fiat → crypto se necessário
      let tokenAmount = params.amount;
      if (params.currency !== 'USD' || params.token !== 'USDC') {
        const converted = convertToCrypto(params.amount, params.currency, params.token);
        if (converted !== null) tokenAmount = converted;
      }

      const expiresInMinutes = params.expiresInMinutes ?? DEFAULT_EXPIRY_MIN;

      const url = qrCodeService.generateSolanaPayURL({
        recipient: params.recipientAddress,
        amount: tokenAmount,
        token: params.token,
        label: params.label ?? 'Verum Wallet',
        expiresInMinutes,
      });

      const image = await qrCodeService.generateQRImage(url);

      // Ignora resultado de geração antiga
      if (genId !== generationRef.current) return;

      const expiry = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      setPaymentURL(url);
      setQrImageBase64(image);
      setExpiresAt(expiry);
      setSecondsLeft(expiresInMinutes * 60);

      if (__DEV__) console.log('[useQRCode] QR gerado, expira em:', expiry.toISOString());
    } catch (err) {
      if (genId !== generationRef.current) return;
      const e = err instanceof Error ? err : new Error(String(err));
      console.error('[useQRCode] erro ao gerar QR:', e);
      setError(e);
    } finally {
      if (genId === generationRef.current) setLoading(false);
    }
  }, [
    params.recipientAddress,
    params.amount,
    params.token,
    params.currency,
    params.label,
    params.expiresInMinutes,
    convertToCrypto,
  ]);

  // ── Countdown + auto-regeneração ───────────────────────────────────────

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Expirou — regenera automaticamente
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          if (__DEV__) console.log('[useQRCode] QR expirado — regenerando...');
          generate();
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
  }, [generate]);

  // ── Efeitos ────────────────────────────────────────────────────────────

  useEffect(() => {
    generate().then(() => startCountdown());

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.recipientAddress, params.amount, params.token, params.currency]);

  // Reinicia countdown após regeneração manual/automática
  useEffect(() => {
    if (expiresAt && !loading) startCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const regenerate = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    generate().then(() => startCountdown());
  }, [generate, startCountdown]);

  return { qrImageBase64, paymentURL, expiresAt, secondsLeft, loading, error, regenerate };
}

export default useQRCode;
