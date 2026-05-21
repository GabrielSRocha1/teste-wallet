/**
 * QRCodeService — geração e parse de QR Codes de pagamento.
 *
 * Suporta Solana Pay (solana:) e EVM (ethereum:/transfer?).
 * Expiração embutida no campo `memo` do Solana Pay e como query param EVM.
 */

import QRCode from 'qrcode';

// ─── Whitelist de tokens permitidos ─────────────────────────────────────────

export const ALLOWED_MINT_ADDRESSES: Record<string, string> = {
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ESCT: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
  BODE: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
};

// ─── Tipos exportados ────────────────────────────────────────────────────────

export type SupportedToken = 'SOL' | 'USDT' | 'USDC' | 'ESCT' | 'BODE';
export type SupportedNetwork = 'solana' | 'ethereum' | 'bsc' | 'polygon';

export interface QRParams {
  recipient: string;
  amount: number;
  token: SupportedToken;
  mintAddress?: string;
  label: string;
  expiresInMinutes: number;
}

export interface EVMQRParams {
  recipient: string;
  amount: number;
  tokenAddress: string;
  chainId: number;
  expiresInMinutes: number;
}

export interface QRPayload {
  network: SupportedNetwork;
  recipient: string;
  amount: number;
  token: string;
  mintAddress?: string;
  expiresAt: Date;
  isExpired: boolean;
}

export interface ParsedPayment {
  network: SupportedNetwork;
  recipient: string;
  amount: number;
  token: string;
  mintAddress?: string;
  expiresAt: Date;
  isExpired: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHAIN_NETWORK: Record<number, SupportedNetwork> = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
};

function mintToSymbol(mint: string): string {
  return (
    Object.entries(ALLOWED_MINT_ADDRESSES).find(([, m]) => m === mint)?.[0] ??
    'UNKNOWN'
  );
}

// ─── QRCodeService ───────────────────────────────────────────────────────────

class QRCodeService {
  // ── Geração de URLs ───────────────────────────────────────────────────────

  /**
   * Gera URL no padrão Solana Pay.
   * Formato: solana:<recipient>?amount=<amount>&spl-token=<mint>&label=<label>&memo=<expiresAt_iso>
   */
  generateSolanaPayURL(params: QRParams): string {
    try {
      const expiresAt = new Date(
        Date.now() + params.expiresInMinutes * 60 * 1000
      );

      const qp = new URLSearchParams();
      qp.set('amount', params.amount.toString());
      qp.set('label', params.label);
      // Embed expiration timestamp in memo field
      qp.set('memo', expiresAt.toISOString());

      if (params.token !== 'SOL') {
        const mint =
          params.mintAddress ?? ALLOWED_MINT_ADDRESSES[params.token];
        if (mint) qp.set('spl-token', mint);
      }

      const url = `solana:${encodeURIComponent(params.recipient)}?${qp.toString()}`;
      console.log('[QRCodeService] Solana Pay URL gerada:', url);
      return url;
    } catch (err) {
      console.error('[QRCodeService] generateSolanaPayURL error:', err);
      throw err;
    }
  }

  /**
   * Gera URL no padrão EVM (ethereum:/transfer).
   * Formato: ethereum:<tokenAddress>/transfer?address=<recipient>&uint256=<amount>&chainId=<id>&expires=<iso>
   */
  generateEVMPayURL(params: EVMQRParams): string {
    try {
      const expiresAt = new Date(
        Date.now() + params.expiresInMinutes * 60 * 1000
      );

      const qp = new URLSearchParams();
      qp.set('address', params.recipient);
      qp.set('uint256', params.amount.toString());
      qp.set('chainId', params.chainId.toString());
      qp.set('expires', expiresAt.toISOString());

      const url = `ethereum:${params.tokenAddress}/transfer?${qp.toString()}`;
      console.log('[QRCodeService] EVM Pay URL gerada:', url);
      return url;
    } catch (err) {
      console.error('[QRCodeService] generateEVMPayURL error:', err);
      throw err;
    }
  }

  // ── Geração de imagem ─────────────────────────────────────────────────────

