/**
 * BLOCK 67 — Alert Engine Service
 * 
 * Core alert trigger evaluation:
 * - REGIME_SHIFT: volatility regime changed
 * - CRISIS_ENTER/EXIT: entering/exiting CRISIS
 * - HEALTH_DROP: health level degraded
 * - TAIL_SPIKE: tail risk exceeded threshold
 * 
 * BTC-only, rate-limited, production-grade.
 */

import { AlertLogModel } from './alert.model.js';
import { ALERT_POLICY } from './alert.policy.js';
import { shouldEmitAlert, generateFingerprint } from './alert.dedup.service.js';
import { canSendAlert, getQuotaStatus } from './alert.quota.service.js';
import type {
  AlertType,
  AlertLevel,
  AlertEvent,
  AlertBlockedBy,
  AlertRunResult
} from './alert.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AlertEngineContext {
  symbol: 'BTC';
  current: {
    volRegime?: string;
    marketPhase?: string;
    health?: string;
    tailRisk?: number;  // mcP95_DD
    decision?: string;
    blockers?: string[];
  };
  previous: {
    volRegime?: string;
    marketPhase?: string;
    health?: string;
    tailRisk?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// TRIGGER EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateRegimeShift(ctx: AlertEngineContext): AlertEvent | null {
  const { current, previous, symbol } = ctx;
  
  // Check volatility regime change
  if (current.volRegime && previous.volRegime && current.volRegime !== previous.volRegime) {
    // Determine severity
    let level: AlertLevel = 'INFO';
    let type: AlertType = 'REGIME_SHIFT';
    
    // CRISIS transitions are more severe
    if (current.volRegime === 'CRISIS') {
      level = 'HIGH';
      type = 'CRISIS_ENTER';
    } else if (previous.volRegime === 'CRISIS') {
      level = 'HIGH';
      type = 'CRISIS_EXIT';
    }
    
    const fingerprint = generateFingerprint(symbol, type, level, {
      from: previous.volRegime,
      to: current.volRegime
    });
    
    return {
      symbol,
      type,
      level,
      message: type === 'CRISIS_ENTER'
        ? `🚨 BTC ENTERED CRISIS REGIME\nVol regime: ${previous.volRegime} → ${current.volRegime}`
        : type === 'CRISIS_EXIT'
        ? `🟢 BTC EXITED CRISIS REGIME\nVol regime: ${previous.volRegime} → ${current.volRegime}`
        : `📊 BTC Regime Shift\nVol regime: ${previous.volRegime} → ${current.volRegime}`,
      fingerprint,
      meta: {
        prevRegime: previous.volRegime,
        currentRegime: current.volRegime,
        decision: current.decision,
        blockers: current.blockers
      },
      blockedBy: 'NONE',
      triggeredAt: new Date()
    };
  }
  
  return null;
}

function evaluateHealthDrop(ctx: AlertEngineContext): AlertEvent | null {
  const { current, previous, symbol } = ctx;
  
  const healthOrder = ['HEALTHY', 'WATCH', 'ALERT', 'CRITICAL'];
  
  if (!current.health || !previous.health) return null;
  
  const prevIdx = healthOrder.indexOf(previous.health);
  const currIdx = healthOrder.indexOf(current.health);
  
  // Only alert on degradation (higher index = worse)
  if (currIdx > prevIdx && currIdx >= 0 && prevIdx >= 0) {
    const transition = `${previous.health}→${current.health}`;
    const levelMap: Record<string, AlertLevel> = {
      'HEALTHY→WATCH': 'INFO',
      'WATCH→ALERT': 'HIGH',
      'ALERT→CRITICAL': 'CRITICAL',
      'HEALTHY→ALERT': 'HIGH',
      'HEALTHY→CRITICAL': 'CRITICAL',
      'WATCH→CRITICAL': 'CRITICAL'
    };
    
    const level = levelMap[transition] || 'HIGH';
    
    const fingerprint = generateFingerprint(symbol, 'HEALTH_DROP', level, {
      from: previous.health,
      to: current.health
    });
    
    return {
      symbol,
      type: 'HEALTH_DROP',
      level,
      message: `⚠️ BTC Health Degraded\nHealth: ${previous.health} → ${current.health}`,
      fingerprint,
      meta: {
        prevHealth: previous.health,
        currentHealth: current.health,
        tailRisk: current.tailRisk
      },
      blockedBy: 'NONE',
      triggeredAt: new Date()
    };
  }
  
  return null;
}

