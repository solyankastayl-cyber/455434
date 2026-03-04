/**
 * Confidence Calculator - ETAP D1
 * 
 * Calculates confidence score for aggregated relations.
 * Higher confidence = more reliable edge in graph.
 * 
 * Factors:
 * - Transaction count (more = higher)
 * - Volume (higher = more significant)
 * - Recency (recent = more relevant)
 * - Frequency (consistent activity = higher)
 */

import type { AggregatedRelation } from './aggregation.pipeline.js';

/**
 * Confidence calculation weights
 */
const WEIGHTS = {
  TX_COUNT: 0.25,      // More transactions = higher confidence
  VOLUME: 0.25,        // Higher volume = more significant
  RECENCY: 0.25,       // Recent activity = more relevant
  FREQUENCY: 0.15,     // Consistent activity = higher confidence
  TOKEN_DIVERSITY: 0.10, // Multiple tokens = more established relationship
};

/**
 * Thresholds for scoring
 */
const THRESHOLDS = {
  TX_COUNT_LOW: 3,
  TX_COUNT_HIGH: 20,
  VOLUME_LOW: 1000,      // $1k
  VOLUME_HIGH: 100000,   // $100k
  RECENCY_DAYS: 30,
  FREQUENCY_TXS_PER_DAY: 0.5,
};

/**
 * Calculate confidence score for a relation
 * 
 * @param rel - Aggregated relation data
 * @returns Confidence score 0-1
 */
export function calculateConfidence(rel: {
  txCount: number;
  volumeUsd: number;
  firstSeen: Date | number;
  lastSeen: Date | number;
  tokens?: string[];
}): number {
  let score = 0;
  
  // 1. TX Count score (0-1)
  const txScore = normalizeLog(rel.txCount, THRESHOLDS.TX_COUNT_LOW, THRESHOLDS.TX_COUNT_HIGH);
  score += txScore * WEIGHTS.TX_COUNT;
  
  // 2. Volume score (0-1)
  const volumeScore = normalizeLog(rel.volumeUsd, THRESHOLDS.VOLUME_LOW, THRESHOLDS.VOLUME_HIGH);
  score += volumeScore * WEIGHTS.VOLUME;
  
  // 3. Recency score (0-1)
  const lastSeenTime = typeof rel.lastSeen === 'number' ? rel.lastSeen : new Date(rel.lastSeen).getTime();
  const daysSinceLast = (Date.now() - lastSeenTime) / (24 * 60 * 60 * 1000);
  const recencyScore = Math.max(0, 1 - (daysSinceLast / (THRESHOLDS.RECENCY_DAYS * 3)));
  score += recencyScore * WEIGHTS.RECENCY;
  
  // 4. Frequency score (0-1)
  const firstSeenTime = typeof rel.firstSeen === 'number' ? rel.firstSeen : new Date(rel.firstSeen).getTime();
  const daySpan = Math.max(1, (lastSeenTime - firstSeenTime) / (24 * 60 * 60 * 1000));
  const txsPerDay = rel.txCount / daySpan;
  const frequencyScore = Math.min(1, txsPerDay / THRESHOLDS.FREQUENCY_TXS_PER_DAY);
  score += frequencyScore * WEIGHTS.FREQUENCY;
  
  // 5. Token diversity score (0-1)
  const tokenCount = rel.tokens?.length ?? 1;
  const diversityScore = Math.min(1, tokenCount / 3);
  score += diversityScore * WEIGHTS.TOKEN_DIVERSITY;
  
  return Math.min(1, Math.max(0, score));
}

/**
 * Normalize value to 0-1 using logarithmic scale
 */
function normalizeLog(value: number, low: number, high: number): number {
  if (value <= 0) return 0;
  if (value <= low) return 0.3;
  if (value >= high) return 1;
  
  const logValue = Math.log10(value);
  const logLow = Math.log10(low);
  const logHigh = Math.log10(high);
  
  return 0.3 + 0.7 * (logValue - logLow) / (logHigh - logLow);
}

/**
 * Get confidence level label
 */
export function getConfidenceLevel(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
  if (confidence >= 0.8) return 'VERY_HIGH';
  if (confidence >= 0.6) return 'HIGH';
  if (confidence >= 0.4) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate weight for edge rendering (thickness)
 * 
 * @param rel - Relation with volume/confidence
 * @param maxVolume - Max volume in the graph (for normalization)
 * @returns Weight 0-1 for edge thickness
 */
export function calculateEdgeWeight(
  rel: { volumeUsd: number; confidence: number },
  maxVolume: number
): number {
  // Combine volume-based weight with confidence
  const volumeWeight = maxVolume > 0 
    ? Math.sqrt(rel.volumeUsd / maxVolume) // sqrt for less extreme differences
    : 0.5;
  
  // Final weight = 70% volume + 30% confidence
  return Math.max(0.15, Math.min(1, volumeWeight * 0.7 + rel.confidence * 0.3));
}
