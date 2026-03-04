/**
 * Actor Temporal Context Service
 * 
 * EPIC A4-BE-2: Temporal Context (READ-ONLY)
 * 
 * Calculates actor regime (INCREASING/STABLE/DECREASING)
 * based on participation_delta and volume_delta.
 * 
 * NO ML. Pure L0 observation.
 */

import type { ActorScore } from '../actor_scores/actor_score.types.js';

export type TemporalRegime = 'INCREASING' | 'STABLE' | 'DECREASING';
export type TemporalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ActorTemporalContext {
  regime: TemporalRegime;
  window: '7d' | '24h' | '30d';
  confidence: TemporalConfidence;
  deltas: {
    participation: number;  // -1 to 1
    volume: number;         // -1 to 1
  };
  computedAt: Date;
}

// Thresholds for regime classification
const EPSILON = 0.15; // 15% change threshold

/**
 * Classify regime from delta value
 */
function classifyRegime(delta: number): TemporalRegime {
  if (Math.abs(delta) < EPSILON) return 'STABLE';
  if (delta > EPSILON) return 'INCREASING';
  return 'DECREASING';
}

/**
 * Calculate participation delta between two windows
 * Participation = tx_count weighted by volume
 */
export function calculateParticipationDelta(
  current: { txCount: number; volumeUsd: number },
  previous: { txCount: number; volumeUsd: number }
): number {
  // Participation score = log(volume) * sqrt(txCount)
  const calcParticipation = (tx: number, vol: number) => {
    if (vol <= 0 || tx <= 0) return 0;
    return Math.log10(vol + 1) * Math.sqrt(tx);
  };
  
  const currentP = calcParticipation(current.txCount, current.volumeUsd);
  const previousP = calcParticipation(previous.txCount, previous.volumeUsd);
  
  if (previousP === 0) {
    return currentP > 0 ? 1 : 0;
  }
  
  // Relative change, capped at -1 to 1
  const delta = (currentP - previousP) / previousP;
  return Math.max(-1, Math.min(1, delta));
}

/**
 * Calculate volume delta between two windows
 */
export function calculateVolumeDelta(
  currentVolumeUsd: number,
  previousVolumeUsd: number
): number {
  if (previousVolumeUsd === 0) {
    return currentVolumeUsd > 0 ? 1 : 0;
  }
  
  const delta = (currentVolumeUsd - previousVolumeUsd) / previousVolumeUsd;
  return Math.max(-1, Math.min(1, delta));
}

/**
 * Calculate temporal context from score data
 */
export function calculateTemporalContext(
  current: ActorScore,
  previous: ActorScore | null
): ActorTemporalContext {
  const window = current.window;
  
  // If no previous data, return STABLE with LOW confidence
  if (!previous) {
    return {
      regime: 'STABLE',
      window,
      confidence: 'LOW',
      deltas: { participation: 0, volume: 0 },
      computedAt: new Date(),
    };
  }
  
  // Calculate deltas
  const participationDelta = calculateParticipationDelta(
    { txCount: current.metrics.txCount, volumeUsd: current.metrics.totalVolumeUsd },
    { txCount: previous.metrics.txCount, volumeUsd: previous.metrics.totalVolumeUsd }
  );
  
  const volumeDelta = calculateVolumeDelta(
    current.metrics.totalVolumeUsd,
    previous.metrics.totalVolumeUsd
  );
  
  // Combine deltas (weighted average)
  const combinedDelta = (participationDelta * 0.6) + (volumeDelta * 0.4);
  
  // Classify regime
  const regime = classifyRegime(combinedDelta);
  
  // Determine confidence based on data quality
  let confidence: TemporalConfidence = 'MEDIUM';
  
  if (current.coverageBand === 'HIGH' && previous.coverageBand !== 'LOW') {
    confidence = 'HIGH';
  } else if (current.coverageBand === 'LOW' || previous.coverageBand === 'LOW') {
    confidence = 'LOW';
  }
  
  return {
    regime,
    window,
    confidence,
    deltas: {
      participation: Math.round(participationDelta * 100) / 100,
      volume: Math.round(volumeDelta * 100) / 100,
    },
    computedAt: new Date(),
  };
}

/**
 * Get human-readable description of regime
 */
export function getRegimeDescription(context: ActorTemporalContext): string {
  const { regime, window, confidence } = context;
  
  const regimeText = {
    INCREASING: `Participation increasing over last ${window}`,
    STABLE: `Participation stable over last ${window}`,
    DECREASING: `Participation decreasing over last ${window}`,
  };
  
  const confidenceNote = confidence === 'LOW' 
    ? ' (limited data)' 
    : '';
  
  return regimeText[regime] + confidenceNote;
}

/**
 * Get regime icon/badge info
 */
export function getRegimeBadge(regime: TemporalRegime): {
  icon: '↑' | '→' | '↓';
  color: string;
  label: string;
} {
  switch (regime) {
    case 'INCREASING':
      return { icon: '↑', color: 'emerald', label: 'Increasing' };
    case 'STABLE':
      return { icon: '→', color: 'gray', label: 'Stable' };
    case 'DECREASING':
      return { icon: '↓', color: 'amber', label: 'Decreasing' };
  }
}
