/**
 * Price Label Builder
 * 
 * EPIC 9: Builds price reaction labels from signals
 * 
 * Dual-horizon: 24h + 7d
 * Creates ground truth for ML training
 */

import type {
  PriceLabel,
  PriceLabelPair,
  Reaction24hLabel,
  Reaction7dLabel,
  PriceMetrics24h,
  PriceMetrics7d,
} from './price_label.types.js';
import { LABEL_THRESHOLDS, SIGNAL_QUALITY_MATRIX } from './price_label.types.js';
import { v4 as uuidv4 } from 'uuid';

interface PriceDataPoint {
  timestamp: Date;
  price: number;
}

interface SignalCandidate {
  tokenAddress: string;
  signalId?: string;
  signalTimestamp: Date;
}

// ============================================
// 24h LABELING
// ============================================

export function calculate24hMetrics(
  priceAtSignal: number,
  priceHistory24h: PriceDataPoint[]
): PriceMetrics24h | null {
  if (priceHistory24h.length < 2) return null;
  
  const prices = priceHistory24h.map(p => p.price);
  const lastPrice = prices[prices.length - 1];
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  
  // Calculate log returns for volatility
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i-1] > 0 && prices[i] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i-1]));
    }
  }
  
  const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length || 0;
  const variance = logReturns.reduce((a, r) => a + Math.pow(r - meanReturn, 2), 0) / logReturns.length || 0;
  const volatility = Math.sqrt(variance);
  
  return {
    priceAtSignal,
    priceAt24h: lastPrice,
    maxPrice24h: maxPrice,
    minPrice24h: minPrice,
    returnPct: (lastPrice - priceAtSignal) / priceAtSignal,
    maxUpsidePct: (maxPrice - priceAtSignal) / priceAtSignal,
    maxDrawdownPct: (minPrice - priceAtSignal) / priceAtSignal,
    volatility24h: volatility,
  };
}

export function classify24h(metrics: PriceMetrics24h): Reaction24hLabel {
  const { returnPct } = metrics;
  const t = LABEL_THRESHOLDS['24h'];
  
  if (returnPct >= t.strongUp) {
    return 'STRONG_UP';
  } else if (returnPct >= t.weakUp) {
    return 'WEAK_UP';
  } else if (returnPct >= -t.flat) {
    return 'FLAT';
  } else {
    return 'DOWN';
  }
}

// ============================================
// 7d LABELING
// ============================================

export function calculate7dMetrics(
  priceAtSignal: number,
  priceHistory7d: PriceDataPoint[]
): PriceMetrics7d | null {
  if (priceHistory7d.length < 2) return null;
  
  const prices = priceHistory7d.map(p => p.price);
  const lastPrice = prices[prices.length - 1];
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  
  // Find time to peak
  const maxIndex = prices.indexOf(maxPrice);
  const timeToPeakHours = maxIndex * (168 / prices.length); // Approximate
  
  // Calculate trend consistency
  let sameDirection = 0;
  let totalMoves = 0;
  const initialDirection = prices[1] > prices[0] ? 1 : -1;
  
  for (let i = 1; i < prices.length; i++) {
    const direction = prices[i] > prices[i-1] ? 1 : (prices[i] < prices[i-1] ? -1 : 0);
    if (direction !== 0) {
      totalMoves++;
      if (direction === initialDirection) {
        sameDirection++;
      }
    }
  }
  
  const trendConsistency = totalMoves > 0 ? sameDirection / totalMoves : 0;
  
  return {
    priceAtSignal,
    priceAt7d: lastPrice,
    maxPrice7d: maxPrice,
    minPrice7d: minPrice,
    timeToPeakHours,
    returnPct: (lastPrice - priceAtSignal) / priceAtSignal,
    maxUpsidePct: (maxPrice - priceAtSignal) / priceAtSignal,
    maxDrawdownPct: (minPrice - priceAtSignal) / priceAtSignal,
    trendConsistency,
  };
}

