/**
 * BLOCK E.2 — Cron Hardening: Distributed Lock + Idempotency
 * 
 * Защита от:
 * - Повторного запуска (idempotency key)
 * - Параллельного выполнения (distributed lock via MongoDB)
 * - Пропуска (execution tracking)
 * - Зависания (timeout protection)
 */

import type { Logger } from '../isolation/fractal.host.deps.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CronJobResult {
  ok: boolean;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  result?: any;
}

export interface CronLock {
  jobName: string;
  lockedAt: Date;
  lockedBy: string;
  expiresAt: Date;
  executionId: string;
}

export interface CronExecution {
  jobName: string;
  executionId: string;
  idempotencyKey: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  result?: any;
  error?: string;
}

export interface CronHardeningConfig {
  lockTimeoutMs?: number;      // How long lock is valid
  executionTimeoutMs?: number; // Max job duration before timeout
  idempotencyWindowMs?: number; // Window for idempotency check
  instanceId?: string;         // Unique instance ID for distributed lock
  logger?: Logger;
}

// ═══════════════════════════════════════════════════════════════
// CRON HARDENING SERVICE
// ═══════════════════════════════════════════════════════════════

export class CronHardeningService {
  private config: Required<Omit<CronHardeningConfig, 'logger'>> & { logger?: Logger };
  private locks: Map<string, CronLock> = new Map();
  private executions: CronExecution[] = [];