  /**
   * Converte uma URL de pagamento em imagem base64 PNG do QR Code.
   */
  async generateQRImage(url: string): Promise<string> {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 300,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      return dataUrl; // "data:image/png;base64,..."
    } catch (err) {
      console.error('[QRCodeService] generateQRImage error:', err);
      throw err;
    }
  }

  // ── Parse de QR escaneado ─────────────────────────────────────────────────

  /**
   * Faz o parse do conteúdo bruto de um QR escaneado.
   * Suporta Solana Pay e EVM (ethereum:).
   */
  parseQRPayload(rawData: string): QRPayload {
    try {
      const trimmed = rawData.trim();

      if (trimmed.startsWith('solana:')) {
        return this._parseSolanaPayload(trimmed);
      }

      if (trimmed.startsWith('ethereum:')) {
        return this._parseEVMPayload(trimmed);
      }

      throw new Error(`Formato de QR desconhecido: ${trimmed.slice(0, 40)}`);
    } catch (err) {
      console.error('[QRCodeService] parseQRPayload error:', err);
      throw err;
    }
  }

  private _parseSolanaPayload(raw: string): QRPayload {
    // solana:<recipient>?amount=...&spl-token=...&label=...&memo=<isoDate>
    const withoutScheme = raw.slice('solana:'.length);
    const [recipientEncoded, queryString] = withoutScheme.split('?');
    const recipient = decodeURIComponent(recipientEncoded);
    const params = new URLSearchParams(queryString ?? '');

    const amount = parseFloat(params.get('amount') ?? '0');
    const mintAddress = params.get('spl-token') ?? undefined;
    const token = mintAddress ? mintToSymbol(mintAddress) : 'SOL';
    const memoISO = params.get('memo');
    const expiresAt = memoISO ? new Date(memoISO) : new Date(Date.now() + 600_000);
    // Fail-safe: data inválida (memo corrompido) é tratada como expirada — sem
    // isso, NaN > now retorna sempre false e o QR vira "imortal".
    const isExpired = Number.isNaN(expiresAt.getTime()) ? true : new Date() > expiresAt;

    return {
      network: 'solana',
      recipient,
      amount,
      token,
      mintAddress,
      expiresAt,
      isExpired,
    };
  }

  private _parseEVMPayload(raw: string): QRPayload {
    // ethereum:<tokenAddress>/transfer?address=...&uint256=...&chainId=...&expires=<iso>
    const withoutScheme = raw.slice('ethereum:'.length);
    const slashIdx = withoutScheme.indexOf('/transfer?');
    const queryString =
      slashIdx >= 0 ? withoutScheme.slice(slashIdx + '/transfer?'.length) : '';
    const params = new URLSearchParams(queryString);

    const recipient = params.get('address') ?? '';
    const amount = parseFloat(params.get('uint256') ?? '0');
    const chainId = parseInt(params.get('chainId') ?? '1', 10);
    const network: SupportedNetwork = CHAIN_NETWORK[chainId] ?? 'ethereum';
    const expiresISO = params.get('expires');
    const expiresAt = expiresISO ? new Date(expiresISO) : new Date(Date.now() + 600_000);
    // Mesma proteção do _parseSolanaPayload: Invalid Date → expirado.
    const isExpired = Number.isNaN(expiresAt.getTime()) ? true : new Date() > expiresAt;

    return {
      network,
      recipient,
      amount,
      token: 'ERC-20',
      expiresAt,
      isExpired,
    };
  }

  // ── Validação ─────────────────────────────────────────────────────────────

  /**
   * Valida integridade e expiração do QR payload.
   */
  validateQR(payload: QRPayload): { valid: boolean; reason?: string } {
    if (!payload.recipient || payload.recipient.length < 10) {
      return { valid: false, reason: 'Endereço do recebedor inválido.' };
    }

    if (payload.amount <= 0) {
      return { valid: false, reason: 'Valor do pagamento inválido.' };
    }

    if (payload.isExpired) {
      return { valid: false, reason: 'QR Code expirado, peça um novo.' };
    }

    // Valida mint address contra whitelist (somente Solana SPL)
    if (payload.network === 'solana' && payload.mintAddress) {
      const allowedMints = Object.values(ALLOWED_MINT_ADDRESSES);
      if (!allowedMints.includes(payload.mintAddress)) {
        return {
          valid: false,
          reason: `Token não autorizado: ${payload.mintAddress}`,
        };
      }
    }

    return { valid: true };
  }
}

// Singleton
export const qrCodeService = new QRCodeService();
export default qrCodeService;
