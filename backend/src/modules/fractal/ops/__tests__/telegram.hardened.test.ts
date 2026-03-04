/**
 * BLOCK E — Telegram Hardening Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TelegramHardenedService,
  type TelegramHardenedConfig,
} from '../telegram.hardened.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TelegramHardenedService', () => {
  let service: TelegramHardenedService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TelegramHardenedService({
      token: 'test-token',
      chatId: 'test-chat',
      maxRetries: 2,
      baseDelayMs: 10,
      rateLimit: { maxPerMinute: 5, maxPerHour: 20 },
      dedupeWindowMs: 1000,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send message successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      });

      const result = await service.send('Test message', 'INFO');

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe(123);
      expect(result.retries).toBe(0);
      expect(result.rateLimited).toBe(false);
      expect(result.deduplicated).toBe(false);
    });

    it('should deduplicate identical messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      });

      // First send
      const result1 = await service.send('Same message', 'INFO');
      expect(result1.ok).toBe(true);
      expect(result1.deduplicated).toBe(false);

      // Second send (same message within window)
      const result2 = await service.send('Same message', 'INFO');
      expect(result2.ok).toBe(true);
      expect(result2.deduplicated).toBe(true);

      // Fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should bypass dedupe with force option', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      });

      await service.send('Force message', 'INFO');
      const result = await service.send('Force message', 'INFO', { force: true });

      expect(result.deduplicated).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should rate limit when exceeding maxPerMinute', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      });

      // Send 5 messages (at limit)
      for (let i = 0; i < 5; i++) {
        await service.send(`Message ${i}`, 'INFO');
      }

      // 6th should be rate limited
      const result = await service.send('One more', 'INFO');

      expect(result.ok).toBe(false);
      expect(result.rateLimited).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should retry on failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 456 } }),
        });

      const result = await service.send('Retry message', 'INFO');

      expect(result.ok).toBe(true);
      expect(result.retries).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent error'));

      const result = await service.send('Failing message', 'INFO');

      expect(result.ok).toBe(false);
      expect(result.retries).toBe(2); // maxRetries
      expect(result.error).toBe('Persistent error');
    });
  });

  describe('sendCritical', () => {
    it('should bypass deduplication', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 789 } }),
      });

      await service.send('Critical', 'CRITICAL');
      const result = await service.sendCritical('Critical');

      expect(result.deduplicated).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStats', () => {
    it('should track send statistics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      });

      await service.send('Msg 1', 'INFO');
      await service.send('Msg 2', 'INFO');

      const stats = service.getStats();

      expect(stats.sentLast5Min).toBe(2);
      expect(stats.sentLastHour).toBe(2);
    });
  });
});
