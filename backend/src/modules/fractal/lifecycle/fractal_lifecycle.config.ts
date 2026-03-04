/**
 * Fractal Auto-Learning Loop - Lifecycle Configuration
 * 
 * CAPITAL-CENTRIC lifecycle configuration for Fractal pattern matching module.
 * Adapted from Exchange module but with Fractal-specific horizons and thresholds.
 * 
 * Key: decisions based on PatternMatchRate, Drawdown, Stability
 * NOT on raw accuracy or drift.
 */

// Fractal uses different horizons than Exchange
export type FractalHorizon = '7D' | '14D' | '30D' | '60D';

// ═══════════════════════════════════════════════════════════════
// AUTO-PROMOTION CONFIG (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface HorizonPromotionConfig {
  // Minimum predictions for statistical significance
  minSamples: number;
  
  // Minimum improvement required
  minWinRateLift: number;      // 0.02 = +2% PatternMatchRate
  minSharpeLift: number;       // 0.10 = +0.10 Sharpe-like
  
  // Safety constraints for shadow
  maxDDForPromo: number;       // 0.15 = max 15% drawdown
  minStability: number;        // 0.55 = min stability score
  
  // Cooldowns
  cooldownDays: number;
  windowDays: number;          // evaluation window
}

export interface AutoPromotionConfig {
  horizons: Record<FractalHorizon, HorizonPromotionConfig>;
  global: {
    minDaysBetweenPromotions: number;
    minPredictionsSinceLastPromotion: number;
    evaluationIntervalHours: number;
  };
}

export const FRACTAL_AUTOPROMOTION_CONFIG: AutoPromotionConfig = {
  horizons: {
    '7D': {
      minSamples: 100,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.55,
      cooldownDays: 42,   // 6 weeks
      windowDays: 60,
    },
    '14D': {
      minSamples: 80,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.55,
      cooldownDays: 42,
      windowDays: 60,
    },
    '30D': {
      minSamples: 50,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.50,
      cooldownDays: 56,   // 8 weeks
      windowDays: 90,
    },
    '60D': {
      minSamples: 30,
      minWinRateLift: 0.02,
      minSharpeLift: 0.08,
      maxDDForPromo: 0.18,
      minStability: 0.45,
      cooldownDays: 70,   // 10 weeks
      windowDays: 120,
    },
  },
  global: {
    minDaysBetweenPromotions: 42,
    minPredictionsSinceLastPromotion: 80,
    evaluationIntervalHours: 6,
  },
};

// ═══════════════════════════════════════════════════════════════
// AUTO-ROLLBACK CONFIG (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface HorizonRollbackConfig {
  windowDays: number;          // evaluation window
  minSamples: number;          // minimum for decision
  
  // Thresholds for rollback (must meet MULTIPLE conditions)
  winRateFloor: number;        // 0.45 = below 45% PatternMatchRate
  maxDrawdownCeil: number;     // 0.12 = above 12% drawdown
  minStability: number;        // 0.50 = below this stability
  maxConsecutiveLosses: number; // 12 = consecutive losing predictions
}

export interface AutoRollbackConfig {
  horizons: Record<FractalHorizon, HorizonRollbackConfig>;
  global: {
    cooldownDays: number;
    evaluationIntervalHours: number;
    driftTriggersRollback: boolean;
  };
}

export const FRACTAL_AUTOROLLBACK_CONFIG: AutoRollbackConfig = {
  horizons: {
    '7D': {
      windowDays: 30,
      minSamples: 50,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.12,
      minStability: 0.50,
      maxConsecutiveLosses: 10,
    },
    '14D': {
      windowDays: 30,
      minSamples: 40,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.12,
      minStability: 0.50,
      maxConsecutiveLosses: 10,
    },
    '30D': {
      windowDays: 45,
      minSamples: 30,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.15,
      minStability: 0.45,
      maxConsecutiveLosses: 12,
    },
    '60D': {
      windowDays: 60,
      minSamples: 20,
      winRateFloor: 0.42,
      maxDrawdownCeil: 0.18,
      minStability: 0.42,
      maxConsecutiveLosses: 15,
    },
  },
  global: {
    cooldownDays: 14,
    evaluationIntervalHours: 3,
    driftTriggersRollback: false, // Drift does NOT trigger rollback
  },
};

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS CONFIG
// ═══════════════════════════════════════════════════════════════

