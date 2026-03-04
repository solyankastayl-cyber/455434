/**
 * IntegrationService - единая точка входа для состояния интеграции
 * 
 * ПРАВИЛО: Вся логика через Resolver
 * UI, Telegram, Extension - только читают результат
 */

import { TwitterConsentModel } from '../models/twitter-consent.model.js';
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { TwitterIntegrationSnapshotModel } from '../models/twitter-integration-snapshot.model.js';
import { TwitterIntegrationState } from '../types/twitter-integration-state.js';
import { IntegrationStateResolver, type IntegrationStateContext, type IntegrationStateResult } from './integration-state.resolver.js';
import { IntegrationStateTransitionService } from './integration-state.transition.js';
import { IntegrationStateNotifier } from './integration-state.notifier.js';
import { TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';
import { userScope } from '../acl/ownership.js';

/** DTO для API ответа */
export interface IntegrationStatusResponse {
  state: TwitterIntegrationState;
  accounts: number;
  sessions: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
  };
  /** Детали для UI (опционально) */
  details?: {
    consentAccepted: boolean;
    primaryAccount?: { username: string };
  };
}

export class IntegrationService {
  /**
   * Получить текущее состояние интеграции
   * 
   * Единственный публичный endpoint для UI/Telegram/Extension
   */
  async getStatus(userId: string): Promise<IntegrationStatusResponse> {
    // 1. Собираем контекст
    console.log('[IntegrationService.getStatus] userId:', userId);
    const ctx = await this.buildContext(userId);
    console.log('[IntegrationService.getStatus] context:', JSON.stringify(ctx, null, 2));
    
    // 2. Вычисляем состояние через Resolver
    const result = IntegrationStateResolver.resolveWithDetails(ctx);
    
    // 3. Проверяем изменение состояния и уведомляем
    await this.checkAndNotifyStateChange(userId, result.state);
    
    // 4. Формируем ответ
    const consent = await TwitterConsentModel.findOne({ ownerUserId: userId }).lean();
    const primaryAccount = await UserTwitterAccountModel.findOne(userScope(userId))
      .sort({ updatedAt: -1 })
      .lean();
    
    return {
      state: result.state,
      accounts: result.accounts,
      sessions: result.sessions,
      details: {
        consentAccepted: !!consent?.accepted,
        primaryAccount: primaryAccount ? { username: primaryAccount.username } : undefined,
      },
    };
  }

  /**
   * Принять согласие пользователя
   */
  async acceptConsent(
    userId: string,
    meta: { ip?: string; userAgent?: string }
  ): Promise<void> {
    await TwitterConsentModel.updateOne(
      { ownerUserId: userId },
      {
        $set: {
          ownerUserId: userId,
          accepted: true,
          acceptedAt: new Date(),
          ip: meta.ip,
          userAgent: meta.userAgent,
          version: 'v1',
        },
      },
      { upsert: true }
    );

    // Проверяем изменение состояния после принятия consent
    const ctx = await this.buildContext(userId);
    const newState = IntegrationStateResolver.resolve(ctx);
    await this.checkAndNotifyStateChange(userId, newState);
  }

  /**
   * Установить Telegram chat ID для уведомлений
   */
  async setTelegramChatId(userId: string, chatId: string): Promise<void> {
    await TelegramConnectionModel.updateOne(
      { userId },
      { 
        $set: { 
          chatId,
          isActive: true,
          connectedAt: new Date()
        } 
      },
      { upsert: true }
    );
    console.log(`[Integration] Telegram linked for user ${userId}, chatId: ${chatId}`);
  }

  /**
   * Удалить Telegram chat ID (отключить уведомления)
   */
  async removeTelegramChatId(userId: string): Promise<void> {
    await TelegramConnectionModel.updateOne(
      { userId },
      { $set: { isActive: false } }
    );
    console.log(`[Integration] Telegram unlinked for user ${userId}`);
  }

  /**
   * Принудительная проверка и уведомление о состоянии
   * Вызывается из workers при изменении сессий
   */
  async recheckState(userId: string): Promise<TwitterIntegrationState> {
    const ctx = await this.buildContext(userId);
    const newState = IntegrationStateResolver.resolve(ctx);
    await this.checkAndNotifyStateChange(userId, newState);
    return newState;
  }

  /**
   * Собрать контекст для Resolver
   */
  private async buildContext(userId: string): Promise<IntegrationStateContext> {
    const scope = userScope(userId);

    // Параллельные запросы
    const [consent, accountsCount, sessions] = await Promise.all([
      TwitterConsentModel.findOne({ ownerUserId: userId }).lean(),
      UserTwitterAccountModel.countDocuments(scope),
      UserTwitterSessionModel.find(scope).select('status').lean(),
    ]);

    // Подсчёт сессий по статусам
    const okSessionsCount = sessions.filter(s => s.status === 'OK').length;
    const staleSessionsCount = sessions.filter(s => s.status === 'STALE').length;
    const invalidSessionsCount = sessions.filter(s => s.status === 'INVALID').length;

    return {
      hasConsent: !!consent?.accepted,
      accountsCount,
      sessionsCount: sessions.length,
      okSessionsCount,
      staleSessionsCount,
      invalidSessionsCount,
    };
  }

  /**
   * Проверить изменение состояния и отправить уведомление
   */
  private async checkAndNotifyStateChange(
    userId: string,
    newState: TwitterIntegrationState
  ): Promise<void> {
    // Получаем предыдущее состояние
    const snapshot = await TwitterIntegrationSnapshotModel.findOne({ ownerUserId: userId }).lean();
    const prevState = snapshot?.lastState ?? null;

    // Вычисляем переход
    const transition = IntegrationStateTransitionService.compute(prevState, newState);

    // Если состояние изменилось - сохраняем и уведомляем
    if (transition.changed) {
      await TwitterIntegrationSnapshotModel.updateOne(
        { ownerUserId: userId },
        {
          $set: {
            ownerUserId: userId,
            lastState: newState,
            stateChangedAt: new Date(),
          },
        },
        { upsert: true }
      );

      // Отправляем Telegram уведомление
      const telegramChatId = snapshot?.telegramChatId ?? null;
      await IntegrationStateNotifier.notify(userId, telegramChatId, transition);
    }
  }
}
