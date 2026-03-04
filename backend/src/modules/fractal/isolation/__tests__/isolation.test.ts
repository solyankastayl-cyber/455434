/**
 * BLOCK B.5 — Isolation Tests with Mock Dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FailContainment,
  type SafeSignalResult,
} from '../fail.containment.js';
import {
  defaultLogger,
  defaultClock,
  createSettingsFromEnv,
  isValidHostDeps,
  type FractalHostDeps,
  type Logger,
} from '../fractal.host.deps.js';

// Mock implementations
const createMockLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const createMockDb = () => ({
  getCollection: vi.fn().mockReturnValue({
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    countDocuments: vi.fn().mockResolvedValue(0),
  }),
  isConnected: vi.fn().mockReturnValue(true),
});

const createMockSettings = (env: Record<string, string> = {}) => ({
  get: <T>(key: string, def?: T) => (env[key] as T) ?? def,
  getBool: (key: string, def = false) => env[key] === 'true' || def,
  getNum: (key: string, def = 0) => Number(env[key]) || def,
  getStr: (key: string, def = '') => env[key] ?? def,
  getArray: <T = string>(_key: string, def: T[] = []) => def,
});

// ═══════════════════════════════════════════════════════════════
// TESTS: Fail Containment
// ═══════════════════════════════════════════════════════════════

describe('FailContainment', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('wrapSignal', () => {
    it('should return successful signal on success', async () => {
      const containment = new FailContainment({}, mockLogger);
      
      const successResult: SafeSignalResult = {
        ok: true,
        signal: 'LONG',
        confidence: 0.85,
        reason: 'Test signal',
        containmentTriggered: false,
        timestamp: new Date().toISOString(),
      };

      const result = await containment.wrapSignal(async () => successResult);

      expect(result.ok).toBe(true);
      expect(result.signal).toBe('LONG');
      expect(result.confidence).toBe(0.85);
      expect(result.containmentTriggered).toBe(false);
    });

    it('should return HOLD on error', async () => {
      const containment = new FailContainment({ maxRetries: 0 }, mockLogger);
      
      const result = await containment.wrapSignal(async () => {
        throw new Error('Test error');
      });

      expect(result.ok).toBe(false);
      expect(result.signal).toBe('HOLD');
      expect(result.confidence).toBe(0);
      expect(result.containmentTriggered).toBe(true);
      expect(result.error).toBe('Test error');
    });

    it('should retry on failure then succeed', async () => {
      const containment = new FailContainment({ maxRetries: 2, retryDelayMs: 10 }, mockLogger);
      let attempts = 0;
      
      const result = await containment.wrapSignal(async () => {
        attempts++;
        if (attempts < 2) throw new Error('Retry');
        return {
          ok: true,
          signal: 'SHORT' as const,
          confidence: 0.7,
          reason: 'Success after retry',
          containmentTriggered: false,
          timestamp: new Date().toISOString(),
        };
      });

      expect(result.ok).toBe(true);
      expect(result.signal).toBe('SHORT');
      expect(attempts).toBe(2);
    });

    it('should log errors when configured', async () => {
      const containment = new FailContainment({ maxRetries: 0, logErrors: true }, mockLogger);
      
      await containment.wrapSignal(async () => {
        throw new Error('Logged error');
      }, 'TestContext');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('wrapSync', () => {
    it('should return value on success', () => {
      const containment = new FailContainment({}, mockLogger);
      const result = containment.wrapSync(() => 42, 0);
      expect(result).toBe(42);
    });

    it('should return fallback on error', () => {
      const containment = new FailContainment({}, mockLogger);
      const result = containment.wrapSync(() => { throw new Error('Sync error'); }, 999);
      expect(result).toBe(999);
    });
  });

  describe('getStats', () => {
    it('should track error count', async () => {
      const containment = new FailContainment({ maxRetries: 0 }, mockLogger);
      
      await containment.wrapSignal(async () => { throw new Error('E1'); });
      await containment.wrapSignal(async () => { throw new Error('E2'); });
      
      const stats = containment.getStats();
      expect(stats.errorCount).toBe(2);
      expect(stats.lastError).toBe('E2');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTS: Host Dependencies
// ═══════════════════════════════════════════════════════════════

describe('FractalHostDeps', () => {
  describe('defaultLogger', () => {
    it('should have all required methods', () => {
      expect(typeof defaultLogger.info).toBe('function');
      expect(typeof defaultLogger.warn).toBe('function');
      expect(typeof defaultLogger.error).toBe('function');
    });
  });

  describe('defaultClock', () => {
    it('should return current time', () => {
      const before = Date.now();
      const now = defaultClock.now();
      const after = Date.now();
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after);
    });

    it('should convert to ISO string', () => {
      const iso = defaultClock.toISOString(1700000000000);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('createSettingsFromEnv', () => {
    it('should return defaults for missing vars', () => {
      const settings = createSettingsFromEnv();
      expect(settings.getStr('NONEXISTENT', 'default')).toBe('default');
      expect(settings.getNum('NONEXISTENT', 42)).toBe(42);
      expect(settings.getBool('NONEXISTENT', true)).toBe(true);
    });
  });

  describe('isValidHostDeps', () => {
    it('should validate complete deps', () => {
      const deps: Partial<FractalHostDeps> = {
        app: {} as any,
        logger: createMockLogger(),
        clock: defaultClock,
        db: createMockDb(),
        settings: createMockSettings(),
      };
      expect(isValidHostDeps(deps)).toBe(true);
    });

    it('should reject incomplete deps', () => {
      const deps: Partial<FractalHostDeps> = { app: {} as any };
      expect(isValidHostDeps(deps)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTS: Integration with Mocks
// ═══════════════════════════════════════════════════════════════

describe('Isolation Integration', () => {
  it('should work with fully mocked dependencies', async () => {
    const mockLogger = createMockLogger();
    const mockSettings = createMockSettings({
      FRACTAL_ENABLED: 'true',
      FRACTAL_FROZEN: 'true',
    });

    const containment = new FailContainment({ fallbackSignal: 'HOLD' }, mockLogger);
    
    const generateSignal = async (): Promise<SafeSignalResult> => {
      const frozen = mockSettings.getBool('FRACTAL_FROZEN');
      return {
        ok: true,
        signal: frozen ? 'HOLD' : 'LONG',
        confidence: 0.75,
        reason: frozen ? 'Contract frozen' : 'Signal generated',
        containmentTriggered: false,
        timestamp: new Date().toISOString(),
      };
    };

    const result = await containment.wrapSignal(generateSignal);

    expect(result.ok).toBe(true);
    expect(result.signal).toBe('HOLD');
    expect(result.containmentTriggered).toBe(false);
  });

  it('should contain database failures', async () => {
    const mockLogger = createMockLogger();
    const containment = new FailContainment({ maxRetries: 0 }, mockLogger);
    
    const result = await containment.wrapSignal(async () => {
      throw new Error('Connection refused');
    }, 'DatabaseOperation');

    expect(result.ok).toBe(false);
    expect(result.signal).toBe('HOLD');
    expect(result.containmentTriggered).toBe(true);
    expect(result.error).toContain('Connection refused');
  });
});
