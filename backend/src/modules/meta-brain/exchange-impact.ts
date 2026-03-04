/**
 * S10.8 — Exchange Impact Engine
 * 
 * Applies Exchange Intelligence to Meta-Brain verdicts.
 * 
 * GOLDEN RULES (INVIOLABLE):
 * - Exchange can ONLY downgrade, NEVER upgrade
 * - Exchange can block STRONG → WEAK
 * - Exchange CANNOT initiate signals
 * - Exchange explains environment, not future
 */

import {
  ExchangeContext,
  MetaBrainVerdict,
  VerdictStrength,
  ImpactRules,
  DEFAULT_IMPACT_RULES,
  DowngradeLogEntry,
  ExchangeImpactMetrics,
} from './meta-brain.types.js';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const downgradeLog: DowngradeLogEntry[] = [];
const MAX_LOG_SIZE = 500;

let metrics: ExchangeImpactMetrics = {
  totalDecisions: 0,
  downgraded: 0,
  downgradedRate: 0,
  byTrigger: { regime: 0, stress: 0, conflict: 0, mlWarning: 0, whaleRisk: 0 },
  avgConfidenceReduction: 0,
  strongBlockedRate: 0,
  since: Date.now(),
};

// ═══════════════════════════════════════════════════════════════
// MAIN: APPLY EXCHANGE IMPACT
// ═══════════════════════════════════════════════════════════════

