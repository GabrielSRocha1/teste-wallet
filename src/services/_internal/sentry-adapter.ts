/**
 * sentry-adapter.ts — Adapter agnóstico para Sentry-like clients.
 *
 * Não tem dependência direta de `@sentry/*` SDK — define uma interface fina
 * (`SentryLikeClient`) que o usuário implementa com 10 linhas:
 *
 *   import * as Sentry from '@sentry/react-native';
 *   const client: SentryLikeClient = {
 *     captureException: (e, ctx) => Sentry.captureException(e, ctx),
 *     captureMessage:   (m, l, c) => Sentry.captureMessage(m, { level: l, ...c }),
 *     addBreadcrumb:    (bc) => Sentry.addBreadcrumb(bc),
 *   };
 *   registry.addSink(new SentryMetricsSink(client));
 *   addLogSink(new SentryLogSink(client));
 *
 * Mapeamento:
 *  - SentryMetricsSink: counter outcome=failure → captureMessage(error);
 *    outros eventos → breadcrumb.
 *  - SentryLogSink: error/fatal com Error → captureException; sem Error →
 *    captureMessage; warn/info/debug → breadcrumb.
 *
 * Sinks são tolerantes a SentryLikeClient que lança (swallow + warn).
 */

import { createLogger, type LogEntry, type LogSink } from './logger';
import type { MetricEvent, MetricsSink } from './metrics';

const log = createLogger('SentryAdapter');

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface SentryCaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: SentryLevel;
}

export interface SentryBreadcrumb {
  category: string;
  message: string;
  level?: SentryLevel;
  data?: Record<string, unknown>;
  timestamp?: number;
}

export interface SentryLikeClient {
  captureException(error: unknown, context?: SentryCaptureContext): void;
  captureMessage(message: string, level?: SentryLevel, context?: SentryCaptureContext): void;
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
}

/** Implementação default segura — usar quando Sentry não está configurado. */
export class NoopSentryClient implements SentryLikeClient {
  captureException(_error: unknown, _context?: SentryCaptureContext): void {
    /* no-op */
  }
  captureMessage(_message: string, _level?: SentryLevel, _context?: SentryCaptureContext): void {
    /* no-op */
  }
  addBreadcrumb(_breadcrumb: SentryBreadcrumb): void {
    /* no-op */
  }
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log.warn('sentry client call threw — engolindo', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// SentryMetricsSink
// ────────────────────────────────────────────────────────────────────────────────

export interface SentryMetricsSinkOptions {
  /** Limiar de severidade para escalar de breadcrumb a captureMessage. Default 'failure'. */
  alertOnTag?: { name: string; value: string };
}

export class SentryMetricsSink implements MetricsSink {
  private readonly alertOnTag: { name: string; value: string };

  constructor(
    private readonly client: SentryLikeClient,
    opts: SentryMetricsSinkOptions = {},
  ) {
    this.alertOnTag = opts.alertOnTag ?? { name: 'outcome', value: 'failure' };
  }

  write(event: MetricEvent): void {
    const isAlert =
      event.kind === 'counter' && event.tags[this.alertOnTag.name] === this.alertOnTag.value;

    if (isAlert) {
      safeCall(() =>
        this.client.captureMessage(
          `metric.alert: ${event.name}`,
          'error',
          { tags: event.tags, extra: { value: event.value, timestamp: event.timestamp } },
        ),
      );
      return;
    }

    safeCall(() =>
      this.client.addBreadcrumb({
        category: 'metrics',
        message: `${event.kind}.${event.op} ${event.name}`,
        level: 'info',
        data: { value: event.value, tags: event.tags },
        timestamp: event.timestamp,
      }),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// SentryLogSink
// ────────────────────────────────────────────────────────────────────────────────

const LOG_LEVEL_TO_SENTRY: Record<LogEntry['level'], SentryLevel> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal',
};

export class SentryLogSink implements LogSink {
  constructor(private readonly client: SentryLikeClient) {}

  write(entry: LogEntry): void {
    const sentryLevel = LOG_LEVEL_TO_SENTRY[entry.level];

    if (entry.level === 'error' || entry.level === 'fatal') {
      if (entry.error) {
        const err = new Error(entry.error.message);
        err.name = entry.error.name;
        if (entry.error.stack) err.stack = entry.error.stack;
        safeCall(() =>
          this.client.captureException(err, {
            level: sentryLevel,
            tags: { component: entry.component, level: entry.level },
            extra: { ...entry.fields, timestamp: entry.timestamp },
          }),
        );
      } else {
        safeCall(() =>
          this.client.captureMessage(entry.message, sentryLevel, {
            tags: { component: entry.component, level: entry.level },
            extra: { ...entry.fields, timestamp: entry.timestamp },
          }),
        );
      }
      return;
    }

    safeCall(() =>
      this.client.addBreadcrumb({
        category: entry.component,
        message: entry.message,
        level: sentryLevel,
        data: entry.fields,
      }),
    );
  }
}
