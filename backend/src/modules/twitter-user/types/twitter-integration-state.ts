/**
 * TwitterIntegrationState - единый enum для всей системы
 * 
 * Используется:
 * - Backend API
 * - UI
 * - Chrome Extension
 * - Telegram уведомления
 * 
 * ПРАВИЛО: State ВСЕГДА вычисляемый через Resolver
 * Хранится только snapshot для Telegram сравнения
 * 
 * Приоритет (от худшего к лучшему):
 * SESSION_INVALID > SESSION_STALE > SESSION_OK
 */

export enum TwitterIntegrationState {
  /** Нет привязанных аккаунтов */
  NOT_CONNECTED = 'NOT_CONNECTED',
  
  /** Нет юридического согласия пользователя */
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  
  /** Аккаунт есть, но cookies не загружены */
  NEED_COOKIES = 'NEED_COOKIES',
  
  /** Всё работает, сессия активна */
  SESSION_OK = 'SESSION_OK',
  
  /** Сессия скоро истечёт (high risk) */
  SESSION_STALE = 'SESSION_STALE',
  
  /** Сессия истекла - нужен resync cookies */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  /** Сессия недействительна / заблокирована */
  SESSION_INVALID = 'SESSION_INVALID',
}

/** Приоритет состояний для multi-account (меньше = хуже) */
export const STATE_PRIORITY: Record<TwitterIntegrationState, number> = {
  [TwitterIntegrationState.SESSION_INVALID]: 0,
  [TwitterIntegrationState.SESSION_EXPIRED]: 1,
  [TwitterIntegrationState.SESSION_STALE]: 2,
  [TwitterIntegrationState.NEED_COOKIES]: 3,
  [TwitterIntegrationState.CONSENT_REQUIRED]: 4,
  [TwitterIntegrationState.NOT_CONNECTED]: 5,
  [TwitterIntegrationState.SESSION_OK]: 6,
};

/** Проверка - состояние требует действия пользователя */
export function requiresUserAction(state: TwitterIntegrationState): boolean {
  return [
    TwitterIntegrationState.NOT_CONNECTED,
    TwitterIntegrationState.CONSENT_REQUIRED,
    TwitterIntegrationState.NEED_COOKIES,
    TwitterIntegrationState.SESSION_EXPIRED,
    TwitterIntegrationState.SESSION_INVALID,
  ].includes(state);
}

/** Проверка - сессия активна (можно парсить) */
export function isSessionActive(state: TwitterIntegrationState): boolean {
  return [
    TwitterIntegrationState.SESSION_OK,
    TwitterIntegrationState.SESSION_STALE,
  ].includes(state);
}
