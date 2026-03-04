/**
 * PHASE 1.4 — Verdict Guard Apply
 * =================================
 * Applies guardrails to verdict output
 */

import { evaluateExchangeSLA, GuardInput } from './exchange.guard.service.js';

export interface VerdictWithGuards {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  strength: 'WEAK' | 'STRONG';
  drivers: string[];
  risks: string[];
  guardrails?: {
    sla: any;
    downgradeFactor: number;
    strongAllowed: boolean;
    originalConfidence: number;
    originalStrength: string;
  };
}

export function applyExchangeGuards(
  verdict: {
    direction: string;
    confidence: number;
    strength: string;
    drivers: string[];
    risks: string[];
  },
  guardInput: GuardInput
): VerdictWithGuards {
  const { sla, downgradeFactor, strongAllowed } = evaluateExchangeSLA(guardInput);
  
  const originalConfidence = verdict.confidence;
  const originalStrength = verdict.strength;
  
  // Apply downgrade
  const adjustedConfidence = Math.max(0, Math.min(1, verdict.confidence * downgradeFactor));
  let adjustedStrength = verdict.strength;
  const adjustedRisks = [...verdict.risks];
  
  // Force WEAK if not allowed
  if (!strongAllowed && adjustedStrength === 'STRONG') {
    adjustedStrength = 'WEAK';
    adjustedRisks.push('SLA_FORCED_WEAK');
  }
  
  // Add SLA risks
  if (!sla.ok) {
    adjustedRisks.push(...sla.reasons.map((r) => `SLA:${r}`));
  }
  
  return {
    direction: verdict.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    confidence: adjustedConfidence,
    strength: adjustedStrength as 'WEAK' | 'STRONG',
    drivers: verdict.drivers,
    risks: [...new Set(adjustedRisks)],
    guardrails: {
      sla,
      downgradeFactor,
      strongAllowed,
      originalConfidence,
      originalStrength,
    },
  };
}

console.log('[Phase 1.4] Verdict Guard Apply loaded');
