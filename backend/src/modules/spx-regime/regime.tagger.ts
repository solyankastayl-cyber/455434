/**
 * SPX REGIME ENGINE — Regime Tagger
 * 
 * BLOCK B6.11 + B6.13.1 — Deterministic regime classification rules
 * 
 * B6.13.1: TRANSITION Split into 4 subtypes:
 * - TRANSITION_VOL_UP: Vol expanding
 * - TRANSITION_VOL_DOWN: Vol contracting  
 * - TRANSITION_TREND_FLIP: SMA50 slope sign change
 * - TRANSITION_RANGE_BREAK: Range → Trend or vice versa
 * 
 * No ML, fully reproducible based on fixed thresholds.
 */

import { RegimeTag, VolBucket, TrendDir, REGIME_THRESHOLDS } from './regime.config.js';
import { RegimeFeatures } from './regime.features.js';

/**
 * Classify transition subtype (B6.13.1)
 */
function classifyTransitionSubtype(features: RegimeFeatures): RegimeTag {
  const { volExpanding, volContracting, trendFlipping, rangeBreaking, volBucket, volBucket5dAgo } = features;
  
  // Check for vol bucket transition (MED→HIGH or LOW→MED)
  const volBucketUp = (volBucket5dAgo === VolBucket.LOW && volBucket === VolBucket.MEDIUM) ||
                      (volBucket5dAgo === VolBucket.MEDIUM && volBucket === VolBucket.HIGH);
  const volBucketDown = (volBucket5dAgo === VolBucket.HIGH && volBucket === VolBucket.MEDIUM) ||
                        (volBucket5dAgo === VolBucket.MEDIUM && volBucket === VolBucket.LOW);
  
  // Priority order: Vol Up > Vol Down > Trend Flip > Range Break
  if (volExpanding && volBucketUp) {
    return RegimeTag.TRANSITION_VOL_UP;
  }
  
  if (volContracting && volBucketDown) {
    return RegimeTag.TRANSITION_VOL_DOWN;
  }
  
  if (trendFlipping) {
    return RegimeTag.TRANSITION_TREND_FLIP;
  }
  
  if (rangeBreaking) {
    return RegimeTag.TRANSITION_RANGE_BREAK;
  }
  
  // Fallback to generic transition
  return RegimeTag.TRANSITION;
}

/**
 * Classify regime based on features
 * 
 * Decision tree (deterministic):
 * 
 * 1. Check volatility bucket
 * 2. Check for special high-vol conditions (shock, V-shape, slow DD)
 * 3. B6.13.2: Apply Crisis Typology (FAST/SLOW + VSHAPE/NONV)
 * 4. Check trend direction
 * 5. For transitions, classify subtype (B6.13.1)
 * 6. Assign regime tag
 */
export function classifyRegime(features: RegimeFeatures): RegimeTag {
  const { volBucket, trendDir, maxDD60, ddSpeed, isShock, isVShape, trendPersistence30, crashSpeedBucket, reboundType } = features;
  
  // HIGH VOLATILITY regimes with B6.13.2 Crisis Typology
  if (volBucket === VolBucket.HIGH) {
    // B6.13.2: Fast shock with V-shape recovery (COVID-like, 2020s)
    if (isShock && crashSpeedBucket === 'FAST' && reboundType === 'VSHAPE') {
      return RegimeTag.HIGHVOL_FAST_SHOCK_VSHAPE;
    }
    
    // B6.13.2: Fast shock without V-shape recovery 
    if (isShock && crashSpeedBucket === 'FAST' && reboundType !== 'VSHAPE') {
      return RegimeTag.HIGHVOL_FAST_SHOCK_NONV;
    }
    
    // Legacy V-Shape (for compatibility)
    if (isVShape) {
      return RegimeTag.HIGHVOL_VSHAPE;
    }
    
    // Legacy Fast shock (for compatibility)
    if (isShock && ddSpeed >= REGIME_THRESHOLDS.DD_SPEED_FAST) {
      return RegimeTag.HIGHVOL_FAST_SHOCK;
    }
    
    // Slow drawdown (GFC-like, 2000s)
    if (maxDD60 <= REGIME_THRESHOLDS.DD_SEVERE && ddSpeed < REGIME_THRESHOLDS.DD_SPEED_FAST) {
      return RegimeTag.HIGHVOL_SLOW_DRAWDOWN;
    }
    
    // High vol recovery (after crisis)
    if (trendDir === TrendDir.UP && trendPersistence30 >= REGIME_THRESHOLDS.PERSISTENCE_HIGH) {
      return RegimeTag.HIGHVOL_RECOVERY;
    }
    
    // B6.13.1: Classify transition subtype
    return classifyTransitionSubtype(features);
  }
  
  // MEDIUM VOLATILITY regimes
  if (volBucket === VolBucket.MEDIUM) {
    if (trendDir === TrendDir.UP) {
      return RegimeTag.MEDVOL_TREND_UP;
    }
    if (trendDir === TrendDir.DOWN) {
      return RegimeTag.MEDVOL_TREND_DOWN;
    }
    return RegimeTag.MEDVOL_RANGE;
  }
  
  // LOW VOLATILITY regimes
  if (volBucket === VolBucket.LOW) {
    if (trendDir === TrendDir.UP) {
      return RegimeTag.LOWVOL_TREND_UP;
    }
    if (trendDir === TrendDir.DOWN) {
      return RegimeTag.LOWVOL_TREND_DOWN;
    }
    return RegimeTag.LOWVOL_RANGE;
  }
  
  // Fallback - classify transition subtype
  return classifyTransitionSubtype(features);
}

/**
 * Get regime description for UI
 */
