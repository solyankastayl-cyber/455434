/**
 * P1.3 — Labs Attribution Service
 * ================================
 * 
 * Calculates attribution of Labs to Meta-Brain verdict.
 * Provides transparency into which Labs influenced the decision.
 */

import {
  LabSignal,
  LabDirection,
  LabAttribution,
  VerdictAttribution,
  LAB_WEIGHTS,
  toLabSignal,
} from '../../contracts/lab-signal.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface LabsInput {
  labs: Array<{
    labId: string;
    state: string;
    confidence: number;
    signals: Record<string, any>;
    explain: { summary: string; details: string[] };
  }>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ATTRIBUTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function calculateAttribution(
  labsInput: LabsInput,
  verdictDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
): VerdictAttribution {
  // 1. Convert all labs to LabSignal
  const signals: LabSignal[] = labsInput.labs.map(lab => 
    toLabSignal(lab.labId, lab.state, lab.confidence, lab.signals, lab.explain)
  );
  
  // 2. Categorize by alignment with verdict
  const supporting: LabSignal[] = [];
  const opposing: LabSignal[] = [];
  const neutral: LabSignal[] = [];
  const ignored: Array<{ labId: string; reason: string }> = [];
  
  for (const signal of signals) {
    // Ignore low confidence labs
    if (signal.confidence < 0.3) {
      ignored.push({ labId: signal.labId, reason: 'Low confidence (<0.3)' });
      continue;
    }
    
    // Categorize
    if (signal.direction === 'NEUTRAL') {
      neutral.push(signal);
    } else if (signal.direction === verdictDirection) {
      supporting.push(signal);
    } else {
      opposing.push(signal);
    }
  }
  
  // 3. Calculate confidence adjustment
  const confidenceAdjustment = calculateConfidenceAdjustment(supporting, opposing, neutral);
  
  // 4. Determine dominant direction
  const dominantDirection = determineDominantDirection(supporting, opposing);
  
  return {
    supporting: sortByImpact(supporting),
    opposing: sortByImpact(opposing),
    neutral: sortByImpact(neutral),
    ignored,
    summary: {
      totalLabs: signals.length,
      supportingCount: supporting.length,
      opposingCount: opposing.length,
      neutralCount: neutral.length,
      dominantDirection,
      confidenceAdjustment,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function sortByImpact(signals: LabSignal[]): LabSignal[] {
  return signals.sort((a, b) => {
    const weightA = LAB_WEIGHTS[a.labId] || 0.05;
    const weightB = LAB_WEIGHTS[b.labId] || 0.05;
    return (weightB * b.confidence) - (weightA * a.confidence);
  });
}

function calculateConfidenceAdjustment(
  supporting: LabSignal[],
  opposing: LabSignal[],
  neutral: LabSignal[]
): number {
  let adjustment = 0;
  
  // Supporting labs boost confidence
  for (const signal of supporting) {
    const weight = LAB_WEIGHTS[signal.labId] || 0.05;
    adjustment += weight * signal.confidence;
  }
  
  // Opposing labs reduce confidence
  for (const signal of opposing) {
    const weight = LAB_WEIGHTS[signal.labId] || 0.05;
    adjustment -= weight * signal.confidence;
  }
  
  // Clamp to -0.5 to +0.5
  return Math.max(-0.5, Math.min(0.5, adjustment));
}

function determineDominantDirection(
  supporting: LabSignal[],
  opposing: LabSignal[]
): LabDirection {
  const supportWeight = supporting.reduce((sum, s) => 
    sum + (LAB_WEIGHTS[s.labId] || 0.05) * s.confidence, 0
  );
  
  const opposeWeight = opposing.reduce((sum, s) => 
    sum + (LAB_WEIGHTS[s.labId] || 0.05) * s.confidence, 0
  );
  
  if (supportWeight > opposeWeight * 1.2) return 'BULLISH';
  if (opposeWeight > supportWeight * 1.2) return 'BEARISH';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// GET INDIVIDUAL LAB ATTRIBUTION
// ═══════════════════════════════════════════════════════════════

export function getLabAttribution(signal: LabSignal, verdictDirection: LabDirection): LabAttribution {
  const weight = LAB_WEIGHTS[signal.labId] || 0.05;
  
  // Calculate impact (-1 to +1)
  let impact = weight * signal.confidence;
  if (signal.direction === 'NEUTRAL') {
    impact = 0;
  } else if (signal.direction !== verdictDirection) {
    impact = -impact;
  }
  
  // Generate reason
  const reason = generateReason(signal, impact);
  
  return {
    source: signal.labId,
    impact: Math.round(impact * 100) / 100,
    confidence: signal.confidence,
    reason,
  };
}

function generateReason(signal: LabSignal, impact: number): string {
  const direction = impact > 0 ? 'supports' : impact < 0 ? 'opposes' : 'neutral to';
  const strength = signal.strength.toLowerCase();
  
  // Generate from context tags
  const mainTag = signal.context[0] || signal.labId.toUpperCase();
  
  switch (signal.labId) {
    case 'whale':
      return `Whale activity ${direction} decision (${mainTag})`;
    case 'volume':
      return `Volume ${direction} price action (${signal.strength})`;
    case 'momentum':
      return `Momentum ${signal.direction.toLowerCase()} (${mainTag})`;
    case 'liquidation':
      return `Liquidation pressure ${direction} move`;
    case 'flow':
      return `Order flow ${signal.direction.toLowerCase()}`;
    case 'marketStress':
      return `Market stress ${mainTag.toLowerCase()}`;
    case 'accumulation':
      return `${mainTag} pattern detected`;
    case 'manipulation':
      return `Manipulation risk: ${mainTag.toLowerCase()}`;
    default:
      return `${signal.labId}: ${mainTag} (${strength} signal)`;
  }
}

// ═══════════════════════════════════════════════════════════════
// GET ALL ATTRIBUTIONS AS LIST
// ═══════════════════════════════════════════════════════════════

export function getAttributionList(
  attribution: VerdictAttribution,
  verdictDirection: LabDirection
): LabAttribution[] {
  const list: LabAttribution[] = [];
  
  // Add supporting
  for (const signal of attribution.supporting) {
    list.push(getLabAttribution(signal, verdictDirection));
  }
  
  // Add opposing
  for (const signal of attribution.opposing) {
    list.push(getLabAttribution(signal, verdictDirection));
  }
  
  // Sort by absolute impact
  return list.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

console.log('[P1.3] Labs Attribution Service loaded');
