/**
 * Negative Dataset Builder
 * 
 * EPIC 8: Enforces balance and quotas
 * 
 * - neg:pos >= 3:1
 * - Type quotas: STRUCTURAL 30-40%, NOISE 20-30%, EXHAUSTION 15-25%, REVERSAL 15-25%
 */

import type { 
  NegativeSample, 
  NegativeType, 
  TypeQuotas,
  NegativeRunStats 
} from './negative.types.js';
import { DEFAULT_QUOTAS, MIN_NEG_POS_RATIO } from './negative.types.js';

interface BalanceResult {
  balanced: NegativeSample[];
  stats: {
    totalInput: number;
    totalOutput: number;
    positive: number;
    negative: number;
    byType: Record<NegativeType, number>;
    negPosRatio: number;
    typeDistribution: Record<NegativeType, number>;
    limitedTypes: NegativeType[];
    droppedForBalance: number;
  };
}

/**
 * Balance samples to achieve target ratios
 */
export function balanceSamples(
  samples: NegativeSample[],
  options?: {
    targetRatio?: number;
    quotas?: TypeQuotas;
    maxSamples?: number;
  }
): BalanceResult {
  const targetRatio = options?.targetRatio || MIN_NEG_POS_RATIO;
  const quotas = options?.quotas || DEFAULT_QUOTAS;
  const maxSamples = options?.maxSamples || 10000;
  
  // Separate by label
  const positives = samples.filter(s => s.label === 1);
  const negatives = samples.filter(s => s.label === 0);
  
  // Group negatives by type
  const byType: Record<NegativeType, NegativeSample[]> = {
    STRUCTURAL: [],
    NOISE: [],
    EXHAUSTION: [],
    REVERSAL: [],
  };
  
  for (const neg of negatives) {
    if (neg.negativeType) {
      byType[neg.negativeType].push(neg);
    } else {
      byType.STRUCTURAL.push(neg); // Default to structural
    }
  }
  
  // Calculate target counts based on positives
  const targetNegatives = Math.floor(positives.length * targetRatio);
  const actualNegatives = Math.min(targetNegatives, negatives.length);
  
  // Calculate per-type targets with quotas
  const typeTargets = calculateTypeTargets(actualNegatives, quotas);
  
  // Select from each type up to target
  const selectedNegatives: NegativeSample[] = [];
  const limitedTypes: NegativeType[] = [];
  const typeCounts: Record<NegativeType, number> = {
    STRUCTURAL: 0,
    NOISE: 0,
    EXHAUSTION: 0,
    REVERSAL: 0,
  };
  
  for (const type of ['STRUCTURAL', 'NOISE', 'EXHAUSTION', 'REVERSAL'] as NegativeType[]) {
    const available = byType[type];
    const target = typeTargets[type];
    
    // Shuffle for randomness
    const shuffled = shuffleArray([...available]);
    const selected = shuffled.slice(0, target);
    
    selectedNegatives.push(...selected);
    typeCounts[type] = selected.length;
    
    if (selected.length < target) {
      limitedTypes.push(type);
    }
  }
  
  // If we couldn't fill quotas, take from structural (most common)
  const deficit = actualNegatives - selectedNegatives.length;
  if (deficit > 0) {
    const remaining = byType.STRUCTURAL.filter(
      s => !selectedNegatives.includes(s)
    );
    const extra = remaining.slice(0, deficit);
    selectedNegatives.push(...extra);
    typeCounts.STRUCTURAL += extra.length;
  }
  
  // Combine and limit total
  const balanced = [...positives, ...selectedNegatives].slice(0, maxSamples);
  
  // Calculate final stats
  const finalPositive = balanced.filter(s => s.label === 1).length;
  const finalNegative = balanced.filter(s => s.label === 0).length;
  
  const typeDistribution: Record<NegativeType, number> = {
    STRUCTURAL: 0,
    NOISE: 0,
    EXHAUSTION: 0,
    REVERSAL: 0,
  };
  
  if (finalNegative > 0) {
    for (const type of Object.keys(typeCounts) as NegativeType[]) {
      typeDistribution[type] = typeCounts[type] / finalNegative;
    }
  }
  
  return {
    balanced,
    stats: {
      totalInput: samples.length,
      totalOutput: balanced.length,
      positive: finalPositive,
      negative: finalNegative,
      byType: typeCounts,
      negPosRatio: finalPositive > 0 ? finalNegative / finalPositive : 0,
      typeDistribution,
      limitedTypes,
      droppedForBalance: samples.length - balanced.length,
    },
  };
}

/**
 * Calculate target counts per type based on quotas
 */
function calculateTypeTargets(
  totalNegatives: number,
  quotas: TypeQuotas
): Record<NegativeType, number> {
  // Use middle of quota range as target
  return {
    STRUCTURAL: Math.floor(totalNegatives * (quotas.STRUCTURAL.min + quotas.STRUCTURAL.max) / 2),
    NOISE: Math.floor(totalNegatives * (quotas.NOISE.min + quotas.NOISE.max) / 2),
    EXHAUSTION: Math.floor(totalNegatives * (quotas.EXHAUSTION.min + quotas.EXHAUSTION.max) / 2),
    REVERSAL: Math.floor(totalNegatives * (quotas.REVERSAL.min + quotas.REVERSAL.max) / 2),
  };
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Validate dataset meets gate requirements
 */
export function validateDataset(samples: NegativeSample[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  const positives = samples.filter(s => s.label === 1).length;
  const negatives = samples.filter(s => s.label === 0).length;
  
  // Check minimum samples
  if (samples.length < 1000) {
    issues.push(`Total samples ${samples.length} < 1000 minimum`);
  }
  
  // Check ratio
  const ratio = positives > 0 ? negatives / positives : 0;
  if (ratio < MIN_NEG_POS_RATIO) {
    issues.push(`Neg:Pos ratio ${ratio.toFixed(2)} < ${MIN_NEG_POS_RATIO} minimum`);
  }
  
  // Check type diversity
  const byType = new Set(samples.filter(s => s.label === 0).map(s => s.negativeType));
  if (byType.size < 3) {
    issues.push(`Only ${byType.size} negative types (need >= 3)`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Build run statistics
 */
export function buildRunStats(
  runId: string,
  horizon: string,
  samples: NegativeSample[],
  candidatesFound: number,
  insufficientCount: number,
  limitedTypes: NegativeType[]
): Partial<NegativeRunStats> {
  const positives = samples.filter(s => s.label === 1);
  const negatives = samples.filter(s => s.label === 0);
  
  const byType: Record<NegativeType, number> = {
    STRUCTURAL: 0,
    NOISE: 0,
    EXHAUSTION: 0,
    REVERSAL: 0,
  };
  
  for (const neg of negatives) {
    if (neg.negativeType) {
      byType[neg.negativeType]++;
    }
  }
  
  const typeDistribution: Record<NegativeType, number> = {
    STRUCTURAL: 0,
    NOISE: 0,
    EXHAUSTION: 0,
    REVERSAL: 0,
  };
  
  const totalNeg = negatives.length;
  if (totalNeg > 0) {
    for (const type of Object.keys(byType) as NegativeType[]) {
      typeDistribution[type] = byType[type] / totalNeg;
    }
  }
  
  return {
    runId,
    horizon,
    candidatesFound,
    samplesGenerated: samples.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    insufficientCount,
    byType,
    negPosRatio: positives.length > 0 ? negatives.length / positives.length : 0,
    typeDistribution,
    limitedTypes,
    reasons: [],
  };
}
