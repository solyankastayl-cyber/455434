/**
 * Phase S4.1 & S4.2: Structured Logger with RequestId
 */

import { getConfig } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  phase?: string;
  symbol?: string;
  tf?: string;
  ms?: number;
  [key: string]: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private currentRequestId: string | null = null;
  
  /**
   * Set request ID for current context
   */
  setRequestId(requestId: string): void {
    this.currentRequestId = requestId;
  }
  
  /**
   * Clear request ID
   */
  clearRequestId(): void {
    this.currentRequestId = null;
  }
  
  /**
   * Get current request ID
   */
  getRequestId(): string | null {
    return this.currentRequestId;
  }
  
  /**
   * Log debug message
   */
  debug(ctx: LogContext | string, message?: string): void {
    this.log('debug', ctx, message);
  }
  
  /**
   * Log info message
   */
  info(ctx: LogContext | string, message?: string): void {
    this.log('info', ctx, message);
  }
  
  /**
   * Log warning
   */
  warn(ctx: LogContext | string, message?: string): void {
    this.log('warn', ctx, message);
  }
  
  /**
   * Log error
   */
  error(ctx: LogContext | string, message?: string): void {
    this.log('error', ctx, message);
  }
  
  /**
   * Create child logger with fixed context
   */
  child(baseCtx: LogContext): ChildLogger {
    return new ChildLogger(this, baseCtx);
  }
  
  private log(level: LogLevel, ctx: LogContext | string, message?: string): void {
    const config = getConfig();
    
    if (LOG_LEVELS[level] < LOG_LEVELS[config.logLevel]) {
      return;
    }
    
    const entry: Record<string, any> = {
      level,
      ts: new Date().toISOString(),
    };
    
    if (this.currentRequestId) {
      entry.requestId = this.currentRequestId;
    }
    
    if (typeof ctx === 'string') {
      entry.msg = ctx;
    } else {
      Object.assign(entry, ctx);
      if (message) entry.msg = message;
    }
    
    if (config.logFormat === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      const parts = [
        `[${entry.ts}]`,
        `[${level.toUpperCase()}]`,
        entry.requestId ? `[${entry.requestId.slice(0, 8)}]` : '',
        entry.phase ? `[${entry.phase}]` : '',
        entry.msg || '',
        entry.ms ? `(${entry.ms}ms)` : '',
      ].filter(Boolean);
      console.log(parts.join(' '));
    }
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private baseCtx: LogContext
  ) {}
  
  debug(ctx: LogContext | string, message?: string): void {
    this.parent.debug(this.merge(ctx), message);
  }
  
  info(ctx: LogContext | string, message?: string): void {
    this.parent.info(this.merge(ctx), message);
  }
  
  warn(ctx: LogContext | string, message?: string): void {
    this.parent.warn(this.merge(ctx), message);
  }
  
  error(ctx: LogContext | string, message?: string): void {
    this.parent.error(this.merge(ctx), message);
  }
  
  private merge(ctx: LogContext | string): LogContext {
    if (typeof ctx === 'string') {
      return { ...this.baseCtx, msg: ctx };
    }
    return { ...this.baseCtx, ...ctx };
  }
}

// Singleton logger
export const logger = new Logger();

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
