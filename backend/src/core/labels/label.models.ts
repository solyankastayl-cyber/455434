/**
 * P2.2 Labeling Pipeline - Models & Types
 * 
 * Ground truth labels for ML training
 * Network-first, event-based, fixed horizons
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// CONSTANTS
// ============================================

export const HORIZONS = ['1h', '4h', '24h'] as const;
export type Horizon = typeof HORIZONS[number];

export const PRICE_LABELS = ['STRONG_UP', 'UP', 'FLAT', 'DOWN', 'STRONG_DOWN'] as const;
export type PriceLabel = typeof PRICE_LABELS[number];

export const FLOW_OUTCOMES = ['CONFIRMED', 'WEAK', 'FALSE'] as const;
export type FlowOutcome = typeof FLOW_OUTCOMES[number];

export const PERFORMANCE_LABELS = ['SMART', 'NEUTRAL', 'NOISY'] as const;
export type PerformanceLabel = typeof PERFORMANCE_LABELS[number];

// Thresholds for price labels (configurable)
export const PRICE_THRESHOLDS = {
  STRONG_UP: 0.05,    // >= +5%
  UP: 0.015,          // +1.5% to +5%
  FLAT_UPPER: 0.015,  // -1.5% to +1.5%
  FLAT_LOWER: -0.015,
  DOWN: -0.05,        // -5% to -1.5%
  STRONG_DOWN: -0.05, // <= -5%
};

// ============================================
// 1. LABEL PRICE OUTCOME
// ============================================

export interface ILabelPriceOutcome {
  network: string;
  asset: string;
  ts: number;           // Event timestamp
  horizon: Horizon;
  
  priceNow: number;
  priceFuture: number;
  returnPct: number;
  label: PriceLabel;
  
  meta: {
    computedAtTs: number;
    version: string;
  };
}

const LabelPriceOutcomeSchema = new Schema<ILabelPriceOutcome>({
  network: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  horizon: { type: String, enum: HORIZONS, required: true },
  
  priceNow: { type: Number, required: true },
  priceFuture: { type: Number, required: true },
  returnPct: { type: Number, required: true },
  label: { type: String, enum: PRICE_LABELS, required: true },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    version: { type: String, default: 'P2.2.0' },
  },
}, {
  timestamps: false,
  collection: 'label_price_outcome',
});

LabelPriceOutcomeSchema.index({ network: 1, asset: 1, ts: -1, horizon: 1 }, { unique: true });

export const LabelPriceOutcomeModel = mongoose.models.LabelPriceOutcome || 
  mongoose.model<ILabelPriceOutcome>('LabelPriceOutcome', LabelPriceOutcomeSchema);

// ============================================
// 2. LABEL FLOW EFFECT
// ============================================

export interface ILabelFlowEffect {
  network: string;
  asset: string;
  ts: number;
  horizon: Horizon;
  
  signalType: 'PRESSURE' | 'ZONE' | 'COMBINED';
  signalValue: number;
  expectedDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  actualDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  outcome: FlowOutcome;
  
  meta: {
    computedAtTs: number;
    version: string;
  };
}

const LabelFlowEffectSchema = new Schema<ILabelFlowEffect>({
  network: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  horizon: { type: String, enum: HORIZONS, required: true },
  
  signalType: { type: String, enum: ['PRESSURE', 'ZONE', 'COMBINED'], required: true },
  signalValue: { type: Number, required: true },
  expectedDirection: { type: String, enum: ['UP', 'DOWN', 'NEUTRAL'], required: true },
  actualDirection: { type: String, enum: ['UP', 'DOWN', 'NEUTRAL'], required: true },
  outcome: { type: String, enum: FLOW_OUTCOMES, required: true },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    version: { type: String, default: 'P2.2.0' },
  },
}, {
  timestamps: false,
  collection: 'label_flow_effect',
});

LabelFlowEffectSchema.index({ network: 1, asset: 1, ts: -1, horizon: 1, signalType: 1 }, { unique: true });

export const LabelFlowEffectModel = mongoose.models.LabelFlowEffect || 
  mongoose.model<ILabelFlowEffect>('LabelFlowEffect', LabelFlowEffectSchema);

// ============================================
// 3. LABEL ACTOR PERFORMANCE
// ============================================

export interface ILabelActorPerformance {
  actorId: string;
  network: string;
  period: '7d' | '30d';
  
  eventCount: number;
  hitRate: number;       // 0-1
  avgReturn: number;     // percentage
  label: PerformanceLabel;
  
  meta: {
    computedAtTs: number;
    version: string;
  };
}

const LabelActorPerformanceSchema = new Schema<ILabelActorPerformance>({
  actorId: { type: String, required: true, index: true },
  network: { type: String, required: true, index: true },
  period: { type: String, enum: ['7d', '30d'], required: true },
  
  eventCount: { type: Number, required: true },
  hitRate: { type: Number, required: true },
  avgReturn: { type: Number, required: true },
  label: { type: String, enum: PERFORMANCE_LABELS, required: true },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    version: { type: String, default: 'P2.2.0' },
  },
}, {
  timestamps: false,
  collection: 'label_actor_performance',
});

LabelActorPerformanceSchema.index({ actorId: 1, network: 1, period: 1 }, { unique: true });

export const LabelActorPerformanceModel = mongoose.models.LabelActorPerformance || 
  mongoose.model<ILabelActorPerformance>('LabelActorPerformance', LabelActorPerformanceSchema);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate price label from return percentage
 */
