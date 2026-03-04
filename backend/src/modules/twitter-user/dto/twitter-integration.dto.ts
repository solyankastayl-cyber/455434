/**
 * Twitter Integration DTOs
 * 
 * Используем TwitterIntegrationState enum вместо строк
 */

import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

/** Ответ API /integration/status */
export interface TwitterIntegrationStatusDTO {
  /** Текущее состояние (из enum) */
  state: TwitterIntegrationState;
  
  /** Количество привязанных аккаунтов */
  accounts: number;
  
  /** Статистика сессий */
  sessions: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
  };
  
  /** Дополнительные детали для UI */
  details?: {
    consentAccepted: boolean;
    primaryAccount?: { username: string };
  };
}

/** Запрос на принятие согласия */
export interface AcceptConsentDTO {
  accepted: boolean;
}

/** Ответ на принятие согласия */
export interface AcceptConsentResponseDTO {
  ok: boolean;
  state: TwitterIntegrationState;
}
