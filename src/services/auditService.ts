/**
 * AuditService — Registro de auditoria e histórico de transações locais.
 * 
 * Este serviço registra tentativas de transação (pending) e seu resultado final (confirmed/failed),
 * além de sincronizar os logs com o backend Verum para auditoria global.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { supabase } from './supabase';
import { getApiBaseUrl } from './apiUrl';
import { withTimeout } from './_internal/timeout';

const AUDIT_STORAGE_KEY = 'verum_audit_history';
const MAX_LOCAL_LOGS = 50; // Manter apenas as últimas 50 locais

// ─── Tipos exportados ────────────────────────────────────────────────────────

export interface TxLog {
  id: string;               // UUID do sistema
  timestamp: string;        // ISO string
  network: string;          // 'solana' | 'eth' | etc.
  fromAddress: string;      // Public key apenas
  toAddress: string;
  tokenSymbol: string;
  tokenAmount: number;
  usdValue: number;
  platformFee: number;
  gasFee: number;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  errorMessage?: string;
  idempotencyKey: string;   // hash(from + to + amount + timestamp)
}

export interface HistoryFilters {
  status?: TxLog['status'];
  limit?: number;
}

export interface TxResult {
  hash: string;
  status: 'confirmed' | 'failed';
  errorMessage?: string;
}

// ─── AuditService ────────────────────────────────────────────────────────────

class AuditService {
  private localLogs: TxLog[] = [];
  /**
   * (C6) Promise do load inicial — todos os métodos públicos aguardam essa
   * promise antes de tocar `this.localLogs`, eliminando a race condition em
   * que `logTransactionAttempt`/`getLocalHistory` chamados nos primeiros ~50ms
   * pós-instanciação viam `localLogs = []` mesmo com dados no AsyncStorage.
   */
  private readonly _readyPromise: Promise<void>;

  constructor() {
    this._readyPromise = this._loadLocalLogs();
  }

  /** Garante que o load inicial terminou antes de qualquer leitura/escrita. */
  async whenReady(): Promise<void> {
    await this._readyPromise;
  }

  // ── Ciclo de Vida do Log ──────────────────────────────────────────────────

  /**
   * Registra uma tentativa de transação antes do envio.
   * Cria o idempotencyKey para evitar duplicatas.
   */
  async logTransactionAttempt(params: Omit<TxLog, 'id' | 'status' | 'idempotencyKey'>): Promise<string> {
    // (C6) Aguarda load inicial antes de mexer em this.localLogs.
    await this._readyPromise;
    try {
      // 1. Gera idempotencyKey: hash sha256 determinístico
      // (SE8) Bucket o timestamp em janelas de 60s — clicks duplicados em
      // sequência (clientes nervosos) com mesmo from/to/amount cairão no mesmo
      // hash dentro da janela. Sem isso, ts em ms tornava cada chamada
      // distinta, anulando o ponto da idempotency.
      const tsBucket = Math.floor(new Date(params.timestamp).getTime() / 60_000);
      const rawKey = `${params.fromAddress}_${params.toAddress}_${params.tokenAmount}_${tsBucket}`;
      const idempotencyKey = CryptoJS.SHA256(rawKey).toString();

      // 2. Cria o logId único — 16 bytes CSPRNG codificados em base58
      //    (~22 chars, espaço de colisão 2^128 — seguro para auditoria).
      const logId = bs58.encode(nacl.randomBytes(16));

      const newLog: TxLog = {
        ...params,
        id: logId,
        status: 'pending',
        idempotencyKey,
      };

      // 3. Salva localmente
      this.localLogs.unshift(newLog); // Mais recentes primeiro
      if (this.localLogs.length > MAX_LOCAL_LOGS) {
        this.localLogs.pop();
      }
      await this._saveToAsyncStorage();

      console.log('[AuditService] Tentativa registrada:', logId, 'Idempotency:', idempotencyKey);
      return logId;
    } catch (err) {
      console.error('[AuditService] Erro ao registrar tentativa:', err);
      throw err;
    }
  }

  /**
   * Atualiza o status de uma tentativa pré-registrada após o resultado da blockchain.
   */
  async updateTransactionResult(logId: string, result: TxResult): Promise<void> {
    // (C6) Aguarda load inicial.
    await this._readyPromise;
    try {
      const idx = this.localLogs.findIndex((l) => l.id === logId);
      if (idx === -1) return;

      this.localLogs[idx].status = result.status;
      this.localLogs[idx].txHash = result.hash;
      this.localLogs[idx].errorMessage = result.errorMessage;

      await this._saveToAsyncStorage();
      console.log('[AuditService] Resultado atualizado p/ log:', logId, result.status);

      // Sincroniza log atualizado com o backend
      this.syncToBackend([this.localLogs[idx]]);
    } catch (err) {
      console.error('[AuditService] Erro ao atualizar status:', err);
    }
  }

  // ── Consulta e Filtros ───────────────────────────────────────────────────

  /**
   * Consulta histórico local do dispositivo.
   *
   * (C6) ASYNC agora — antes era síncrono e podia retornar `[]` enquanto o
   * AsyncStorage ainda estava sendo lido. Quem precisa do snapshot atual sem
   * aguardar load deve usar `getLocalHistorySnapshot()` (best-effort).
   */
  async getLocalHistory(filters?: HistoryFilters): Promise<TxLog[]> {
    await this._readyPromise;
    return this.getLocalHistorySnapshot(filters);
  }

  /** Versão síncrona — pode retornar `[]` se o load inicial ainda não terminou. */
  getLocalHistorySnapshot(filters?: HistoryFilters): TxLog[] {
    let result = [...this.localLogs];
    if (filters?.status) {
      result = result.filter((l) => l.status === filters.status);
    }
    if (filters?.limit) {
      result = result.slice(0, filters.limit);
    }
    return result;
  }

  // ── Sincronização Backend ────────────────────────────────────────────────

  /**
   * Envia um lote de logs para o endpoint de auditoria centralizado no backend.
   *
   * (E6) Migrado de `axios` para `fetch` — axios estava sendo importado
   * apenas para este 1 POST (~50KB de bundle desnecessário). `withTimeout`
   * preserva o comportamento de timeout (axios default era ~0, agora 10s).
   */
  async syncToBackend(logs: TxLog[]): Promise<void> {
    if (logs.length === 0) return;

    try {
      const apiURL = getApiBaseUrl();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        console.warn('[AuditService] Sem sessão ativa — sync ignorado');
        return;
      }

      const res = await withTimeout(
        fetch(`${apiURL}/api/audit-log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ logs }),
        }),
        10_000,
        'audit-log:sync',
      );

      if (!res.ok) {
        throw new Error(`audit-log POST falhou: HTTP ${res.status}`);
      }

      console.log(`[AuditService] ${logs.length} logs sincronizados com sucesso.`);
    } catch (err) {
      console.warn('[AuditService] Falha na sincronização (salvo localmente):', err);
    }
  }

  // ── Persistência Local (Private) ──────────────────────────────────────────

  private async _loadLocalLogs(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(AUDIT_STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        // Guard: se o JSON está corrompido ou tem shape errado, ignora — não
        // queremos cair em um estado inválido.
        if (Array.isArray(parsed)) {
          this.localLogs = parsed;
        }
      }
    } catch (err) {
      console.warn('[AuditService] Erro ao ler logs do AsyncStorage:', err);
    }
  }

  private async _saveToAsyncStorage() {
    try {
      await AsyncStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.localLogs));
    } catch (err) {
      console.error('[AuditService] Erro ao persistir logs localmente.');
    }
  }
}

// Singleton
export const auditService = new AuditService();
export default auditService;
