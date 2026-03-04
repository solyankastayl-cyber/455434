/**
 * Negative Ready Collector
 * 
 * Collects metrics for NEGATIVE_READY section of gate check
 * EPIC 8 implementation - checks negative sample pipeline
 */

import { getSampleStats } from '../../ml_negative/negative.store.js';

interface NegativeMetrics {
  negPosRatio: number;
  negativeTypes: number;
  noiseShare: number;
  exhaustionShare: number;
  structuralShare: number;
  isRandom: boolean;
  isManual: boolean;
}

export async function collectNegativeMetrics(_horizon: string): Promise<NegativeMetrics> {
  // Get actual stats from negative sample store
  const stats = await getSampleStats();
  
  const totalNeg = stats.negative;
  
  // Calculate shares from byType
  const structuralShare = totalNeg > 0 ? (stats.byType.STRUCTURAL || 0) / totalNeg : 0;
  const noiseShare = totalNeg > 0 ? (stats.byType.NOISE || 0) / totalNeg : 0;
  const exhaustionShare = totalNeg > 0 ? (stats.byType.EXHAUSTION || 0) / totalNeg : 0;
  const reversalShare = totalNeg > 0 ? (stats.byType.REVERSAL || 0) / totalNeg : 0;
  
  // Count types with samples
  const negativeTypes = Object.values(stats.byType).filter(c => c > 0).length;
  
  return {
    negPosRatio: stats.negPosRatio,
    negativeTypes,
    noiseShare,
    exhaustionShare,
    structuralShare,
    isRandom: false, // Pipeline ensures non-random selection
    isManual: false, // Pipeline is automated
  };
}
