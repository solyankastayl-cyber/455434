/**
 * Alerts Service (P0 Architecture)
 * Business logic for alerts and alert rules
 * 
 * Key: AlertRule always linked to WatchlistItem (auto-created)
 */
import { THROTTLE_MS } from './alert_rules.model.js';
import type { 
  IAlertRule, 
  AlertScope, 
  AlertTriggerType, 
  ThrottleInterval,
  AlertChannels,
  AlertTriggerConfig,
} from './alert_rules.model.js';
import { generateAlertTitle, generateAlertMessage } from './alerts.model.js';
import type { IAlert } from './alerts.model.js';
import * as rulesRepo from './alert_rules.repository.js';
import * as alertsRepo from './alerts.repository.js';
import type { IStrategySignal } from '../strategy_signals/strategy_signals.model.js';

// ========== ALERT RULES ==========

/**
 * Create alert rule with auto-created WatchlistItem
 */
export async function createAlertRule(
  userId: string,
  scope: AlertScope,
  targetId: string,
  triggerTypes: AlertTriggerType[],
  options: {
    trigger?: AlertTriggerConfig;
    channels?: AlertChannels;
    minSeverity?: number;
    minConfidence?: number;
    minStability?: number;
    throttle?: ThrottleInterval;
    sensitivity?: 'low' | 'medium' | 'high';  // A5.4: Sensitivity level
    name?: string;
    targetMeta?: { symbol?: string; name?: string; chain?: string };
  } = {}
): Promise<IAlertRule> {
  return rulesRepo.createAlertRule({
    userId,
    scope,
    targetId,
    triggerTypes,
    trigger: options.trigger,
    channels: options.channels,
    minSeverity: options.minSeverity,
    minConfidence: options.minConfidence,
    throttle: options.throttle,
    sensitivity: options.sensitivity,  // A5.4: Pass sensitivity
    name: options.name,
    targetMeta: options.targetMeta,
  });
}

/**
 * Get user's alert rules
 */
export async function getUserAlertRules(
  userId: string,
  activeOnly: boolean = false
): Promise<IAlertRule[]> {
  return rulesRepo.getAlertRulesByUser(userId, activeOnly);
}

/**
 * Update alert rule
 */
export async function updateAlertRule(
  ruleId: string,
  userId: string,
  update: rulesRepo.UpdateAlertRuleInput
): Promise<IAlertRule | null> {
  // Verify ownership
  const rule = await rulesRepo.getAlertRuleById(ruleId);
  if (!rule || rule.userId !== userId) {
    return null;
  }
  
  return rulesRepo.updateAlertRule(ruleId, update);
}

/**
 * Delete alert rule
 */
export async function deleteAlertRule(
  ruleId: string,
  userId: string
): Promise<boolean> {
  // Verify ownership
  const rule = await rulesRepo.getAlertRuleById(ruleId);
  if (!rule || rule.userId !== userId) {
    return false;
  }
  
  return rulesRepo.deleteAlertRule(ruleId);
}

// ========== ALERTS ==========

/**
 * Get user's alert feed
 */
