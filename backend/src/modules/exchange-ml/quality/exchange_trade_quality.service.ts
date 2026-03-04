/**
 * Exchange Trade Quality Service
 * ================================
 * 
 * The CORE of the Trade Quality Layer.
 * 
 * v4.7.1: Added Smart Size Multiplier with Horizon/Regime/DD Guards
 * 
 * This is a rule-based filter that acts as a GATEKEEPER between the ML model
 * and actual trade execution. It doesn't improve the model — it filters
 * out low-quality trades that the model might suggest.
 * 
 * Philosophy:
 * - We CANNOT make the model predict better
 * - But we CAN choose NOT to trade when signals are weak
 * - Fewer bad trades > More accurate trades
 * 
 * Filters:
 * 1. Minimum confidence threshold (horizon-specific)
 * 2. Minimum edge probability (model must be confident in direction)
 * 3. Minimum ATR (avoid choppy/low-volatility markets)
 * 4. Environment state gating (IGNORE blocks, WARNING reduces size)
 * 5. Momentum confirmation bonus (volume spike + EMA alignment)
 * 6. NEW: Horizon enable/disable (1D/7D off, 30D on)
 * 7. NEW: CHOP regime gating
 * 8. NEW: Smart size scaling based on confidence/edge/horizon
 */

import { Horizon, QualityInput, QualityDecision } from '../perf/exchange_trade_types.js';
import { 
  EXCHANGE_TRADE_FLAGS, 
  calculateSmartSizeMultiplier,
  Regime
} from '../config/exchange_trade_flags.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (Calibrated for crypto daily trading)
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // Minimum adjusted confidence to trade
  minConf: {
    '1D': 0.55,   // 1D needs higher confidence (more noise)
    '7D': 0.52,
    '30D': 0.50,
  } as Record<Horizon, number>,
  
  // Minimum probability edge (max of probUp/probDown)
  minEdgeProb: {
    '1D': 0.58,   // Model must be 58%+ confident in direction
    '7D': 0.57,
    '30D': 0.56,
  } as Record<Horizon, number>,
  
  // Minimum ATR % to trade (avoid chop)
  minAtr: {
    '1D': 0.010,  // 1.0% min volatility
    '7D': 0.012,  // 1.2% min volatility
    '30D': 0.014, // 1.4% min volatility
  } as Record<Horizon, number>,
  
  // Volume spike threshold for momentum confirmation
  volSpikeThreshold: 1.6, // 60% above 20-day average
  
  // EMA cross threshold for trend confirmation
  emaCrossThreshold: 0.002, // 0.2% separation
  
  // WARNING mode position size multiplier
  warningSizeMultiplier: 0.35,
};