export function getPriceLabel(returnPct: number): PriceLabel {
  if (returnPct >= PRICE_THRESHOLDS.STRONG_UP) return 'STRONG_UP';
  if (returnPct >= PRICE_THRESHOLDS.UP) return 'UP';
  if (returnPct <= PRICE_THRESHOLDS.STRONG_DOWN) return 'STRONG_DOWN';
  if (returnPct <= PRICE_THRESHOLDS.DOWN) return 'DOWN';
  return 'FLAT';
}

/**
 * Get expected direction from signal value
 * Negative pressure = BUY signal (withdrawals > deposits)
 * Positive pressure = SELL signal (deposits > withdrawals)
 */
export function getExpectedDirection(signalValue: number, signalType: string): 'UP' | 'DOWN' | 'NEUTRAL' {
  if (signalType === 'PRESSURE') {
    if (signalValue < -0.2) return 'UP';   // BUY pressure
    if (signalValue > 0.2) return 'DOWN';  // SELL pressure
    return 'NEUTRAL';
  }
  if (signalType === 'ZONE') {
    if (signalValue > 0.55) return 'UP';   // Accumulation dominant
    if (signalValue < 0.45) return 'DOWN'; // Distribution dominant
    return 'NEUTRAL';
  }
  return 'NEUTRAL';
}

/**
 * Get actual direction from return
 */
export function getActualDirection(returnPct: number): 'UP' | 'DOWN' | 'NEUTRAL' {
  if (returnPct > 0.015) return 'UP';
  if (returnPct < -0.015) return 'DOWN';
  return 'NEUTRAL';
}

/**
 * Determine flow outcome
 */
export function getFlowOutcome(expected: string, actual: string, returnPct: number): FlowOutcome {
  if (expected === actual) return 'CONFIRMED';
  if (expected === 'NEUTRAL' || actual === 'NEUTRAL') return 'WEAK';
  // Weak if small move in expected direction
  if (Math.abs(returnPct) < 0.03) return 'WEAK';
  return 'FALSE';
}

/**
 * Get performance label from metrics
 */
export function getPerformanceLabel(hitRate: number, avgReturn: number): PerformanceLabel {
  if (hitRate >= 0.6 && avgReturn > 0) return 'SMART';
  if (hitRate < 0.4) return 'NOISY';
  return 'NEUTRAL';
}

/**
 * Horizon to seconds
 */
export function horizonToSeconds(horizon: Horizon): number {
  switch (horizon) {
    case '1h': return 3600;
    case '4h': return 14400;
    case '24h': return 86400;
  }
}

export default {
  LabelPriceOutcomeModel,
  LabelFlowEffectModel,
  LabelActorPerformanceModel,
  getPriceLabel,
  getExpectedDirection,
  getActualDirection,
  getFlowOutcome,
  getPerformanceLabel,
  horizonToSeconds,
};
