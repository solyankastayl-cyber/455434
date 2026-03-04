/**
 * Dispatch Alerts Job
 * 
 * Processes new strategy signals and creates alerts for matching rules.
 * Runs every 60 seconds.
 * 
 * Input: strategy_signals (new), alert_rules
 * Output: alerts
 */
import { StrategySignalModel, IStrategySignal } from '../core/strategy_signals/strategy_signals.model.js';
import { dispatchAlertForSignal } from '../core/alerts/alerts.service.js';
import { AlertModel } from '../core/alerts/alerts.model.js';
import { AlertRuleModel } from '../core/alerts/alert_rules.model.js';

let lastRunTime: Date | null = null;

export interface DispatchAlertsResult {
  processedSignals: number;
  alertsCreated: number;
  duration: number;
}

/**
 * Dispatch alerts from strategy signals
 */
export async function dispatchAlerts(): Promise<DispatchAlertsResult> {
  const startTime = Date.now();
  let processedSignals = 0;
  let alertsCreated = 0;
  
  try {
    // Get new strategy signals since last run
    const query: Record<string, unknown> = {};
    if (lastRunTime) {
      query.createdAt = { $gt: lastRunTime };
    }
    
    const signals = await StrategySignalModel
      .find(query)
      .sort({ createdAt: 1 })
      .limit(100) // Process in batches
      .lean();
    
    if (signals.length === 0) {
      lastRunTime = new Date();
      return { processedSignals: 0, alertsCreated: 0, duration: Date.now() - startTime };
    }
    
    // Process each signal
    for (const signal of signals) {
      try {
        const created = await dispatchAlertForSignal(signal as IStrategySignal);
        alertsCreated += created;
        processedSignals++;
      } catch (err) {
        console.error(`[Dispatch Alerts] Error processing signal ${signal._id}:`, err);
      }
    }
    
    // Update last run time
    if (signals.length > 0) {
      const lastSignal = signals[signals.length - 1];
      lastRunTime = new Date(lastSignal.createdAt);
    }
    
  } catch (err) {
    console.error('[Dispatch Alerts] Job failed:', err);
  }
  
  return {
    processedSignals,
    alertsCreated,
    duration: Date.now() - startTime,
  };
}

/**
 * Get job status
 */
export async function getDispatchAlertsStatus(): Promise<{
  totalAlerts: number;
  unacknowledged: number;
  last24h: number;
  totalRules: number;
  activeRules: number;
  lastRun: string | null;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [totalAlerts, unacknowledged, last24h, totalRules, activeRules] = await Promise.all([
    AlertModel.countDocuments(),
    AlertModel.countDocuments({ acknowledgedAt: null }),
    AlertModel.countDocuments({ createdAt: { $gte: yesterday } }),
    AlertRuleModel.countDocuments(),
    AlertRuleModel.countDocuments({ active: true }),
  ]);
  
  return {
    totalAlerts,
    unacknowledged,
    last24h,
    totalRules,
    activeRules,
    lastRun: lastRunTime?.toISOString() || null,
  };
}
