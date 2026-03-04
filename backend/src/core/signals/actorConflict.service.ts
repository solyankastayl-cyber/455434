/**
 * AS-3: Actor Conflict Detection
 * 
 * Определяет противоречивые сигналы между разными источниками
 * Защита от ложных BUY/SELL
 */

import { DEXFlowSignal } from './dexFlow.service.js';
import { WhaleAnalysis } from './whaleTransfer.service.js';

export interface ConflictSignal {
  conflictScore: number; // 0..1
  conflicts: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface ConflictImpact {
  confidencePoints: number;
  riskPoints: number;
  forceDecision: 'NEUTRAL' | null;
  reasons: string[];
}

/**
 * Определяет конфликты между DEX flow и whale signals
 */
export function detectActorConflicts(
  dexFlow: DEXFlowSignal,
  whaleAnalysis: WhaleAnalysis
): ConflictSignal {
  const conflicts: string[] = [];
  let conflictScore = 0;

  // Conflict 1: DEX inflow + whale exits
  // (покупают через DEX, но киты продают на биржи)
  if (dexFlow.netFlowUSD > 100_000 && whaleAnalysis.exits) {
    conflicts.push('DEX buying vs whale selling');
    conflictScore += 0.3;
  }

  // Conflict 2: DEX inflow + liquidity drain
  // (покупают, но ликвидность уходит)
  if (dexFlow.netFlowUSD > 100_000 && dexFlow.liquidityChangePct < -10) {
    conflicts.push('DEX inflow vs liquidity drain');
    conflictScore += 0.4;
  }

  // Conflict 3: Whale accumulation + repeated exits
  // (одни киты покупают, другие массово продают)
  if (whaleAnalysis.accumulations && whaleAnalysis.repeatedExits) {
    conflicts.push('Whale accumulation vs repeated exits');
    conflictScore += 0.35;
  }

  // Conflict 4: Strong DEX outflow + whale accumulation
  // (продают через DEX, но киты покупают с бирж)
  if (dexFlow.netFlowUSD < -150_000 && whaleAnalysis.accumulations) {
    conflicts.push('DEX selling vs whale buying');
    conflictScore += 0.3;
  }

  // Conflict 5: Low DEX activity but high whale activity
  // (мало активности на DEX, но киты активны)
  if (
    dexFlow.txCount < 10 &&
    whaleAnalysis.evidence.whaleTransfers > 5
  ) {
    conflicts.push('Low DEX activity vs high whale activity');
    conflictScore += 0.2;
  }

  // Determine severity
  let severity: 'low' | 'medium' | 'high';
  if (conflictScore >= 0.6) severity = 'high';
  else if (conflictScore >= 0.4) severity = 'medium';
  else severity = 'low';

  return {
    conflictScore: Math.min(conflictScore, 1),
    conflicts,
    severity,
  };
}

/**
 * Вычисляет влияние конфликтов на Engine state
 */
export function calculateConflictImpact(signal: ConflictSignal): ConflictImpact {
  const impact: ConflictImpact = {
    confidencePoints: 0,
    riskPoints: 0,
    forceDecision: null,
    reasons: [],
  };

  const { conflictScore, conflicts, severity } = signal;

  // No conflicts
  if (conflictScore === 0) {
    return impact;
  }

  // Low conflict (0.2-0.39)
  if (conflictScore < 0.4) {
    impact.confidencePoints = 0;
    impact.riskPoints = 0;
    impact.reasons.push(`Minor signal conflicts detected (${conflicts.length})`);
    return impact;
  }

  // Medium conflict (0.4-0.59)
  if (conflictScore < 0.6) {
    impact.confidencePoints = -15;
    impact.reasons.push(
      `⚠️ Signal conflicts: ${conflicts.join(', ')}`
    );
    return impact;
  }

  // High conflict (0.6-0.69)
  if (conflictScore < 0.7) {
    impact.confidencePoints = -30;
    impact.riskPoints = 20;
    impact.reasons.push(
      `⚠️ High signal conflict (${(conflictScore * 100).toFixed(0)}%): ${conflicts.join(', ')}`
    );
    return impact;
  }

  // Critical conflict (≥0.7) - FORCE NEUTRAL
  impact.confidencePoints = -50;
  impact.riskPoints = 30;
  impact.forceDecision = 'NEUTRAL';
  impact.reasons.push(
    `🛑 Critical signal conflict (${(conflictScore * 100).toFixed(0)}%): Decision forced to NEUTRAL`
  );
  impact.reasons.push(...conflicts.map(c => `  - ${c}`));

  return impact;
}