function evaluateTailSpike(ctx: AlertEngineContext): AlertEvent | null {
  const { current, previous, symbol } = ctx;
  const { thresholds } = ALERT_POLICY;
  
  if (current.tailRisk === undefined) return null;
  
  const prevTail = previous.tailRisk ?? 0;
  const currTail = current.tailRisk;
  
  // Check if crossed HIGH threshold
  if (currTail > thresholds.tailRisk.high && prevTail <= thresholds.tailRisk.high) {
    const level: AlertLevel = currTail > thresholds.tailRisk.critical ? 'CRITICAL' : 'HIGH';
    
    const fingerprint = generateFingerprint(symbol, 'TAIL_SPIKE', level, {
      tailRisk: currTail
    });
    
    return {
      symbol,
      type: 'TAIL_SPIKE',
      level,
      message: level === 'CRITICAL'
        ? `🔴 BTC CRITICAL TAIL RISK\nmcP95_DD: ${currTail.toFixed(1)}% (threshold ${thresholds.tailRisk.critical}%)`
        : `⚠️ BTC Tail Risk Spike\nmcP95_DD: ${currTail.toFixed(1)}% (threshold ${thresholds.tailRisk.high}%)`,
      fingerprint,
      meta: {
        prevTailRisk: prevTail,
        currentTailRisk: currTail,
        regime: current.volRegime,
        decision: current.decision,
        blockers: current.blockers
      },
      blockedBy: 'NONE',
      triggeredAt: new Date()
    };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════

export async function evaluateAlerts(ctx: AlertEngineContext): Promise<AlertEvent[]> {
  const events: AlertEvent[] = [];
  
  // BTC-only guard
  if (ctx.symbol !== 'BTC') {
    console.warn('[AlertEngine] Only BTC is supported');
    return [];
  }
  
  // Evaluate all triggers
  const regimeEvent = evaluateRegimeShift(ctx);
  const healthEvent = evaluateHealthDrop(ctx);
  const tailEvent = evaluateTailSpike(ctx);
  
  if (regimeEvent) events.push(regimeEvent);
  if (healthEvent) events.push(healthEvent);
  if (tailEvent) events.push(tailEvent);
  
  // Sort by priority
  const priorityMap: Record<string, number> = {};
  ALERT_POLICY.priorityOrder.forEach((type, idx) => {
    priorityMap[type] = ALERT_POLICY.priorityOrder.length - idx;
  });
  
  events.sort((a, b) => {
    // CRITICAL first
    if (a.level === 'CRITICAL' && b.level !== 'CRITICAL') return -1;
    if (b.level === 'CRITICAL' && a.level !== 'CRITICAL') return 1;
    // Then by priority
    return (priorityMap[b.type] || 0) - (priorityMap[a.type] || 0);
  });
  
  return events;
}

/**
 * Run alert engine: evaluate, filter, log, return results
 */
export async function runAlertEngine(ctx: AlertEngineContext): Promise<AlertRunResult> {
  const events = await evaluateAlerts(ctx);
  
  if (events.length === 0) {
    const quota = await getQuotaStatus();
    return {
      sentCount: 0,
      blockedCount: 0,
      quotaUsed: quota.used,
      events: []
    };
  }
  
  // Apply dedup, quota, and batch limits
  const processedEvents: AlertEvent[] = [];
  let infoCount = 0;
  let highCount = 0;
  let criticalCount = 0;
  
  for (const event of events) {
    // Check batch limits
    if (event.level === 'INFO' && infoCount >= ALERT_POLICY.batchLimits.maxInfoPerRun) {
      event.blockedBy = 'BATCH_SUPPRESSED';
      processedEvents.push(event);
      continue;
    }
    if (event.level === 'HIGH' && highCount >= ALERT_POLICY.batchLimits.maxHighPerRun) {
      event.blockedBy = 'BATCH_SUPPRESSED';
      processedEvents.push(event);
      continue;
    }
    if (event.level === 'CRITICAL' && criticalCount >= ALERT_POLICY.batchLimits.maxCriticalPerRun) {
      event.blockedBy = 'BATCH_SUPPRESSED';
      processedEvents.push(event);
      continue;
    }
    
    // Check dedup/cooldown
    const dedupResult = await shouldEmitAlert(event.fingerprint, event.level);
    if (!dedupResult.ok) {
      event.blockedBy = dedupResult.reason === 'COOLDOWN' ? 'COOLDOWN' : 'DEDUP';
      processedEvents.push(event);
      continue;
    }
    
    // Check quota (only for INFO/HIGH)
    const quotaResult = await canSendAlert(event.level);
    if (!quotaResult.ok) {
      event.blockedBy = 'QUOTA';
      processedEvents.push(event);
      continue;
    }
    
    // Event passes all checks
    event.blockedBy = 'NONE';
    processedEvents.push(event);
    
    // Update batch counters
    if (event.level === 'INFO') infoCount++;
    if (event.level === 'HIGH') highCount++;
    if (event.level === 'CRITICAL') criticalCount++;
  }
  
  // Save all events to log (including blocked ones for audit)
  for (const event of processedEvents) {
    await AlertLogModel.create({
      symbol: event.symbol,
      type: event.type,
      level: event.level,
      message: event.message,
      fingerprint: event.fingerprint,
      meta: event.meta,
      blockedBy: event.blockedBy,
      triggeredAt: event.triggeredAt
    });
  }
  
  const quota = await getQuotaStatus();
  const sentCount = processedEvents.filter(e => e.blockedBy === 'NONE').length;
  const blockedCount = processedEvents.length - sentCount;
  
  return {
    sentCount,
    blockedCount,
    quotaUsed: quota.used,
    events: processedEvents
  };
}

// Export singleton-like access
export const alertEngineService = {
  evaluate: evaluateAlerts,
  run: runAlertEngine
};
