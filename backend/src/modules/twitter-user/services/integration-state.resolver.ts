/**
 * IntegrationStateResolver - единственный источник истины для состояния
 * 
 * ПРАВИЛО: UI, Telegram, Extension НЕ делают свою логику
 * Все спрашивают только Resolver
 * 
 * Приоритет (строго в таком порядке):
 * 1. CONSENT_REQUIRED - нет согласия (ПЕРВЫЙ, даже до аккаунтов!)
 * 2. NOT_CONNECTED - нет аккаунтов
 * 3. NEED_COOKIES - нет сессий с cookies
 * 4. SESSION_INVALID - есть невалидные сессии (cookies есть, но нерабочие)
 * 5. SESSION_STALE - есть устаревающие сессии
 * 6. SESSION_OK - всё работает
 */

import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

/** Контекст для вычисления состояния */
export interface IntegrationStateContext {
  /** Количество привязанных аккаунтов */
  accountsCount: number;
  
  /** Принято ли согласие пользователя */
  hasConsent: boolean;
  
  /** Общее количество сессий */
  sessionsCount: number;
  
  /** Количество сессий со статусом OK */
  okSessionsCount: number;
  
  /** Количество сессий со статусом STALE */
  staleSessionsCount: number;
  
  /** Количество сессий со статусом INVALID */
  invalidSessionsCount: number;
  
  /** Количество сессий со статусом EXPIRED */
  expiredSessionsCount: number;
}

/** Результат резолвера с детальной информацией */
export interface IntegrationStateResult {
  state: TwitterIntegrationState;
  accounts: number;
  sessions: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
    expired: number;
  };
}

export class IntegrationStateResolver {
  /**
   * Вычисляет состояние интеграции по контексту
   * 
   * ВАЖНО: Порядок проверок критичен!
   * Multi-account: состояние считается по ХУДШЕМУ аккаунту
   */
  static resolve(ctx: IntegrationStateContext): TwitterIntegrationState {
    // 1. Нет согласия → CONSENT_REQUIRED (ПЕРВЫЙ приоритет!)
    //    Даже если нет аккаунтов, сначала должен быть consent
    if (!ctx.hasConsent) {
      return TwitterIntegrationState.CONSENT_REQUIRED;
    }

    // 2. Нет аккаунтов → NOT_CONNECTED (после consent)
    if (ctx.accountsCount === 0) {
      return TwitterIntegrationState.NOT_CONNECTED;
    }

    // 3. Нет сессий → NEED_COOKIES
    if (ctx.sessionsCount === 0) {
      return TwitterIntegrationState.NEED_COOKIES;
    }

    // 4. Есть EXPIRED сессии → SESSION_EXPIRED (нужен resync)
    if (ctx.expiredSessionsCount > 0) {
      return TwitterIntegrationState.SESSION_EXPIRED;
    }

    // 5. Есть невалидные сессии → SESSION_INVALID (худший случай)
    if (ctx.invalidSessionsCount > 0) {
      return TwitterIntegrationState.SESSION_INVALID;
    }

    // 6. Есть устаревающие сессии → SESSION_STALE
    if (ctx.staleSessionsCount > 0) {
      return TwitterIntegrationState.SESSION_STALE;
    }

    // 7. Есть OK сессии → SESSION_OK
    if (ctx.okSessionsCount > 0) {
      return TwitterIntegrationState.SESSION_OK;
    }

    // Fallback: нет OK сессий, но сессии есть → NEED_COOKIES
    return TwitterIntegrationState.NEED_COOKIES;
  }

  /**
   * Полный резолв с детальной информацией для API
   */
  static resolveWithDetails(ctx: IntegrationStateContext): IntegrationStateResult {
    return {
      state: this.resolve(ctx),
      accounts: ctx.accountsCount,
      sessions: {
        total: ctx.sessionsCount,
        ok: ctx.okSessionsCount,
        stale: ctx.staleSessionsCount,
        invalid: ctx.invalidSessionsCount,
        expired: ctx.expiredSessionsCount,
      },
    };
  }
}
