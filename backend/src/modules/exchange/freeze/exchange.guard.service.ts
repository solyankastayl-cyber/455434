/**
 * PHASE 1.4 — Exchange Guard Service
 * ====================================
 * Evaluates data quality and enforces SLA guardrails
 */

import { ExchangeSLA, SLA_THRESHOLDS, GuardDecision, DataMode } from './exchange.sla.js';

export interface GuardInput {
  dataMode: DataMode;
  completenessScore: number;
  stalenessMs: number;
  providersUp: number;
  providersTotal: number;
  missingCritical: string[];
}

export function evaluateExchangeSLA(input: GuardInput): GuardDecision {
  const reasons: string[] = [];
  let ok = true;
  
  // Check providers
  if (input.providersUp < SLA_THRESHOLDS.minProvidersUp) {
    ok = false;
    reasons.push('NO_PROVIDERS_UP');
  }
  
  // Check staleness
  if (input.stalenessMs > SLA_THRESHOLDS.maxStalenessMs) {
    ok = false;
    reasons.push('STALE_DATA');
  }
  
  // Check completeness
  if (input.completenessScore < SLA_THRESHOLDS.minCompleteness) {
    ok = false;
    reasons.push('LOW_COMPLETENESS');
  }
  
  // Check missing critical
  if (input.missingCritical.length > 0) {
    ok = false;
    reasons.push('MISSING_CRITICAL');
  }
  
  // Calculate downgrade factor
  let downgradeFactor = 1.0;
  
  if (input.dataMode === 'MOCK') downgradeFactor *= 0.6;
  if (input.dataMode === 'MIXED') downgradeFactor *= 0.85;
  if (input.stalenessMs > SLA_THRESHOLDS.maxStalenessMs) downgradeFactor *= 0.7;
  if (input.completenessScore < SLA_THRESHOLDS.minCompleteness) downgradeFactor *= 0.75;
  if (input.missingCritical.length > 0) downgradeFactor *= 0.6;
  
  // Strong forbidden if MOCK or SLA not ok
  const strongAllowed = input.dataMode !== 'MOCK' && ok;
  
  const sla: ExchangeSLA = {
    ok,
    dataMode: input.dataMode,
    completenessScore: input.completenessScore,
    stalenessMs: input.stalenessMs,
    providersUp: input.providersUp,
    providersTotal: input.providersTotal,
    missingCritical: input.missingCritical,
    reasons,
  };
  
  return { sla, downgradeFactor, strongAllowed };
}

/**
 * Build guard input from sourceMeta
 */
export function buildGuardInput(sourceMeta: {
  dataMode?: DataMode;
  providersUsed?: string[];
  missing?: string[];
  timestamp?: number;
}): GuardInput {
  const now = Date.now();
  const ts = sourceMeta.timestamp ?? now;
  const missing = sourceMeta.missing ?? [];
  
  // Check for critical missing fields
  const missingCritical = missing.filter((m) =>
    SLA_THRESHOLDS.criticalFields.includes(m as any)
  );
  
  // Calculate completeness (rough: 1 - (missing/total_expected))
  const expectedFields = 6; // price, candles, orderbook, trades, oi, funding
  const completenessScore = Math.max(0, 1 - missing.length / expectedFields);
  
  return {
    dataMode: sourceMeta.dataMode ?? 'MOCK',
    completenessScore,
    stalenessMs: now - ts,
    providersUp: sourceMeta.providersUsed?.length ?? 0,
    providersTotal: 3, // BYBIT, BINANCE, MOCK
    missingCritical,
  };
}

console.log('[Phase 1.4] Exchange Guard Service loaded');
