/**
 * Exchange Auto-Learning Loop - PR4/5/6: Configuration
 * 
 * CAPITAL-CENTRIC lifecycle configuration.
 * 
 * Key change: decisions based on TradeWinRate, Drawdown, Stability
 * NOT on raw accuracy or drift.
 * 
 * This eliminates the "Rollback Storm" problem.
 */

import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// AUTO-PROMOTION CONFIG (Capital-Centric)
// ═══════════════════════════════════════════════════════════════

export interface HorizonPromotionConfig {
  // Minimum trades for statistical significance
  minSamples: number;
  
  // Minimum improvement required
  minWinRateLift: number;      // 0.02 = +2% TradeWinRate
  minSharpeLift: number;       // 0.10 = +0.10 Sharpe-like
  
  // Safety constraints for shadow
  maxDDForPromo: number;       // 0.15 = max 15% drawdown
  minStability: number;        // 0.55 = min stability score
  
  // Cooldowns
  cooldownDays: number;
  windowDays: number;          // evaluation window
}

export interface AutoPromotionConfig {
  horizons: Record<ExchangeHorizon, HorizonPromotionConfig>;
  global: {
    minDaysBetweenPromotions: number;
    minTradesSinceLastPromotion: number;
    evaluationIntervalHours: number;
  };
}

export const AUTOPROMOTION_CONFIG: AutoPromotionConfig = {
  horizons: {
    '1D': {
      minSamples: 120,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.55,
      cooldownDays: 56,   // Increased from 7 to 56
      windowDays: 60,
    },
    '7D': {
      minSamples: 80,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.55,
      cooldownDays: 56,   // Increased from 7 to 56
      windowDays: 60,
    },
    '30D': {
      minSamples: 50,
      minWinRateLift: 0.02,
      minSharpeLift: 0.10,
      maxDDForPromo: 0.15,
      minStability: 0.50,
      cooldownDays: 56,   // Increased from 10 to 56
      windowDays: 90,
    },
  },
  global: {
    minDaysBetweenPromotions: 56,   // Increased from 21 to 56
    minTradesSinceLastPromotion: 100,
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
  winRateFloor: number;        // 0.45 = below 45% TradeWinRate
  maxDrawdownCeil: number;     // 0.12 = above 12% drawdown
  minStability: number;        // 0.50 = below this stability
  maxConsecutiveLosses: number; // 12 = consecutive losing trades
}

export interface AutoRollbackConfig {
  horizons: Record<ExchangeHorizon, HorizonRollbackConfig>;
  global: {
    // Rollback cooldown: prevents rollback storm
    cooldownDays: number;
    evaluationIntervalHours: number;
    
    // IMPORTANT: drift no longer triggers rollback directly!
    // Drift now only affects confidence, not lifecycle
    driftTriggersRollback: boolean;
  };
}

export const AUTOROLLBACK_CONFIG: AutoRollbackConfig = {
  horizons: {
    '1D': {
      windowDays: 30,
      minSamples: 60,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.12,
      minStability: 0.50,
      maxConsecutiveLosses: 12,
    },
    '7D': {
      windowDays: 30,
      minSamples: 50,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.12,
      minStability: 0.50,
      maxConsecutiveLosses: 12,
    },
    '30D': {
      windowDays: 30,
      minSamples: 40,
      winRateFloor: 0.45,
      maxDrawdownCeil: 0.15,
      minStability: 0.45,
      maxConsecutiveLosses: 15,
    },
  },
  global: {
    // KEY: Rollback cannot happen more than once per 14 days
    cooldownDays: 14,
    evaluationIntervalHours: 3,
    
    // CRITICAL: Drift does NOT trigger rollback anymore!
    driftTriggersRollback: false,
  },
};

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS CONFIG
// ═══════════════════════════════════════════════════════════════

export interface GuardrailsConfig {
  // Kill switch - stops all trading
  killSwitch: boolean;
  
  // Retrain throttle
  maxDailyRetrains: number;
  minRetrainIntervalMinutes: number;
  
  // Promotion lock
  promotionLock: boolean;
  
  // Exposure limits
  maxPortfolioExposure: number;  // 0.25 = 25%
  
  // Volatility block
  maxVolatilityForTrading: number;  // 0.08 = 8%
}

export const GUARDRAILS_CONFIG: GuardrailsConfig = {
  killSwitch: false,
  maxDailyRetrains: 2,
  minRetrainIntervalMinutes: 180,
  promotionLock: false,
  maxPortfolioExposure: 0.25,
  maxVolatilityForTrading: 0.08,
};

// ═══════════════════════════════════════════════════════════════
// MODEL EVENT TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelEventType = 
  | 'SHADOW_CREATED'
  | 'PROMOTED'
  | 'ROLLED_BACK'
  | 'RETRAINED'
  | 'FROZEN'
  | 'KILL_SWITCH_ON'
  | 'KILL_SWITCH_OFF'
  | 'PROMOTION_LOCK_ON'
  | 'PROMOTION_LOCK_OFF'
  | 'CONFIG_CHANGED';

export interface ModelEvent {
  _id?: string;
  type: ModelEventType;
  horizon: ExchangeHorizon | 'GLOBAL';
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
    // Sample size check
    sampleCount: { passed: boolean; value: number; required: number };
    
    // Capital metrics checks
    winRateLift: { passed: boolean; value: number; required: number };
    sharpeLift: { passed: boolean; value: number; required: number };
    
    // Safety checks
    shadowDrawdown: { passed: boolean; value: number; maxAllowed: number };
    shadowStability: { passed: boolean; value: number; minRequired: number };
    
    // Cooldown
    cooldown: { passed: boolean; daysSince: number; required: number };
  };
  
  // Performance windows for reference
  activeWindow?: {
    tradeWinRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  };
  shadowWindow?: {
    tradeWinRate: number;
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
    // Sample size check
    sampleCount: { sufficient: boolean; value: number; required: number };
    
    // Capital metrics checks
    winRate: { triggered: boolean; value: number; floor: number };
    drawdown: { triggered: boolean; value: number; ceiling: number };
    stability: { triggered: boolean; value: number; floor: number };
    consecutiveLosses: { triggered: boolean; value: number; threshold: number };
    
    // Cooldown (prevents rollback storm)
    cooldown: { passed: boolean; daysSince: number; required: number };
  };
  
  // Current performance window
  currentWindow?: {
    tradeWinRate: number;
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
  // Retrain when rolling 30d performance degrades
  rolling30dWinRateFloor: number;  // 0.48 = retrain if below
  winRateTrendNegative: boolean;   // retrain if trend is negative
  
  // Cooldowns
  minDaysBetweenRetrains: number;
  minTradesSinceLastRetrain: number;
}

export const RETRAIN_TRIGGER_CONFIG: RetrainTriggerConfig = {
  rolling30dWinRateFloor: 0.48,
  winRateTrendNegative: true,
  minDaysBetweenRetrains: 7,
  minTradesSinceLastRetrain: 50,
};

console.log('[Exchange ML] Lifecycle config loaded (Capital-Centric v2)');
