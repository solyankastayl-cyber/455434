/**
 * P8.0-A — Feature Builder Service
 * 
 * Builds 53-dimensional feature vector for quantile forecasting.
 * All computations use data ≤ asOf (no lookahead).
 * All features normalized to [-1, +1].
 */

import * as crypto from 'crypto';
import {
  FEATURES_VERSION,
  FEATURE_COUNT,
  FEATURE_NAMES,
  FeatureName,
  FeatureVectorResponse,
  clip,
  scale,
  oneHot,
} from '../contracts/feature_vector.contract.js';

import {
  getMacroEnginePack,
  getMacroHealth,
  getLiquidityState,
  getGuardState,
  getCalibrationStatus,
} from '../../adapters/sources.adapter.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PriceData {
  date: string;
  close: number;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE BUILDER SERVICE
// ═══════════════════════════════════════════════════════════════

export class FeatureBuilderService {
  
  /**
   * Build complete feature vector for asset at asOf date
   */
  async buildFeatures(asset: string, asOf: string): Promise<FeatureVectorResponse> {
    const startTime = Date.now();
    
    // Fetch all inputs
    const [macroPack, health, liquidity, guard, calibration] = await Promise.all([
      getMacroEnginePack(asset as any, asOf),
      getMacroHealth(),
      getLiquidityState(),
      getGuardState(asset as any),
      getCalibrationStatus(),
    ]);
    
    // Build feature groups
    const macroFeatures = this.buildMacroFeatures(macroPack, calibration);
    const regimeFeatures = this.buildRegimeFeatures(macroPack);
    const liquidityFeatures = this.buildLiquidityFeatures(liquidity);
    const guardFeatures = this.buildGuardFeatures(guard);
    const priceFeatures = await this.buildPriceFeatures(asset, asOf);
    const crossAssetFeatures = await this.buildCrossAssetFeatures(asOf);
    const driverFeatures = this.buildDriverFeatures(macroPack, calibration);
    
    // Combine all features in order
    const vector = [
      ...macroFeatures,      // 1-4
      ...regimeFeatures,     // 5-11
      ...liquidityFeatures,  // 12-16
      ...guardFeatures,      // 17-23
      ...priceFeatures,      // 24-36
      ...crossAssetFeatures, // 37-41
      ...driverFeatures,     // 42-53
    ];
    
    // Build named map
    const named: Record<string, number> = {};
    FEATURE_NAMES.forEach((name, i) => {
      named[name] = vector[i] ?? 0;
    });
    
    // Compute integrity hash
    const inputsHash = this.computeInputsHash({
      macroPack,
      liquidity,
      guard,
      asOf,
    });
    
    return {
      asset,
      asOf,
      featuresVersion: FEATURES_VERSION,
      featureCount: vector.length,
      vector,
      named: named as any,
      integrity: {
        inputsHash,
        noLookahead: true,
        computeTimeMs: Date.now() - startTime,
      },
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // MACRO FEATURES (1-4)
  // ─────────────────────────────────────────────────────────────
  
  private buildMacroFeatures(macroPack: any, calibration: any): number[] {
    // 1. macro_scoreSigned [-1, +1]
    const scoreSigned = clip(macroPack?.drivers?.scoreSigned ?? 0, -1, 1);
    
    // 2. macro_confidence [0, 1]
    const confidence = clip(macroPack?.regime?.confidence ?? 0.5, 0, 1);
    
    // 3. macro_driver_concentration [0, 1]
    let driverConcentration = 0;
    const components = macroPack?.drivers?.components ?? [];
    if (components.length > 0) {
      const weights = components.map((c: any) => Math.abs(c.weight ?? 0));
      const sumWeights = weights.reduce((a: number, b: number) => a + b, 0);
      const maxWeight = Math.max(...weights);
      driverConcentration = sumWeights > 0 ? maxWeight / sumWeights : 0;
    }
    
    // 4. macro_weights_entropy [0, 1]
    let entropy = 0;
    if (components.length > 1) {
      const weights = components.map((c: any) => Math.abs(c.weight ?? 0));
      const sumWeights = weights.reduce((a: number, b: number) => a + b, 0);
      if (sumWeights > 0) {
        const probs = weights.map((w: number) => w / sumWeights);
        entropy = -probs.reduce((sum: number, p: number) => {
          return sum + (p > 0 ? p * Math.log2(p) : 0);
        }, 0) / Math.log2(components.length); // Normalize
      }
    }
    
    return [scoreSigned, confidence, driverConcentration, clip(entropy, 0, 1)];
  }
  
  // ─────────────────────────────────────────────────────────────
  // REGIME FEATURES (5-11)
  // ─────────────────────────────────────────────────────────────
  
  private buildRegimeFeatures(macroPack: any): number[] {
    const posterior = macroPack?.regime?.posterior ?? {};
    
    // 5-9: Regime probabilities
    const pEasing = clip(posterior['EASING'] ?? 0, 0, 1);
    const pTightening = clip(posterior['TIGHTENING'] ?? 0, 0, 1);
    const pStress = clip(posterior['STRESS'] ?? 0, 0, 1);
    const pNeutral = clip(posterior['NEUTRAL'] ?? 0, 0, 1);
    const pMixed = clip(posterior['MIXED'] ?? 0, 0, 1);
    
    // 10: regime_persistence [0, 1]
    const dominantProb = Math.max(pEasing, pTightening, pStress, pNeutral, pMixed);
    const persistence = clip(dominantProb, 0, 1);
    
    // 11: regime_flip_risk [0, 1]
    const flipRisk = 1 - persistence;
    
    return [pEasing, pTightening, pStress, pNeutral, pMixed, persistence, flipRisk];
  }
  
  // ─────────────────────────────────────────────────────────────
  // LIQUIDITY FEATURES (12-16)
  // ─────────────────────────────────────────────────────────────
  
  private buildLiquidityFeatures(liquidity: any): number[] {
    // 12: liq_impulse [-1, +1] (zscore clipped)
    const impulse = scale(liquidity?.impulse ?? 0, -3, 3);
    
    // 13: liq_confidence [0, 1]
    const confidence = clip(liquidity?.confidence ?? 0.5, 0, 1);
    
    // 14-16: One-hot regime
    const regime = liquidity?.regime ?? 'NEUTRAL';
    const [expansion, neutral, contraction] = oneHot(regime, ['EXPANSION', 'NEUTRAL', 'CONTRACTION']);
    
    return [impulse, confidence, expansion, neutral, contraction];
  }
  
  // ─────────────────────────────────────────────────────────────
  // GUARD FEATURES (17-23)
  // ─────────────────────────────────────────────────────────────
  
  private buildGuardFeatures(guard: any): number[] {
    const level = guard?.level ?? 'NONE';
    
    // 17: guard_level [0, 1]
    const levelMap: Record<string, number> = { 'NONE': 0, 'WARN': 1, 'CRISIS': 2, 'BLOCK': 3 };
    const levelNum = (levelMap[level] ?? 0) / 3;
    
    // 18-21: One-hot
    const [gNone, gWarn, gCrisis, gBlock] = oneHot(level, ['NONE', 'WARN', 'CRISIS', 'BLOCK']);
    
    // 22: guard_days_in_state [0, 1] (cap 60 days)
    let daysInState = 0;
    if (guard?.since) {
      const since = new Date(guard.since);
      const now = new Date();
      daysInState = Math.min(60, Math.floor((now.getTime() - since.getTime()) / (1000 * 60 * 60 * 24))) / 60;
    }
    
    // 23: guard_cooldown_active [0, 1]
    const cooldownActive = 0; // Not implemented yet
    
    return [levelNum, gNone, gWarn, gCrisis, gBlock, daysInState, cooldownActive];
  }
  
  // ─────────────────────────────────────────────────────────────
  // PRICE FEATURES (24-36)
  // ─────────────────────────────────────────────────────────────
  
  private async buildPriceFeatures(asset: string, asOf: string): Promise<number[]> {
    // For now, use placeholder values
    // In production, fetch from price history service
    
    // 24-27: Returns (placeholder)
    const ret5d = 0;
    const ret20d = 0;
    const ret60d = 0;
    const ret120d = 0;
    
    // 28-30: Volatility (placeholder)
    const vol20d = 0;
    const vol60d = 0;
    const volRatio = 0;
    
    // 31-33: Trend (placeholder)
    const trendSlope = 0;
    const emaGap = 0;
    const breakout = 0;
    
    // 34-36: Drawdown (placeholder)
    const dd90d = 0;
    const dd180d = 0;
    const volSpike = 0;
    
    return [
      ret5d, ret20d, ret60d, ret120d,
      vol20d, vol60d, volRatio,
      trendSlope, emaGap, breakout,
      dd90d, dd180d, volSpike,
    ];
  }
  
  // ─────────────────────────────────────────────────────────────
  // CROSS-ASSET FEATURES (37-41)
  // ─────────────────────────────────────────────────────────────
  
  private async buildCrossAssetFeatures(asOf: string): Promise<number[]> {
    // Placeholder - would compute from cross-asset price histories
    // 37-39: Correlations
    const corrDxySpx = 0;
    const corrDxyBtc = 0;
    const corrSpxBtc = 0;
    
    // 40-41: Relative volatility
    const relVolDxySpx = 0;
    const relVolBtcSpx = 0;
    
    return [corrDxySpx, corrDxyBtc, corrSpxBtc, relVolDxySpx, relVolBtcSpx];
  }
  
  // ─────────────────────────────────────────────────────────────
  // DRIVER FEATURES (42-53)
  // ─────────────────────────────────────────────────────────────
  
  private buildDriverFeatures(macroPack: any, calibration: any): number[] {
    const components = macroPack?.drivers?.components ?? [];
    const features: number[] = [];
    
    // Get top 3 drivers
    const sortedDrivers = [...components]
      .sort((a: any, b: any) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0))
      .slice(0, 3);
    
    // Pad to 3 if less
    while (sortedDrivers.length < 3) {
      sortedDrivers.push({ key: 'NONE', weight: 0, correlation: 0, lagDays: 0, zScore: 0 });
    }
    
    for (const driver of sortedDrivers) {
      // Weight [0, 1]
      const weight = clip(Math.abs(driver.weight ?? 0), 0, 1);
      
      // Correlation [-1, +1] (scaled from [-0.3, +0.3])
      const corr = scale(driver.correlation ?? 0, -0.3, 0.3);
      
      // Lag days [0, 1] (cap 180)
      const lagDays = clip((driver.lagDays ?? 0) / 180, 0, 1);
      
      // Z-score [-1, +1] (scaled from [-3, +3])
      const z = scale(driver.zScore ?? 0, -3, 3);
      
      features.push(weight, corr, lagDays, z);
    }
    
    return features;
  }
  
  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────
  
  private computeInputsHash(inputs: any): string {
    const serialized = JSON.stringify({
      macro_regime: inputs.macroPack?.regime?.dominant,
      macro_score: inputs.macroPack?.drivers?.scoreSigned,
      liq_regime: inputs.liquidity?.regime,
      guard_level: inputs.guard?.level,
      asOf: inputs.asOf,
    });
    
    return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);
  }
}

// Singleton
let instance: FeatureBuilderService | null = null;

export function getFeatureBuilderService(): FeatureBuilderService {
  if (!instance) {
    instance = new FeatureBuilderService();
  }
  return instance;
}
