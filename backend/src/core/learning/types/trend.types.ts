/**
 * Trend Validation Types
 * 
 * ETAP 3.2: Type definitions for trend validation.
 * Pure deterministic labels - NO ML, NO probabilities.
 */

// ==================== TREND LABELS ====================

export type TrendLabel = 'NOISE' | 'SIDEWAYS' | 'TREND_UP' | 'TREND_DOWN';
export type DelayLabel = 'INSTANT' | 'DELAYED' | 'LATE' | 'NONE';

// ==================== HORIZON CONFIG ====================

export interface TrendThresholds {
  Rmin: number;      // Minimum return % for significance
  Vmin: number;      // Minimum volume change % for confirmation
  Dmax: number;      // Maximum drawdown % for uptrend validity
  Rnoise: number;    // Range for noise/sideways classification
}

export const TREND_THRESHOLDS: Record<string, TrendThresholds> = {
  '1d': {
    Rmin: 3,       // 3%
    Vmin: 10,      // 10%
    Dmax: 6,       // 6%
    Rnoise: 1.5,   // ±1.5%
  },
  '7d': {
    Rmin: 8,       // 8%
    Vmin: 20,      // 20%
    Dmax: 12,      // 12%
    Rnoise: 4,     // ±4%
  },
  '30d': {
    Rmin: 15,      // 15%
    Vmin: 30,      // 30%
    Dmax: 20,      // 20%
    Rnoise: 7,     // ±7%
  },
};

// ==================== RESULT STRUCTURES ====================

export interface TrendHorizonResult {
  // Input metrics
  returnPct: number;
  maxDrawdownPct: number;
  volumeChangePct: number;
  
  // Classification
  label: TrendLabel;
  strength: number;        // 0..1 - how strong the signal
  isSignificant: boolean;  // passes threshold tests
  
  // Explainability
  notes: string[];         // why this label was assigned
}

export interface TrendFinal {
  label: TrendLabel;
  delay: DelayLabel;
  confidence: number;      // 0..100 (NOT engineConfidence)
  quality: number;         // 0..1 (data quality indicator)
}

// ==================== VALIDATION INPUT ====================

export interface TrendValidationInput {
  snapshotId: string;
  tokenAddress: string;
  horizons: {
    '1d'?: {
      returnPct: number;
      maxDrawdownPct: number;
      volumeChangePct: number;
    };
    '7d'?: {
      returnPct: number;
      maxDrawdownPct: number;
      volumeChangePct: number;
    };
    '30d'?: {
      returnPct: number;
      maxDrawdownPct: number;
      volumeChangePct: number;
    };
  };
}