export function getRegimeDescription(tag: RegimeTag): string {
  const descriptions: Record<RegimeTag, string> = {
    [RegimeTag.LOWVOL_TREND_UP]: 'Low volatility bull market',
    [RegimeTag.LOWVOL_TREND_DOWN]: 'Low volatility bear drift',
    [RegimeTag.LOWVOL_RANGE]: 'Low volatility sideways',
    [RegimeTag.MEDVOL_TREND_UP]: 'Medium volatility uptrend',
    [RegimeTag.MEDVOL_TREND_DOWN]: 'Medium volatility downtrend',
    [RegimeTag.MEDVOL_RANGE]: 'Medium volatility consolidation',
    // B6.13.2: Crisis Typology 2.0
    [RegimeTag.HIGHVOL_FAST_SHOCK_VSHAPE]: 'Fast shock + V-recovery (COVID-like, 2020s)',
    [RegimeTag.HIGHVOL_FAST_SHOCK_NONV]: 'Fast shock, no recovery (dangerous)',
    [RegimeTag.HIGHVOL_SLOW_DRAWDOWN]: 'Slow drawdown (GFC-like, 2000s)',
    [RegimeTag.HIGHVOL_FAST_SHOCK]: 'High vol fast shock (legacy)',
    [RegimeTag.HIGHVOL_VSHAPE]: 'High vol V-shape (legacy)',
    [RegimeTag.HIGHVOL_RECOVERY]: 'High vol recovery phase',
    // B6.13.1: TRANSITION subtypes
    [RegimeTag.TRANSITION_VOL_UP]: 'Vol expanding transition',
    [RegimeTag.TRANSITION_VOL_DOWN]: 'Vol contracting transition',
    [RegimeTag.TRANSITION_TREND_FLIP]: 'Trend flip transition',
    [RegimeTag.TRANSITION_RANGE_BREAK]: 'Range breakout transition',
    [RegimeTag.TRANSITION]: 'Regime transition',
  };
  return descriptions[tag] || 'Unknown regime';
}

/**
 * Get regime risk level for guardrails
 */
export function getRegimeRiskLevel(tag: RegimeTag): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
  const riskMap: Record<RegimeTag, 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'> = {
    [RegimeTag.LOWVOL_TREND_UP]: 'LOW',
    [RegimeTag.LOWVOL_TREND_DOWN]: 'MEDIUM',
    [RegimeTag.LOWVOL_RANGE]: 'LOW',
    [RegimeTag.MEDVOL_TREND_UP]: 'LOW',
    [RegimeTag.MEDVOL_TREND_DOWN]: 'MEDIUM',
    [RegimeTag.MEDVOL_RANGE]: 'LOW',
    // B6.13.2: Crisis Typology 2.0
    [RegimeTag.HIGHVOL_FAST_SHOCK_VSHAPE]: 'HIGH',      // Risky but recoverable
    [RegimeTag.HIGHVOL_FAST_SHOCK_NONV]: 'EXTREME',    // Most dangerous
    [RegimeTag.HIGHVOL_SLOW_DRAWDOWN]: 'HIGH',
    [RegimeTag.HIGHVOL_FAST_SHOCK]: 'EXTREME',
    [RegimeTag.HIGHVOL_VSHAPE]: 'HIGH',
    [RegimeTag.HIGHVOL_RECOVERY]: 'MEDIUM',
    // B6.13.1: TRANSITION subtypes
    [RegimeTag.TRANSITION_VOL_UP]: 'HIGH',
    [RegimeTag.TRANSITION_VOL_DOWN]: 'MEDIUM',
    [RegimeTag.TRANSITION_TREND_FLIP]: 'MEDIUM',
    [RegimeTag.TRANSITION_RANGE_BREAK]: 'MEDIUM',
    [RegimeTag.TRANSITION]: 'MEDIUM',
  };
  return riskMap[tag] || 'MEDIUM';
}

/**
 * Check if model is expected to work in this regime
 * Based on B6.12.2 matrix analysis + TRANSITION split findings
 */
export function isModelUsefulRegime(tag: RegimeTag): boolean {
  // Based on B6.12.2 Regime Matrix findings:
  // 
  // HIGH SKILL (+5%+):
  //   - TRANSITION_TREND_FLIP: +15% skill (but LOW confidence, n=47)
  //   - MEDVOL_TREND_UP: +7.5% skill (MEDIUM confidence)
  //
  // MODERATE SKILL (+2-5%):
  //   - MEDVOL_RANGE, TRANSITION_RANGE_BREAK, MEDVOL_TREND_DOWN
  //   - LOWVOL_RANGE, LOWVOL_TREND_DOWN
  //
  // NEGATIVE SKILL (model doesn't work):
  //   - HIGHVOL_SLOW_DRAWDOWN: -2.4% (model fails in GFC-like crises!)
  //   - LOWVOL_TREND_UP: -4% (overfit to bull market noise)
  //   - TRANSITION_VOL_UP: -2.9%
  //
  const usefulRegimes = [
    // High skill regimes
    RegimeTag.TRANSITION_TREND_FLIP,    // +15% but low samples
    RegimeTag.MEDVOL_TREND_UP,          // +7.5% with medium confidence
    // Moderate skill regimes
    RegimeTag.MEDVOL_RANGE,             // +3-6%
    RegimeTag.TRANSITION_RANGE_BREAK,   // +2.6%
    RegimeTag.MEDVOL_TREND_DOWN,        // +2-5%
    RegimeTag.LOWVOL_RANGE,             // +1.5%
    RegimeTag.LOWVOL_TREND_DOWN,        // Small positive
    // Recovery after crisis
    RegimeTag.HIGHVOL_RECOVERY,
  ];
  return usefulRegimes.includes(tag);
}

export default classifyRegime;
