/**
 * BLOCK B.2 — Fail Containment Wrapper
 * Безопасный возврат HOLD при любых ошибках
 * 
 * Принцип: Fractal модуль НИКОГДА не должен выбрасывать исключения наружу.
 * При любой ошибке — возвращаем безопасный HOLD сигнал.
 */

import type { Logger } from './fractal.host.deps.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type FractalSignalType = 'LONG' | 'SHORT' | 'HOLD';

export interface SafeSignalResult {
  ok: boolean;
  signal: FractalSignalType;
  confidence: number;
  reason: string;
  error?: string;
  containmentTriggered: boolean;
  timestamp: string;
}

export interface ContainmentConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  fallbackSignal?: FractalSignalType;
  fallbackConfidence?: number;
  logErrors?: boolean;
}

const DEFAULT_CONFIG: Required<ContainmentConfig> = {
  maxRetries: 1,
  retryDelayMs: 100,
  fallbackSignal: 'HOLD',
  fallbackConfidence: 0,
  logErrors: true,
};

// ═══════════════════════════════════════════════════════════════
// FAIL CONTAINMENT WRAPPER
// ═══════════════════════════════════════════════════════════════

export class FailContainment {
  private config: Required<ContainmentConfig>;
  private logger?: Logger;
  private errorCount = 0;
  private lastError?: Error;

  constructor(config?: ContainmentConfig, logger?: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Wrap any async signal generation function with fail containment
   * On ANY error — returns safe HOLD signal
   */
  async wrapSignal<T extends SafeSignalResult>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<SafeSignalResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn();
        // Reset error count on success
        this.errorCount = 0;
        return {
          ...result,
          containmentTriggered: false,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.errorCount++;
        this.lastError = lastError;

        if (this.config.logErrors && this.logger) {
          this.logger.error({
            context: context || 'FailContainment',
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            error: lastError.message,
            stack: lastError.stack,
          }, 'Signal generation failed, applying containment');
        }

        // Wait before retry (if not last attempt)
        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    // All retries exhausted — return safe HOLD
    return this.createSafeHold(lastError, context);
  }

  /**
   * Wrap synchronous function
   */
  wrapSync<T>(fn: () => T, fallback: T, context?: string): T {
    try {
      return fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.errorCount++;
      this.lastError = error;

      if (this.config.logErrors && this.logger) {
        this.logger.error({
          context: context || 'FailContainment.sync',
          error: error.message,
        }, 'Sync operation failed, returning fallback');
      }

      return fallback;
    }
  }

  /**
   * Create safe HOLD signal
   */
  createSafeHold(error?: Error | null, context?: string): SafeSignalResult {
    return {
      ok: false,
      signal: this.config.fallbackSignal,
      confidence: this.config.fallbackConfidence,
      reason: `CONTAINMENT: ${context || 'Error occurred'} — defaulting to ${this.config.fallbackSignal}`,
      error: error?.message,
      containmentTriggered: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get error statistics
   */
  getStats(): { errorCount: number; lastError?: string } {
    return {
      errorCount: this.errorCount,
      lastError: this.lastError?.message,
    };
  }

  /**
   * Reset error count (e.g., after successful recovery)
   */
  reset(): void {
    this.errorCount = 0;
    this.lastError = undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Quick wrapper for one-off containment
 */
export async function withContainment<T extends SafeSignalResult>(
  fn: () => Promise<T>,
  config?: ContainmentConfig,
  logger?: Logger
): Promise<SafeSignalResult> {
  const containment = new FailContainment(config, logger);
  return containment.wrapSignal(fn);
}

/**
 * Sync version for quick containment
 */
export function withContainmentSync<T>(
  fn: () => T,
  fallback: T,
  logger?: Logger
): T {
  const containment = new FailContainment({}, logger);
  return containment.wrapSync(fn, fallback);
}

// ═══════════════════════════════════════════════════════════════
// DECORATORS (for class methods)
// ═══════════════════════════════════════════════════════════════

/**
 * Decorator for async methods — wraps with fail containment
 * Usage:
 * @contained({ fallbackSignal: 'HOLD' })
 * async generateSignal() { ... }
 */
export function contained(config?: ContainmentConfig) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const containment = new FailContainment(config, (this as any).logger);
      return containment.wrapSignal(
        () => originalMethod.apply(this, args),
        `${target.constructor.name}.${propertyKey}`
      );
    };

    return descriptor;
  };
}
