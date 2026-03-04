/**
 * IntegrationStateNotifier V2 - Telegram уведомления при смене состояния
 * 
 * ПРАВИЛО: Уведомления отправляются через TelegramNotifierV2
 * который сам резолвит chatId по ownerUserId
 */

import { TwitterIntegrationState } from '../types/twitter-integration-state.js';
import type { StateTransitionResult } from './integration-state.transition.js';
import { TelegramNotifierV2 } from '../notifications/telegram-notifier.js';

interface StateNotificationConfig {
  type: 'SESSION_OK' | 'SESSION_STALE' | 'SESSION_INVALID';
  payload?: Record<string, any>;
}

const STATE_TO_NOTIFICATION: Partial<Record<TwitterIntegrationState, StateNotificationConfig>> = {
  [TwitterIntegrationState.SESSION_OK]: {
    type: 'SESSION_OK',
  },
  [TwitterIntegrationState.SESSION_STALE]: {
    type: 'SESSION_STALE',
  },
  [TwitterIntegrationState.SESSION_INVALID]: {
    type: 'SESSION_INVALID',
  },
};

export class IntegrationStateNotifier {
  /**
   * Отправить уведомление если состояние изменилось
   * 
   * @param userId - ID пользователя
   * @param telegramChatId - Telegram chat ID (для обратной совместимости, можно null)
   * @param transition - результат перехода состояния
   * @param meta - дополнительные данные (account, reason и т.д.)
   */
  static async notify(
    userId: string,
    telegramChatId: string | null,
    transition: StateTransitionResult,
    meta?: { account?: string; reason?: string }
  ): Promise<void> {
    // Не уведомляем если нет изменений
    if (!transition.changed) return;

    // Проверяем есть ли конфиг для этого состояния
    const config = STATE_TO_NOTIFICATION[transition.next];
    if (!config) return;

    console.log(`[StateNotifier] ${userId}: ${transition.prev} → ${transition.next}`);

    // Отправляем через TelegramNotifierV2 (сам резолвит chatId)
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: config.type,
        payload: {
          account: meta?.account,
          reason: meta?.reason,
        },
      });
    } catch (err) {
      console.error('[StateNotifier] Failed to send notification:', err);
    }
  }
}
