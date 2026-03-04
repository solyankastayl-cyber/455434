/**
 * Unit Tests for IntegrationStateResolver
 * 
 * Проверяем все возможные комбинации состояний
 */

import { IntegrationStateResolver, IntegrationStateContext } from '../services/integration-state.resolver.js';
import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

describe('IntegrationStateResolver', () => {
  // Helper для создания контекста
  const createContext = (overrides: Partial<IntegrationStateContext> = {}): IntegrationStateContext => ({
    accountsCount: 0,
    hasConsent: false,
    sessionsCount: 0,
    okSessionsCount: 0,
    staleSessionsCount: 0,
    invalidSessionsCount: 0,
    ...overrides,
  });

  describe('resolve()', () => {
    // 1. NOT_CONNECTED - нет аккаунтов
    test('returns NOT_CONNECTED when no accounts', () => {
      const ctx = createContext({ accountsCount: 0 });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.NOT_CONNECTED);
    });

    // 2. CONSENT_REQUIRED - есть аккаунты, но нет согласия
    test('returns CONSENT_REQUIRED when accounts exist but no consent', () => {
      const ctx = createContext({ accountsCount: 1, hasConsent: false });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.CONSENT_REQUIRED);
    });

    // 3. NEED_COOKIES - есть согласие, но нет сессий
    test('returns NEED_COOKIES when consent given but no sessions', () => {
      const ctx = createContext({ accountsCount: 1, hasConsent: true, sessionsCount: 0 });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.NEED_COOKIES);
    });

    // 4. SESSION_INVALID - есть invalid сессии (наивысший приоритет)
    test('returns SESSION_INVALID when any invalid session exists', () => {
      const ctx = createContext({
        accountsCount: 2,
        hasConsent: true,
        sessionsCount: 2,
        okSessionsCount: 1,
        invalidSessionsCount: 1,
      });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.SESSION_INVALID);
    });

    // 5. SESSION_STALE - есть stale сессии, но нет invalid
    test('returns SESSION_STALE when stale sessions exist (no invalid)', () => {
      const ctx = createContext({
        accountsCount: 2,
        hasConsent: true,
        sessionsCount: 2,
        okSessionsCount: 1,
        staleSessionsCount: 1,
      });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.SESSION_STALE);
    });

    // 6. SESSION_OK - все сессии OK
    test('returns SESSION_OK when all sessions are OK', () => {
      const ctx = createContext({
        accountsCount: 2,
        hasConsent: true,
        sessionsCount: 2,
        okSessionsCount: 2,
      });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.SESSION_OK);
    });

    // 7. Multi-account: INVALID beats STALE
    test('INVALID takes priority over STALE (multi-account)', () => {
      const ctx = createContext({
        accountsCount: 3,
        hasConsent: true,
        sessionsCount: 3,
        okSessionsCount: 1,
        staleSessionsCount: 1,
        invalidSessionsCount: 1,
      });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.SESSION_INVALID);
    });

    // 8. Edge case: сессии есть, но все не OK и не STALE и не INVALID
    test('returns NEED_COOKIES when sessions exist but none are OK', () => {
      const ctx = createContext({
        accountsCount: 1,
        hasConsent: true,
        sessionsCount: 1,
        okSessionsCount: 0,
        staleSessionsCount: 0,
        invalidSessionsCount: 0,
      });
      expect(IntegrationStateResolver.resolve(ctx)).toBe(TwitterIntegrationState.NEED_COOKIES);
    });
  });

  describe('resolveWithDetails()', () => {
    test('returns full details with state', () => {
      const ctx = createContext({
        accountsCount: 2,
        hasConsent: true,
        sessionsCount: 3,
        okSessionsCount: 2,
        staleSessionsCount: 1,
      });

      const result = IntegrationStateResolver.resolveWithDetails(ctx);

      expect(result.state).toBe(TwitterIntegrationState.SESSION_STALE);
      expect(result.accounts).toBe(2);
      expect(result.sessions).toEqual({
        total: 3,
        ok: 2,
        stale: 1,
        invalid: 0,
      });
    });
  });
});