export interface GuardrailsConfig {
  killSwitch: boolean;
  maxDailyRetrains: number;
  minRetrainIntervalMinutes: number;
  promotionLock: boolean;
  maxPortfolioExposure: number;
  maxVolatilityForPrediction: number;
}

export const FRACTAL_GUARDRAILS_CONFIG: GuardrailsConfig = {
  killSwitch: false,
  maxDailyRetrains: 2,
  minRetrainIntervalMinutes: 240,
  promotionLock: false,
  maxPortfolioExposure: 0.25,
  maxVolatilityForPrediction: 0.10,
};

// ═══════════════════════════════════════════════════════════════
// MODEL EVENT TYPES
// ═══════════════════════════════════════════════════════════════

export type FractalModelEventType = 
  | 'SHADOW_CREATED'
  | 'PROMOTED'
  | 'ROLLED_BACK'
  | 'RETRAINED'
  | 'FROZEN'
  | 'KILL_SWITCH_ON'
  | 'KILL_SWITCH_OFF'
  | 'PROMOTION_LOCK_ON'
  | 'PROMOTION_LOCK_OFF'
  | 'CONFIG_CHANGED'
  | 'CALIBRATION_UPDATED'
  | 'RELIABILITY_DEGRADED';

export interface FractalModelEvent {
  _id?: string;
  type: FractalModelEventType;
  horizon: FractalHorizon | 'GLOBAL';
  fromModelId?: string;
  toModelId?: string;
  reason?: string;
  meta?: Record<string, any>;
  timestamp: Date;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION CHECK RESULT (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface PromotionCheckResult {
  shouldPromote: boolean;
  reason: string;
  checks: {
    sampleCount: { passed: boolean; value: number; required: number };
    winRateLift: { passed: boolean; value: number; required: number };
    sharpeLift: { passed: boolean; value: number; required: number };
    shadowDrawdown: { passed: boolean; value: number; maxAllowed: number };
    shadowStability: { passed: boolean; value: number; minRequired: number };
    cooldown: { passed: boolean; daysSince: number; required: number };
  };
  activeWindow?: {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  };
  shadowWindow?: {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// ROLLBACK CHECK RESULT (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface RollbackCheckResult {
  shouldRollback: boolean;
  reason: string;
  severity: 'NONE' | 'WARNING' | 'CRITICAL';
  checks: {
    sampleCount: { sufficient: boolean; value: number; required: number };
    winRate: { triggered: boolean; value: number; floor: number };
    drawdown: { triggered: boolean; value: number; ceiling: number };
    stability: { triggered: boolean; value: number; floor: number };
    consecutiveLosses: { triggered: boolean; value: number; threshold: number };
    cooldown: { passed: boolean; daysSince: number; required: number };
  };
  currentWindow?: {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
    consecutiveLossMax: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// RETRAIN TRIGGER CONFIG (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface RetrainTriggerConfig {
  rolling30dWinRateFloor: number;
  winRateTrendNegative: boolean;
  minDaysBetweenRetrains: number;
  minPredictionsSinceLastRetrain: number;
}

export const FRACTAL_RETRAIN_TRIGGER_CONFIG: RetrainTriggerConfig = {
  rolling30dWinRateFloor: 0.48,
  winRateTrendNegative: true,
  minDaysBetweenRetrains: 14,
  minPredictionsSinceLastRetrain: 40,
};

// ═══════════════════════════════════════════════════════════════
// SUSTAINED LIFT CONFIG (Anti-Promotion Storm)
// ═══════════════════════════════════════════════════════════════

export const FRACTAL_SUSTAINED_LIFT_CONFIG = {
  SUSTAINED_WINDOWS: 3,
  WINDOW_DAYS: 14,
  MIN_WIN_RATE_LIFT: 0.02,
  MIN_SHARPE_LIFT: 0.05,
  MIN_PREDICTIONS_PER_WINDOW: 8,
  PROMOTION_COOLDOWN_DAYS: 42,
};

console.log('[Fractal ML] Lifecycle config loaded (Capital-Centric v1)');
