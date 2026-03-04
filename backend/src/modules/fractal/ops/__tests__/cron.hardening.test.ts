/**
 * BLOCK E — Cron Hardening Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CronHardeningService } from '../cron.hardening.js';

describe('CronHardeningService', () => {
  let service: CronHardeningService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CronHardeningService({
      lockTimeoutMs: 5000,
      executionTimeoutMs: 10000,
      idempotencyWindowMs: 60000,
      logger: mockLogger,
    });
  });

  describe('executeWithHardening', () => {
    it('should execute job successfully', async () => {
      const jobFn = vi.fn().mockResolvedValue({ data: 'success' });

      const result = await service.executeWithHardening(
        'test-job',
        'key-1',
        jobFn
      );

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ data: 'success' });
      expect(result.skipped).toBeUndefined();
      expect(jobFn).toHaveBeenCalledTimes(1);
    });

    it('should skip if already completed (idempotency)', async () => {
      const jobFn = vi.fn().mockResolvedValue({ data: 'first' });

      // First execution
      const result1 = await service.executeWithHardening('test-job', 'key-same', jobFn);
      expect(result1.ok).toBe(true);
      expect(result1.skipped).toBeUndefined();

      // Second execution with same key
      const result2 = await service.executeWithHardening('test-job', 'key-same', jobFn);
      expect(result2.ok).toBe(true);
      expect(result2.skipped).toBe(true);
      expect(result2.skipReason).toBe('ALREADY_COMPLETED');

      // Job should only run once
      expect(jobFn).toHaveBeenCalledTimes(1);
    });

    it('should prevent parallel execution (lock)', async () => {
      let resolveFirst: () => void;
      const firstJobPromise = new Promise<void>(r => { resolveFirst = r; });

      const slowJob = vi.fn().mockImplementation(async () => {
        await firstJobPromise;
        return { done: true };
      });

      // Start first job (will wait)
      const result1Promise = service.executeWithHardening('lock-test', 'key-a', slowJob);

      // Try to start second job immediately
      const result2 = await service.executeWithHardening('lock-test', 'key-b', slowJob);

      // Second should be skipped due to lock
      expect(result2.ok).toBe(false);
      expect(result2.skipped).toBe(true);
      expect(result2.skipReason).toBe('LOCK_HELD');

      // Resolve first job
      resolveFirst!();
      const result1 = await result1Promise;
      expect(result1.ok).toBe(true);

      // slowJob should only be called once
      expect(slowJob).toHaveBeenCalledTimes(1);
    });

    it('should handle job failure', async () => {
      const failingJob = vi.fn().mockRejectedValue(new Error('Job crashed'));

      const result = await service.executeWithHardening(
        'fail-test',
        'key-fail',
        failingJob
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Job crashed');
    });

    it('should timeout long-running jobs', async () => {
      // Create service with short timeout
      const shortTimeoutService = new CronHardeningService({
        executionTimeoutMs: 50,
        logger: mockLogger,
      });

      const slowJob = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 200))
      );

      const result = await shortTimeoutService.executeWithHardening(
        'timeout-test',
        'key-timeout',
        slowJob
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('EXECUTION_TIMEOUT');
    });
  });

  describe('generateDailyKey', () => {
    it('should generate date-based key', () => {
      const key = service.generateDailyKey('fractal-daily', 'BTC');
      const today = new Date().toISOString().slice(0, 10);

      expect(key).toBe(`fractal-daily:BTC:${today}`);
    });

    it('should use default symbol', () => {
      const key = service.generateDailyKey('some-job');

      expect(key).toContain('some-job:default:');
    });
  });

  describe('getLockStatus', () => {
    it('should return unlocked when no lock', () => {
      const status = service.getLockStatus('nonexistent');

      expect(status.locked).toBe(false);
      expect(status.lock).toBeUndefined();
    });

    it('should return locked during execution', async () => {
      let resolveJob: () => void;
      const pendingJob = new Promise<void>(r => { resolveJob = r; });

      const jobPromise = service.executeWithHardening(
        'lock-check',
        'key',
        async () => { await pendingJob; return {}; }
      );

      // Check lock while job is running
      const status = service.getLockStatus('lock-check');
      expect(status.locked).toBe(true);
      expect(status.lock).toBeDefined();
      expect(status.lock?.jobName).toBe('lock-check');

      // Cleanup
      resolveJob!();
      await jobPromise;
    });
  });

  describe('getStats', () => {
    it('should track execution statistics', async () => {
      const successJob = vi.fn().mockResolvedValue({});
      const failJob = vi.fn().mockRejectedValue(new Error('fail'));

      await service.executeWithHardening('s1', 'k1', successJob);
      await service.executeWithHardening('s2', 'k2', successJob);
      await service.executeWithHardening('f1', 'k3', failJob);

      const stats = service.getStats();

      expect(stats.executionsLast24h).toBe(3);
      expect(stats.failuresLast24h).toBe(1);
    });
  });

  describe('getExecutionHistory', () => {
    it('should return execution history', async () => {
      const job = vi.fn().mockResolvedValue({});

      await service.executeWithHardening('hist-job', 'k1', job);
      await service.executeWithHardening('hist-job', 'k2', job);

      const history = service.getExecutionHistory('hist-job');

      expect(history.length).toBe(2);
      expect(history[0].jobName).toBe('hist-job');
      expect(history[0].status).toBe('COMPLETED');
    });
  });
});
