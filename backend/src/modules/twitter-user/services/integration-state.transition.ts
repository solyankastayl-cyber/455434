/**
 * IntegrationStateTransitionService - фиксация переходов состояний
 * 
 * Просто сравнивает prev и next.
 * Никакой логики - только факт перехода.
 */

import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

export interface StateTransitionResult {
  prev: TwitterIntegrationState | null;
  next: TwitterIntegrationState;
  changed: boolean;
}

export class IntegrationStateTransitionService {
  /**
   * Вычисляет результат перехода
   */
  static compute(
    prev: TwitterIntegrationState | null,
    next: TwitterIntegrationState
  ): StateTransitionResult {
    return {
      prev,
      next,
      changed: prev !== next,
    };
  }

  /**
   * Проверка - переход требует уведомления
   * 
   * Уведомляем только о важных переходах:
   * - → SESSION_OK (успех)
   * - → SESSION_STALE (предупреждение)
   * - → SESSION_INVALID (критично)
   */
  static shouldNotify(transition: StateTransitionResult): boolean {
    if (!transition.changed) return false;

    // Всегда уведомляем о критичных состояниях
    const notifiableStates = [
      TwitterIntegrationState.SESSION_OK,
      TwitterIntegrationState.SESSION_STALE,
      TwitterIntegrationState.SESSION_INVALID,
    ];

    return notifiableStates.includes(transition.next);
  }
}
