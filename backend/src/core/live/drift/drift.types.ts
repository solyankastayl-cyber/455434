/**
 * Drift Types
 * 
 * Type definitions for LI-5 Drift Summary.
 * NO interpretations, NO BUY/SELL.
 */

export type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DriftMetrics {
  volume: number;
  netFlow: number;
  actorCount: number;
}

export interface DriftPercentages {
  volumePct: number;
  netFlowPct: number;
  actorPct: number;
  composite: number;
}

export interface DriftSummaryData {
  token: string;
  tokenAddress: string;
  window: '1h' | '6h' | '24h';
  
  sim: DriftMetrics;
  live: DriftMetrics;
  
  drift: DriftPercentages;
  level: DriftLevel;
  
  timestamp: Date;
}

// ==================== THRESHOLDS ====================

export const DRIFT_THRESHOLDS = {
  LOW_MAX: 0.15,      // < 0.15 = LOW
  MEDIUM_MAX: 0.30,   // 0.15-0.30 = MEDIUM
  HIGH_MAX: 0.50,     // 0.30-0.50 = HIGH
  // >= 0.50 = CRITICAL
};

// ==================== DRIFT MODIFIERS ====================

export const DRIFT_MODIFIERS: Record<DriftLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.60,
  CRITICAL: 0.30,
};

// ==================== WEIGHTS ====================

export const DRIFT_WEIGHTS = {
  volume: 0.4,
  netFlow: 0.4,
  actor: 0.2,
};
