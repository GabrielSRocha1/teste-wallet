/**
 * logger.ts — Structured logger interno para a Verum Wallet.
 *
 * Objetivos:
 *  - Níveis explícitos (debug / info / warn / error / fatal).
 *  - Sempre carrega contexto (component, correlation_id, fields).
 *  - Output formatado JSON em produção, texto colorido em dev.
 *  - Pronto para plugar Sentry / Datadog (sinks adicionáveis).
 *  - Zero deps externas.
 *
 * Uso:
 *   const log = createLogger('TransactionService');
 *   log.info('broadcast iniciado', { signature: sig, slot });
 *   log.error('falha ao confirmar', err, { signature: sig });
 *
 *   // correlation id por operação:
 *   const opLog = log.child({ correlationId: 'swap-abc123' });
 *   opLog.warn('blockhash expirado', { lastValidBlockHeight });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogFields {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  component: string;
  message: string;
  fields: LogFields;
  error?: { name: string; message: string; stack?: string };
  timestamp: string;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function envLevel(): LogLevel {
  const fromEnv = (
    typeof process !== 'undefined' ? (process.env?.EXPO_PUBLIC_LOG_LEVEL ?? '') : ''
  ).toLowerCase();
  if (fromEnv in LEVEL_ORDER) return fromEnv as LogLevel;
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info';
}

let currentMinLevel: LogLevel = envLevel();
const sinks: LogSink[] = [];

// ─── Sink padrão: console com formatação dev/prod ─────────────────────────────

const consoleSink: LogSink = {
  write(entry: LogEntry): void {
    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (isDev) {
      const prefix = `[${entry.component}]`;
      const tail =
        Object.keys(entry.fields).length > 0
          ? ' ' + safeStringify(entry.fields)
          : '';
      const errTail = entry.error
        ? `\n  → ${entry.error.name}: ${entry.error.message}`
        : '';
      const text = `${prefix} ${entry.message}${tail}${errTail}`;

      switch (entry.level) {
        case 'debug':
          console.debug(text);
          break;
        case 'info':
          console.log(text);
          break;
        case 'warn':
          console.warn(text);
          break;
        case 'error':
        case 'fatal':
          console.error(text);
          break;
      }
    } else {
      // Produção: JSON single-line para coleta por log aggregator
      console.log(safeStringify(entry));
    }
  },
};

sinks.push(consoleSink);

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_k, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    return String(obj);
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/** Define o nível mínimo global de log (debug é mais verbose, fatal é o mais restrito). */
export function setLogLevel(level: LogLevel): void {
  currentMinLevel = level;
}

/** Adiciona um sink adicional (ex: Sentry, arquivo, custom). */
export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

/** Remove TODOS os sinks (útil para testes). Re-adicione console se quiser. */
export function clearLogSinks(): void {
  sinks.length = 0;
}

/** Retorna o sink padrão de console (para re-adicionar após clear). */
export function getConsoleSink(): LogSink {
  return consoleSink;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  fatal(message: string, error?: unknown, fields?: LogFields): void;
  /** Cria um logger filho com campos adicionais herdados em todas as chamadas. */
  child(extraFields: LogFields): Logger;
}

function emit(
  component: string,
  baseFields: LogFields,
  level: LogLevel,
  message: string,
  fields?: LogFields,
  error?: unknown,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentMinLevel]) return;

  const entry: LogEntry = {
    level,
    component,
    message,
    fields: { ...baseFields, ...(fields ?? {}) },
    timestamp: new Date().toISOString(),
  };

  if (error !== undefined) {
    const e = error instanceof Error ? error : new Error(String(error));
    entry.error = { name: e.name, message: e.message, stack: e.stack };
  }

  for (const sink of sinks) {
    try {
      sink.write(entry);
    } catch {
      /* nunca deixar falha de sink propagar */
    }
  }
}

/** Cria um logger nomeado para um componente. */
export function createLogger(component: string, baseFields: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => emit(component, baseFields, 'debug', msg, fields),
    info: (msg, fields) => emit(component, baseFields, 'info', msg, fields),
    warn: (msg, fields) => emit(component, baseFields, 'warn', msg, fields),
    error: (msg, err, fields) => emit(component, baseFields, 'error', msg, fields, err),
    fatal: (msg, err, fields) => emit(component, baseFields, 'fatal', msg, fields, err),
    child: (extra) => createLogger(component, { ...baseFields, ...extra }),
  };
}

/** Gera um correlation ID curto e único — uso em operações end-to-end. */
export function newCorrelationId(prefix = 'op'): string {
  // Não é CSPRNG (não precisa), só identificador legível para rastreio de log.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