export function classify7d(
  metrics24h: PriceMetrics24h,
  metrics7d: PriceMetrics7d
): Reaction7dLabel {
  const t = LABEL_THRESHOLDS['7d'];
  const { returnPct: return7d, trendConsistency } = metrics7d;
  const { returnPct: return24h, maxUpsidePct: maxUp24h } = metrics24h;
  
  // Check for follow-through: sustained gains
  if (return7d >= t.followThrough && trendConsistency >= 0.5) {
    return 'FOLLOW_THROUGH';
  }
  
  // Check for reversal: started up but ended down
  if (return24h > 0 && return7d < t.reversalThreshold) {
    return 'REVERSED';
  }
  
  // Check for fade: had gains but lost most of them
  if (maxUp24h > 0.02 && return7d < maxUp24h * t.fadeThreshold) {
    return 'FADED';
  }
  
  // Default: noise
  return 'NOISE';
}

// ============================================
// PAIR LABEL & QUALITY
// ============================================

export function buildPairLabel(
  label24h: Reaction24hLabel,
  label7d: Reaction7dLabel
): PriceLabelPair {
  const signalQuality = SIGNAL_QUALITY_MATRIX[label24h][label7d];
  
  return {
    label24h,
    label7d,
    signalQuality,
  };
}

export function getBinaryLabel(pairLabel: PriceLabelPair): 0 | 1 {
  // VALID and STEALTH are positive (1), others are negative (0)
  return (pairLabel.signalQuality === 'VALID' || pairLabel.signalQuality === 'STEALTH') ? 1 : 0;
}

// ============================================
// FULL LABEL BUILDER
// ============================================

export function buildPriceLabel(
  candidate: SignalCandidate,
  priceAtSignal: number,
  priceHistory24h: PriceDataPoint[],
  priceHistory7d: PriceDataPoint[],
  runId: string,
  priceSource: string
): PriceLabel | null {
  // Calculate metrics
  const metrics24h = calculate24hMetrics(priceAtSignal, priceHistory24h);
  const metrics7d = calculate7dMetrics(priceAtSignal, priceHistory7d);
  
  if (!metrics24h || !metrics7d) {
    return null; // Insufficient data
  }
  
  // Classify
  const label24h = classify24h(metrics24h);
  const label7d = classify7d(metrics24h, metrics7d);
  const pairLabel = buildPairLabel(label24h, label7d);
  const binaryLabel = getBinaryLabel(pairLabel);
  
  return {
    labelId: uuidv4(),
    tokenAddress: candidate.tokenAddress,
    signalId: candidate.signalId,
    signalTimestamp: candidate.signalTimestamp,
    
    label24h,
    label7d,
    pairLabel,
    
    metrics24h,
    metrics7d,
    
    binaryLabel,
    
    createdAt: new Date(),
    runId,
    gateVersion: 'EPIC_9',
    priceSource,
  };
}

// ============================================
// BATCH BUILDER
// ============================================

export interface LabelBuildResult {
  labels: PriceLabel[];
  insufficientCount: number;
}

export function buildLabelsFromCandidates(
  candidates: SignalCandidate[],
  getPriceData: (tokenAddress: string, signalTime: Date) => {
    priceAtSignal: number;
    priceHistory24h: PriceDataPoint[];
    priceHistory7d: PriceDataPoint[];
  } | null,
  runId: string,
  priceSource: string
): LabelBuildResult {
  const labels: PriceLabel[] = [];
  let insufficientCount = 0;
  
  for (const candidate of candidates) {
    const priceData = getPriceData(candidate.tokenAddress, candidate.signalTimestamp);
    
    if (!priceData) {
      insufficientCount++;
      continue;
    }
    
    const label = buildPriceLabel(
      candidate,
      priceData.priceAtSignal,
      priceData.priceHistory24h,
      priceData.priceHistory7d,
      runId,
      priceSource
    );
    
    if (label) {
      labels.push(label);
    } else {
      insufficientCount++;
    }
  }
  
  return { labels, insufficientCount };
}