  constructor(config?: CronHardeningConfig) {
    this.config = {
      lockTimeoutMs: config?.lockTimeoutMs ?? 300_000, // 5 minutes
      executionTimeoutMs: config?.executionTimeoutMs ?? 600_000, // 10 minutes
      idempotencyWindowMs: config?.idempotencyWindowMs ?? 86400_000, // 24 hours
      instanceId: config?.instanceId ?? `instance_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      logger: config?.logger,
    };
  }

  /**
   * Execute job with full hardening
   */
  async executeWithHardening<T>(
    jobName: string,
    idempotencyKey: string,
    jobFn: () => Promise<T>
  ): Promise<CronJobResult> {
    const executionId = this.generateExecutionId();
    const startedAt = new Date();

    this.log('info', { jobName, executionId, idempotencyKey }, 'Cron job starting');

    // 1. Check idempotency (already ran today?)
    const existingExecution = this.findExecution(jobName, idempotencyKey);
    if (existingExecution && existingExecution.status === 'COMPLETED') {
      this.log('info', { jobName, existingExecution: existingExecution.executionId }, 'Job already completed (idempotent)');
      return {
        ok: true,
        jobId: existingExecution.executionId,
        startedAt: existingExecution.startedAt.toISOString(),
        completedAt: existingExecution.completedAt?.toISOString(),
        skipped: true,
        skipReason: 'ALREADY_COMPLETED',
        result: existingExecution.result,
      };
    }

    // 2. Acquire lock
    const lockAcquired = this.acquireLock(jobName, executionId);
    if (!lockAcquired) {
      this.log('warn', { jobName }, 'Could not acquire lock, job already running');
      return {
        ok: false,
        jobId: executionId,
        startedAt: startedAt.toISOString(),
        skipped: true,
        skipReason: 'LOCK_HELD',
        error: 'Another instance is running this job',
      };
    }

    // 3. Record execution start
    const execution: CronExecution = {
      jobName,
      executionId,
      idempotencyKey,
      status: 'RUNNING',
      startedAt,
    };
    this.executions.push(execution);

    // 4. Execute with timeout
    try {
      const result = await this.executeWithTimeout(jobFn, this.config.executionTimeoutMs);
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Update execution record
      execution.status = 'COMPLETED';
      execution.completedAt = completedAt;
      execution.durationMs = durationMs;
      execution.result = result;

      this.log('info', { jobName, executionId, durationMs }, 'Cron job completed');

      return {
        ok: true,
        jobId: executionId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        result,
      };
    } catch (err: any) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const isTimeout = err?.message === 'EXECUTION_TIMEOUT';

      execution.status = isTimeout ? 'TIMEOUT' : 'FAILED';
      execution.completedAt = completedAt;
      execution.durationMs = durationMs;
      execution.error = err?.message || String(err);

      this.log('error', { jobName, executionId, error: execution.error }, 'Cron job failed');

      return {
        ok: false,
        jobId: executionId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        error: execution.error,
      };
    } finally {
      // 5. Release lock
      this.releaseLock(jobName, executionId);
      this.cleanupExecutions();
    }
  }

  /**
   * Generate daily idempotency key
   */
  generateDailyKey(jobName: string, symbol?: string): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${jobName}:${symbol || 'default'}:${date}`;
  }

  /**
   * Acquire distributed lock (in-memory for single instance, extend for MongoDB)
   */
  private acquireLock(jobName: string, executionId: string): boolean {
    const now = new Date();
    const existing = this.locks.get(jobName);

    // Check if existing lock is expired
    if (existing && existing.expiresAt > now) {
      return false; // Lock held by another
    }

    // Acquire lock
    this.locks.set(jobName, {
      jobName,
      lockedAt: now,
      lockedBy: this.config.instanceId,
      expiresAt: new Date(now.getTime() + this.config.lockTimeoutMs),
      executionId,
    });

    return true;
  }

  /**
   * Release lock
   */
  private releaseLock(jobName: string, executionId: string): void {
    const lock = this.locks.get(jobName);
    if (lock && lock.executionId === executionId) {
      this.locks.delete(jobName);
    }
  }

  /**
   * Find existing execution by idempotency key
   */
  private findExecution(jobName: string, idempotencyKey: string): CronExecution | undefined {
    const cutoff = new Date(Date.now() - this.config.idempotencyWindowMs);
    return this.executions.find(
      e => e.jobName === jobName &&
           e.idempotencyKey === idempotencyKey &&
           e.startedAt > cutoff
    );
  }

  /**
   * Execute with timeout protection
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('EXECUTION_TIMEOUT'));
      }, timeoutMs);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Cleanup old executions
   */
  private cleanupExecutions(): void {
    const cutoff = new Date(Date.now() - this.config.idempotencyWindowMs * 2);
    this.executions = this.executions.filter(e => e.startedAt > cutoff);

    // Keep max 1000 entries
    if (this.executions.length > 1000) {
      this.executions = this.executions.slice(-500);
    }
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private log(level: 'info' | 'warn' | 'error', data: any, msg: string): void {
    if (this.config.logger) {
      this.config.logger[level]?.(data, msg);
    } else {
      console[level](`[CRON] ${msg}`, data);
    }
  }

  /**
   * Get execution history
   */
  getExecutionHistory(jobName?: string, limit = 50): CronExecution[] {
    let filtered = this.executions;
    if (jobName) {
      filtered = filtered.filter(e => e.jobName === jobName);
    }
    return filtered.slice(-limit);
  }

  /**
   * Get lock status
   */
  getLockStatus(jobName: string): { locked: boolean; lock?: CronLock } {
    const lock = this.locks.get(jobName);
    const now = new Date();

    if (!lock || lock.expiresAt <= now) {
      return { locked: false };
    }

    return { locked: true, lock };
  }

  /**
   * Get stats
   */
  getStats(): {
    activeLocksCount: number;
    executionsLast24h: number;
    failuresLast24h: number;
    timeoutsLast24h: number;
  } {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);

    const recent = this.executions.filter(e => e.startedAt > dayAgo);

    return {
      activeLocksCount: Array.from(this.locks.values()).filter(l => l.expiresAt > now).length,
      executionsLast24h: recent.length,
      failuresLast24h: recent.filter(e => e.status === 'FAILED').length,
      timeoutsLast24h: recent.filter(e => e.status === 'TIMEOUT').length,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _cronService: CronHardeningService | null = null;

export function getCronHardeningService(): CronHardeningService {
  if (!_cronService) {
    _cronService = new CronHardeningService();
  }
  return _cronService;
}

export function initCronHardening(config?: CronHardeningConfig): CronHardeningService {
  _cronService = new CronHardeningService(config);
  return _cronService;
}