export function applyExchangeImpact(
  inputVerdict: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    strength: VerdictStrength;
    sentimentSource?: { confidence: number; direction: string };
    onchainSource?: { confidence: number; validation: string };
  },
  exchangeContext: ExchangeContext,
  rules: ImpactRules = DEFAULT_IMPACT_RULES
): MetaBrainVerdict {
  const now = Date.now();
  
  let finalConfidence = inputVerdict.confidence;
  let finalStrength = inputVerdict.strength;
  let downgraded = false;
  let downgradeReason: string | null = null;
  
  const impact = {
    applied: false,
    regimeDowngrade: false,
    stressGuard: false,
    conflictGuard: false,
    mlWarningGate: false,
    whaleRiskGuard: false,
  };
  
  // ─────────────────────────────────────────────────────────────
  // RULE 1: Regime-based downgrade
  // ─────────────────────────────────────────────────────────────
  if (
    rules.downgradingRegimes.includes(exchangeContext.regime) &&
    exchangeContext.regimeConfidence >= rules.regimeConfidenceThreshold
  ) {
    if (finalStrength === 'STRONG') {
      finalStrength = 'WEAK';
      finalConfidence *= 0.7;
      downgraded = true;
      downgradeReason = `Regime ${exchangeContext.regime} (${(exchangeContext.regimeConfidence * 100).toFixed(0)}%)`;
      impact.regimeDowngrade = true;
      impact.applied = true;
      
      logDowngrade({
        originalStrength: inputVerdict.strength,
        originalConfidence: inputVerdict.confidence,
        finalStrength,
        finalConfidence,
        reason: downgradeReason,
        trigger: 'REGIME',
        exchangeContext,
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // RULE 2: Market Stress Guard
  // ─────────────────────────────────────────────────────────────
  if (exchangeContext.marketStress >= rules.marketStressThreshold) {
    if (finalStrength === 'STRONG' || finalStrength === 'MODERATE') {
      const prevStrength = finalStrength;
      finalStrength = 'WEAK';
      finalConfidence *= 0.6;
      
      if (!downgraded) {
        downgraded = true;
        downgradeReason = `Market stress ${(exchangeContext.marketStress * 100).toFixed(0)}%`;
      } else {
        downgradeReason += ` + High stress ${(exchangeContext.marketStress * 100).toFixed(0)}%`;
      }
      
      impact.stressGuard = true;
      impact.applied = true;
      
      logDowngrade({
        originalStrength: prevStrength,
        originalConfidence: inputVerdict.confidence,
        finalStrength,
        finalConfidence,
        reason: `Market stress ${(exchangeContext.marketStress * 100).toFixed(0)}%`,
        trigger: 'STRESS',
        exchangeContext,
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // RULE 3: Pattern Conflict Guard
  // ─────────────────────────────────────────────────────────────
  const conflictCount = Math.min(
    exchangeContext.patternSummary.bullish,
    exchangeContext.patternSummary.bearish
  );
  
  if (conflictCount >= rules.conflictPatternThreshold) {
    finalConfidence *= 0.85;
    
    if (!downgraded) {
      downgraded = true;
      downgradeReason = `${conflictCount} conflicting patterns`;
    } else {
      downgradeReason += ` + ${conflictCount} conflicts`;
    }
    
    impact.conflictGuard = true;
    impact.applied = true;
  }
  
  // ─────────────────────────────────────────────────────────────
  // RULE 4: ML WARNING Gate
  // ─────────────────────────────────────────────────────────────
  if (
    rules.mlWarningBlocksStrong &&
    exchangeContext.mlVerdict === 'WARNING' &&
    finalStrength === 'STRONG'
  ) {
    const prevStrength = finalStrength;
    finalStrength = 'MODERATE';
    finalConfidence *= 0.75;
    
    if (!downgraded) {
      downgraded = true;
      downgradeReason = `Exchange ML: WARNING (${(exchangeContext.mlConfidence * 100).toFixed(0)}%)`;
    } else {
      downgradeReason += ` + ML WARNING`;
    }
    
    impact.mlWarningGate = true;
    impact.applied = true;
    
    logDowngrade({
      originalStrength: prevStrength,
      originalConfidence: inputVerdict.confidence,
      finalStrength,
      finalConfidence,
      reason: `Exchange ML WARNING`,
      trigger: 'ML_WARNING',
      exchangeContext,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // RULE 5: Whale Risk Guard (S10.W Step 7)
  // ─────────────────────────────────────────────────────────────
  if (
    rules.whaleRiskEnabled &&
    exchangeContext.whaleRisk &&
    exchangeContext.whaleRisk.riskBucket === 'HIGH' &&
    exchangeContext.whaleRisk.lift >= rules.whaleRiskLiftThreshold
  ) {
    const prevStrength = finalStrength;
    const prevConfidence = finalConfidence;
    
    // Apply confidence multiplier
    finalConfidence *= rules.whaleRiskConfidenceMultiplier;
    
    // Block STRONG verdict
    if (finalStrength === 'STRONG') {
      finalStrength = 'WEAK';
    } else if (finalStrength === 'MODERATE') {
      finalStrength = 'WEAK';
    }
    
    const whalePattern = exchangeContext.whaleRisk.activePattern || 'HIGH_RISK';
    const whaleLift = exchangeContext.whaleRisk.lift.toFixed(1);
    const whaleReason = `Whale ${whalePattern} (lift: ${whaleLift}x)`;
    
    if (!downgraded) {
      downgraded = true;
      downgradeReason = whaleReason;
    } else {
      downgradeReason += ` + ${whaleReason}`;
    }
    
    impact.whaleRiskGuard = true;
    impact.applied = true;
    
    logDowngrade({
      originalStrength: prevStrength,
      originalConfidence: prevConfidence,
      finalStrength,
      finalConfidence,
      reason: whaleReason,
      trigger: 'WHALE_RISK',
      exchangeContext,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // Update metrics
  // ─────────────────────────────────────────────────────────────
  updateMetrics(inputVerdict, { confidence: finalConfidence, strength: finalStrength }, impact);
  
  // ─────────────────────────────────────────────────────────────
  // Build final verdict
  // ─────────────────────────────────────────────────────────────
  return {
    direction: inputVerdict.direction,
    originalConfidence: inputVerdict.confidence,
    originalStrength: inputVerdict.strength,
    finalConfidence,
    finalStrength,
    downgraded,
    downgradeReason,
    exchangeImpact: impact,
    sources: {
      sentiment: inputVerdict.sentimentSource || null,
      onchain: inputVerdict.onchainSource || null,
      exchange: exchangeContext,
    },
    timestamp: now,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function logDowngrade(entry: Omit<DowngradeLogEntry, 'timestamp' | 'exchangeContext'> & { exchangeContext: ExchangeContext }): void {
  downgradeLog.unshift({
    timestamp: Date.now(),
    originalStrength: entry.originalStrength,
    originalConfidence: entry.originalConfidence,
    finalStrength: entry.finalStrength,
    finalConfidence: entry.finalConfidence,
    reason: entry.reason,
    trigger: entry.trigger,
    exchangeContext: {
      regime: entry.exchangeContext.regime,
      regimeConfidence: entry.exchangeContext.regimeConfidence,
      marketStress: entry.exchangeContext.marketStress,
      mlVerdict: entry.exchangeContext.mlVerdict,
      conflictCount: Math.min(
        entry.exchangeContext.patternSummary.bullish,
        entry.exchangeContext.patternSummary.bearish
      ),
      whaleRisk: entry.exchangeContext.whaleRisk ? {
        pattern: entry.exchangeContext.whaleRisk.activePattern,
        bucket: entry.exchangeContext.whaleRisk.riskBucket,
        lift: entry.exchangeContext.whaleRisk.lift,
      } : undefined,
    },
  });
  
  // Trim log
  while (downgradeLog.length > MAX_LOG_SIZE) {
    downgradeLog.pop();
  }
}

function updateMetrics(
  original: { confidence: number; strength: VerdictStrength },
  final: { confidence: number; strength: VerdictStrength },
  impact: { applied: boolean; regimeDowngrade: boolean; stressGuard: boolean; conflictGuard: boolean; mlWarningGate: boolean; whaleRiskGuard: boolean }
): void {
  metrics.totalDecisions++;
  
  if (impact.applied) {
    metrics.downgraded++;
    
    if (impact.regimeDowngrade) metrics.byTrigger.regime++;
    if (impact.stressGuard) metrics.byTrigger.stress++;
    if (impact.conflictGuard) metrics.byTrigger.conflict++;
    if (impact.mlWarningGate) metrics.byTrigger.mlWarning++;
    if (impact.whaleRiskGuard) metrics.byTrigger.whaleRisk++;
    
    // Update average confidence reduction
    const reduction = original.confidence - final.confidence;
    metrics.avgConfidenceReduction = (
      (metrics.avgConfidenceReduction * (metrics.downgraded - 1) + reduction) / metrics.downgraded
    );
    
    // Track STRONG blocked
    if (original.strength === 'STRONG' && final.strength !== 'STRONG') {
      const totalStrong = metrics.totalDecisions; // Approximate
      metrics.strongBlockedRate = metrics.byTrigger.regime / Math.max(1, totalStrong);
    }
  }
  
  metrics.downgradedRate = metrics.downgraded / metrics.totalDecisions;
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

export function getDowngradeLog(limit: number = 50): DowngradeLogEntry[] {
  return downgradeLog.slice(0, limit);
}

export function getImpactMetrics(): ExchangeImpactMetrics {
  return { ...metrics };
}

export function resetMetrics(): void {
  metrics = {
    totalDecisions: 0,
    downgraded: 0,
    downgradedRate: 0,
    byTrigger: { regime: 0, stress: 0, conflict: 0, mlWarning: 0 },
    avgConfidenceReduction: 0,
    strongBlockedRate: 0,
    since: Date.now(),
  };
  downgradeLog.length = 0;
}

console.log('[S10.8] Exchange Impact Engine loaded');
