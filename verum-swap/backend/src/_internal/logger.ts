/**
 * logger.ts — Structured logger para o backend Node.js do Verum Swap.
 *
 * Diferenças vs client logger:
 *   - Sem dependência de __DEV__ (usa NODE_ENV).
 *   - JSON single-line em produção (pronto para coleta por aggregator).
 *   - Texto colorido em dev (sem deps — só códigos ANSI).
 *   - Suporta correlation IDs via child loggers (req middleware).
 *
 * Uso:
 *   const log = createLogger('Server');
 *   log.info('booted', { port: 3001 });
 *
 *   // por request:
 *   const reqLog = log.child({ requestId: req.id });
 *   reqLog.warn('slow rpc', { ms: 1500 });
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
  const lvl = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (lvl in LEVEL_ORDER) return lvl as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

let currentMinLevel: LogLevel = envLevel();
const sinks: LogSink[] = [];

// ─── Sink padrão ─────────────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

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

const consoleSink: LogSink = {
  write(entry: LogEntry): void {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      // Linha JSON única para log aggregator (Datadog/Loki/etc.).
      console.log(safeStringify(entry));
      return;
    }

    // Dev: texto colorido.
    const colors: Record<LogLevel, string> = {
      debug: ANSI.dim,
      info: ANSI.cyan,
      warn: ANSI.yellow,
      error: ANSI.red,
      fatal: ANSI.red + ANSI.bold,
    };
    const tag = `${colors[entry.level]}${entry.level.toUpperCase().padEnd(5)}${ANSI.reset}`;
    const comp = `${ANSI.magenta}[${entry.component}]${ANSI.reset}`;
    const fieldsTail =
      Object.keys(entry.fields).length > 0 ? ' ' + safeStringify(entry.fields) : '';
    const errTail = entry.error
      ? `\n  ${ANSI.red}→ ${entry.error.name}: ${entry.error.message}${ANSI.reset}`
      : '';

    const out = `${tag} ${comp} ${entry.message}${fieldsTail}${errTail}`;
    switch (entry.level) {
      case 'warn':
        console.warn(out);
        break;
      case 'error':
      case 'fatal':
        console.error(out);
        break;
      default:
        console.log(out);
    }
  },
};

sinks.push(consoleSink);

// ─── API pública ─────────────────────────────────────────────────────────────

export function setLogLevel(level: LogLevel): void {
  currentMinLevel = level;
}

export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  fatal(message: string, error?: unknown, fields?: LogFields): void;
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
      /* sink failure não pode quebrar logging */
    }
  }
}

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

export function newCorrelationId(prefix = 'req'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
