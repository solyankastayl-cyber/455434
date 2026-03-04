/**
 * Price Label Types
 * 
 * EPIC 9: Price Reaction Labels (Ground Truth)
 * Dual-horizon validation: 24h + 7d
 */

// ============================================
// HORIZONS
// ============================================

export type PriceHorizon = '24h' | '7d';

export const PRICE_HORIZONS: PriceHorizon[] = ['24h', '7d'];

// ============================================
// 24h REACTION LABELS (short-term)
// ============================================

export type Reaction24hLabel = 
  | 'STRONG_UP'    // > +5%
  | 'WEAK_UP'      // +2% to +5%
  | 'FLAT'         // -2% to +2%
  | 'DOWN';        // < -2%

// ============================================
// 7d REACTION LABELS (follow-through)
// ============================================

export type Reaction7dLabel = 
  | 'FOLLOW_THROUGH'  // Sustained move
  | 'FADED'           // Initial move faded
  | 'REVERSED'        // Reversed direction
  | 'NOISE';          // No clear pattern

// ============================================
// COMBINED PAIR LABEL
// ============================================

export interface PriceLabelPair {
  label24h: Reaction24hLabel;
  label7d: Reaction7dLabel;
  
  // Derived signal quality
  signalQuality: 'VALID' | 'EXHAUSTION' | 'STEALTH' | 'TRAP' | 'NOISE';
}

// Combined interpretation matrix
export const SIGNAL_QUALITY_MATRIX: Record<Reaction24hLabel, Record<Reaction7dLabel, PriceLabelPair['signalQuality']>> = {
  'STRONG_UP': {
    'FOLLOW_THROUGH': 'VALID',
    'FADED': 'EXHAUSTION',
    'REVERSED': 'TRAP',
    'NOISE': 'NOISE',
  },
  'WEAK_UP': {
    'FOLLOW_THROUGH': 'STEALTH',
    'FADED': 'NOISE',
    'REVERSED': 'TRAP',
    'NOISE': 'NOISE',
  },
  'FLAT': {
    'FOLLOW_THROUGH': 'STEALTH',
    'FADED': 'NOISE',
    'REVERSED': 'NOISE',
    'NOISE': 'NOISE',
  },
  'DOWN': {
    'FOLLOW_THROUGH': 'TRAP',
    'FADED': 'TRAP',
    'REVERSED': 'VALID', // Reversal from down = actually good
    'NOISE': 'NOISE',
  },
};

// ============================================
// PRICE METRICS
// ============================================

export interface PriceMetrics24h {
  priceAtSignal: number;
  priceAt24h: number;
  maxPrice24h: number;
  minPrice24h: number;
  
  // Derived
  returnPct: number;        // (price24h - priceAtSignal) / priceAtSignal
  maxUpsidePct: number;     // (maxPrice - priceAtSignal) / priceAtSignal
  maxDrawdownPct: number;   // (minPrice - priceAtSignal) / priceAtSignal
  volatility24h: number;    // std(log returns)
}

export interface PriceMetrics7d {
  priceAtSignal: number;
  priceAt7d: number;
  maxPrice7d: number;
  minPrice7d: number;
  timeToPeakHours: number;  // Hours from signal to max price
  
  // Derived
  returnPct: number;
  maxUpsidePct: number;
  maxDrawdownPct: number;
  trendConsistency: number; // 0-1, how consistent was direction
}

// ============================================
// FULL PRICE LABEL DOCUMENT
// ============================================

export interface PriceLabel {
  labelId: string;
  tokenAddress: string;
  signalId?: string;
  signalTimestamp: Date;
  
  // Dual-horizon labels
  label24h: Reaction24hLabel;
  label7d: Reaction7dLabel;
  pairLabel: PriceLabelPair;
  
  // Raw metrics
  metrics24h: PriceMetrics24h;
  metrics7d: PriceMetrics7d;
  
  // For ML training
  binaryLabel: 0 | 1;  // Simplified: VALID/STEALTH = 1, others = 0
  
  // Metadata
  createdAt: Date;
  runId: string;
  gateVersion: string;
  priceSource: string;
}

// ============================================
// LABELING THRESHOLDS
// ============================================

export const LABEL_THRESHOLDS = {
  '24h': {
    strongUp: 0.05,    // > +5%
    weakUp: 0.02,      // > +2%
    flat: 0.02,        // ±2%
    // down: < -2%
  },
  '7d': {
    followThrough: 0.05,   // > +5% sustained
    fadeThreshold: 0.50,   // Lost > 50% of gains
    reversalThreshold: -0.03, // < -3%
    noiseThreshold: 0.02,  // Volatility but no clear direction
  },
} as const;

// ============================================
// GATE CHECK THRESHOLDS (24h + 7d)
// ============================================

export const GATE_THRESHOLDS_24H = {
  precision: 0.58,
  falsePositiveRate: 0.35,
  calibrationBrier: 0.22,
  negativeRatio: 0.65,
  minSamples: 1500,
};

export const GATE_THRESHOLDS_7D = {
  precision: 0.62,
  stabilityStdDev: 0.18,
  drift: 0.15,
  negativeRatio: 0.70,
  minSamples: 5000,
};

// ============================================
// RUN CONFIG
// ============================================

export interface PriceLabelRunConfig {
  startDate?: Date;
  endDate?: Date;
  maxSignals: number;
  priceSource: 'cex' | 'dex' | 'aggregated';
  dryRun?: boolean;
}

export interface PriceLabelRunStats {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  
  // Counts
  signalsProcessed: number;
  labelsGenerated: number;
  insufficientData: number;
  
  // Distribution 24h
  distribution24h: Record<Reaction24hLabel, number>;
  
  // Distribution 7d
  distribution7d: Record<Reaction7dLabel, number>;
  
  // Signal quality distribution
  qualityDistribution: Record<string, number>;
  
  // Binary label ratio
  positiveRatio: number;
  
  // Issues
  errors: string[];
}