export async function getAlertFeed(
  userId: string,
  options: {
    unacknowledgedOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IAlert[]> {
  return alertsRepo.getAlertsByUser(userId, options);
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(
  alertId: string,
  userId: string
): Promise<IAlert | null> {
  // Verify ownership
  const alert = await alertsRepo.getAlertById(alertId);
  if (!alert || alert.userId !== userId) {
    return null;
  }
  
  const acknowledged = await alertsRepo.acknowledgeAlert(alertId);
  
  // Invalidate snapshots for the alert target (living system feel)
  if (acknowledged) {
    try {
      const { onAlertAcknowledged } = await import('../snapshots/snapshot_invalidation.service.js');
      await onAlertAcknowledged(alertId, alert.targetId);
    } catch (err) {
      // Non-critical, log and continue
      console.error('[Alerts] Snapshot invalidation failed:', err);
    }
  }
  
  return acknowledged;
}

/**
 * Acknowledge all alerts
 */
export async function acknowledgeAllAlerts(userId: string): Promise<number> {
  return alertsRepo.acknowledgeAllAlerts(userId);
}

/**
 * Get unacknowledged count
 */
export async function getUnacknowledgedCount(userId: string): Promise<number> {
  return alertsRepo.getUnacknowledgedCount(userId);
}

/**
 * Get alerts stats
 */
export async function getAlertsStats(userId?: string) {
  return alertsRepo.getAlertsStats(userId);
}

// ========== DISPATCH ENGINE ==========

/**
 * Process a strategy signal and create alerts for matching rules
 */
export async function dispatchAlertForSignal(
  signal: IStrategySignal
): Promise<number> {
  let alertsCreated = 0;
  
  // Determine scope and targetId from signal
  // For strategy signals, we can match on:
  // 1. scope='actor', targetId=actorAddress
  // 2. scope='strategy', targetId=strategyType
  
  const scopes: Array<{ scope: AlertScope; targetId: string }> = [
    { scope: 'actor', targetId: signal.actorAddress },
    { scope: 'strategy', targetId: signal.strategyType },
  ];
  
  for (const { scope, targetId } of scopes) {
    // Find matching rules
    const rules = await rulesRepo.getMatchingRules(scope, targetId, signal.type);
    
    for (const rule of rules) {
      // Check severity threshold
      if (signal.severity < rule.minSeverity) continue;
      
      // Check confidence threshold
      if (signal.confidence < rule.minConfidence) continue;
      
      // Check stability threshold (if set)
      if (rule.minStability !== undefined && signal.stability < rule.minStability) continue;
      
      // Check throttle
      const lastAlert = await alertsRepo.getLastAlertForThrottle(
        rule.userId,
        rule._id.toString(),
        signal.type
      );
      
      if (lastAlert) {
        const throttleMs = THROTTLE_MS[rule.throttle];
        const timeSinceLastAlert = Date.now() - new Date(lastAlert.createdAt).getTime();
        
        if (timeSinceLastAlert < throttleMs) {
          continue; // Still in throttle period
        }
      }
      
      // Check dedup
      const exists = await alertsRepo.alertExists(
        rule.userId,
        signal._id.toString(),
        rule._id.toString()
      );
      
      if (exists) continue;
      
      // Create alert
      try {
        const alertTitle = generateAlertTitle(signal.type, signal.strategyType);
        const alertMessage = generateAlertMessage(
          signal.type,
          signal.strategyType,
          signal.previousStrategyType,
          signal.confidence,
          signal.stability
        );
        
        const alert = await alertsRepo.createAlert({
          userId: rule.userId,
          source: {
            type: 'strategy_signal',
            signalId: signal._id.toString(),
          },
          scope: rule.scope,
          targetId: rule.targetId,
          signalType: signal.type,
          strategyType: signal.strategyType,
          severity: signal.severity,
          confidence: signal.confidence,
          stability: signal.stability,
          title: alertTitle,
          message: alertMessage,
          ruleId: rule._id.toString(),
        });
        
        alertsCreated++;
        
        // Send Telegram notification (async, non-blocking)
        sendTelegramNotificationAsync(rule.userId, {
          title: alertTitle,
          message: alertMessage,
          scope: rule.scope,
          targetId: rule.targetId,
          signalType: signal.type,
          confidence: signal.confidence,
          severity: signal.severity,
        }, rule._id.toString());
        
      } catch (err) {
        // Ignore duplicate errors
        console.error(`[Alerts] Error creating alert:`, err);
      }
    }
  }
  
  return alertsCreated;
}

/**
 * Send Telegram notification asynchronously (fire and forget)
 */
async function sendTelegramNotificationAsync(
  userId: string,
  alert: {
    title: string;
    message: string;
    scope: string;
    targetId: string;
    signalType: string;
    confidence: number;
    severity: number;
  },
  ruleId?: string
): Promise<void> {
  try {
    const { sendAlertNotification, sendFeedbackMessage } = await import('../notifications/telegram.service.js');
    await sendAlertNotification(userId, alert);
    
    // A5.1/A5.3: Check if we need to send feedback nudge
    if (ruleId) {
      // Map severity to priority
      const priority = alert.severity >= 70 ? 'high' : (alert.severity >= 40 ? 'medium' : 'low');
      
      const { updateLastTriggered, markFeedbackSent, AlertRuleModel } = await import('./alert_rules.model.js');
      const { shouldSendFeedback, triggersIn24h, stats } = await updateLastTriggered(
        ruleId,
        undefined,
        { priority, reason: alert.signalType }
      );
      
      if (shouldSendFeedback) {
        // Get rule for sensitivity info
        const rule = await AlertRuleModel.findById(ruleId);
        
        // Get token/wallet name for the message
        const targetName = alert.targetId.slice(0, 8) + '...';
        
        await sendFeedbackMessage(userId, {
          targetName,
          triggersIn24h,
          scope: alert.scope,
          dominantReason: stats.dominantReason24h,
          currentSensitivity: rule?.sensitivity || 'medium',
        });
        
        await markFeedbackSent(ruleId);
      }
    }
  } catch (err) {
    // Non-critical, log and continue
    console.error('[Alerts] Telegram notification failed:', err);
  }
}