// ═══════════════════════════════════════════════════════════════
// QUALITY SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeTradeQualityService {
  
  /**
   * Decide whether to allow a trade and what size to use.
   * 
   * @param x - All available inputs for the decision
   * @returns Decision with allowTrade, sizeMultiplier, and reasons
   */
  decide(x: QualityInput & { regime?: Regime }): QualityDecision {
    const reasons: string[] = [];
    const regime = x.regime ?? 'UNKNOWN';

    // ═══════════════════════════════════════════════════════════════
    // v4.7.1: HORIZON ENABLE CHECK (first gate)
    // ═══════════════════════════════════════════════════════════════
    
    if (!EXCHANGE_TRADE_FLAGS.enabledByHorizon[x.horizon]) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: [`HORIZON_DISABLED:${x.horizon}`],
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // v4.7.1: CHOP REGIME HARD DISABLE
    // ═══════════════════════════════════════════════════════════════
    
    if (regime === 'CHOP' && EXCHANGE_TRADE_FLAGS.chopHardDisable) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: ['REGIME_DISABLED:CHOP'],
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // HARD BLOCKS (trade not allowed at all)
    // ═══════════════════════════════════════════════════════════════

    // 1. ENV=IGNORE is absolute block
    if (x.envState === 'IGNORE') {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: ['ENV_IGNORE: Market structure not readable'],
      };
    }

    // 2. Confidence too low
    if (x.confidence < THRESHOLDS.minConf[x.horizon]) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: [`CONF_TOO_LOW: ${(x.confidence * 100).toFixed(1)}% < ${(THRESHOLDS.minConf[x.horizon] * 100).toFixed(1)}%`],
      };
    }

    // 3. Direction edge too low
    const bestProb = Math.max(x.dirProbUp, x.dirProbDown);
    if (bestProb < THRESHOLDS.minEdgeProb[x.horizon]) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: [`DIR_EDGE_TOO_LOW: ${(bestProb * 100).toFixed(1)}% < ${(THRESHOLDS.minEdgeProb[x.horizon] * 100).toFixed(1)}%`],
      };
    }

    // 4. ATR too low (choppy market)
    const atr = x.atrPct ?? 0;
    if (atr > 0 && atr < THRESHOLDS.minAtr[x.horizon]) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: [`ATR_TOO_LOW_CHOP: ${(atr * 100).toFixed(2)}% < ${(THRESHOLDS.minAtr[x.horizon] * 100).toFixed(2)}%`],
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // v4.7.1: SMART SIZE MULTIPLIER (regime + confidence + edge + horizon)
    // ═══════════════════════════════════════════════════════════════
    
    const smartSize = calculateSmartSizeMultiplier({
      horizon: x.horizon,
      regime,
      confidence: x.confidence,
      edgeProb: bestProb,
      baseSize: 1.0,
    });
    
    // If smart size returns 0, it means a hard block
    if (smartSize.multiplier <= 0) {
      return {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: smartSize.reasons,
      };
    }
    
    let sizeMult = smartSize.multiplier;
    reasons.push(...smartSize.reasons);

    // ═══════════════════════════════════════════════════════════════
    // ADDITIONAL SIZE ADJUSTMENTS
    // ═══════════════════════════════════════════════════════════════

    // WARNING mode: allow trading but with reduced size
    if (x.envState === 'WARNING') {
      sizeMult *= THRESHOLDS.warningSizeMultiplier;
      reasons.push('ENV_WARNING: Size reduced to 35%');
    }

    // ═══════════════════════════════════════════════════════════════
    // BONUS MULTIPLIERS (momentum confirmation)
    // ═══════════════════════════════════════════════════════════════

    const vs = x.volSpike20 ?? 1;
    const ema = Math.abs(x.emaCrossDist ?? 0);

    // Volume spike + EMA trend alignment = momentum confirmation
    if (vs > THRESHOLDS.volSpikeThreshold && ema > THRESHOLDS.emaCrossThreshold) {
      // Increase size by 15% (but cap at 1.0)
      sizeMult = Math.min(1.0, sizeMult * 1.15);
      reasons.push(`MOMENTUM_CONFIRM: Vol spike ${vs.toFixed(2)}x + EMA dist ${(ema * 100).toFixed(2)}%`);
    }

    // Strong EMA alignment alone
    if (ema > 0.005) {
      sizeMult = Math.min(1.0, sizeMult * 1.05);
      reasons.push(`TREND_ALIGNED: Strong EMA separation ${(ema * 100).toFixed(2)}%`);
    }

    // VWAP alignment (institutional anchor)
    const vwapDist = Math.abs(x.distToVWAP7 ?? 0);
    if (vwapDist < 0.01) {
      // Price near VWAP = institutional interest zone
      sizeMult = Math.min(1.0, sizeMult * 1.05);
      reasons.push('VWAP_ALIGNED: Near weekly VWAP');
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL DECISION
    // ═══════════════════════════════════════════════════════════════

    if (reasons.length === 0) {
      reasons.push('STANDARD_TRADE: All conditions met');
    }

    return {
      allowTrade: true,
      sizeMultiplier: sizeMult,
      reasons,
    };
  }

  /**
   * Get a human-readable summary of the current thresholds.
   */
  getThresholdsSummary(): string {
    return [
      `Min Confidence: 1D=${THRESHOLDS.minConf['1D']}, 7D=${THRESHOLDS.minConf['7D']}, 30D=${THRESHOLDS.minConf['30D']}`,
      `Min Edge Prob: 1D=${THRESHOLDS.minEdgeProb['1D']}, 7D=${THRESHOLDS.minEdgeProb['7D']}, 30D=${THRESHOLDS.minEdgeProb['30D']}`,
      `Min ATR: 1D=${THRESHOLDS.minAtr['1D']}, 7D=${THRESHOLDS.minAtr['7D']}, 30D=${THRESHOLDS.minAtr['30D']}`,
      `Vol Spike Bonus: >${THRESHOLDS.volSpikeThreshold}x`,
      `EMA Cross Bonus: >${THRESHOLDS.emaCrossThreshold * 100}%`,
    ].join('\n');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let instance: ExchangeTradeQualityService | null = null;

export function getExchangeTradeQualityService(): ExchangeTradeQualityService {
  if (!instance) {
    instance = new ExchangeTradeQualityService();
  }
  return instance;
}

console.log('[Exchange ML] Trade quality service loaded');
