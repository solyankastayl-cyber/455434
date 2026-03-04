/**
 * MACRO ENGINE V1 — Linear Macro Adjustment (Baseline)
 * 
 * This is the stable, production-proven engine.
 * V1 = scoreSigned × kappa × regimeBoost × confidence
 * 
 * DO NOT modify this engine for experiments.
 * Use V2 for new features.
 */

import {
  IMacroEngine,
  MacroPack,
  MacroRegime,
  MacroDriverComponent,
  MacroHorizon,
  MacroPathPoint,
  HorizonOverlay,
} from '../interfaces/macro_engine.interface.js';
import { computeMacroScore } from '../../dxy-macro-core/services/macro_score.service.js';

// ═══════════════════════════════════════════════════════════════
// V1 CONSTANTS (frozen baseline)
// ═══════════════════════════════════════════════════════════════

const V1_KAPPA = 0.05;  // Base adjustment coefficient

const V1_REGIME_BOOSTS: Record<MacroRegime, number> = {
  'EASING': 1.0,
  'TIGHTENING': 1.2,
  'STRESS': 1.5,
  'NEUTRAL': 0.8,
  'NEUTRAL_MIXED': 0.9,
  'RISK_ON': 1.1,
  'RISK_OFF': 1.3,
};

const V1_HORIZON_SCALE: Record<MacroHorizon, number> = {
  '7D': 0.3,
  '14D': 0.5,
  '30D': 1.0,
  '90D': 1.5,
  '180D': 2.0,
  '365D': 2.5,
};

// ═══════════════════════════════════════════════════════════════
// V1 ENGINE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class MacroEngineV1 implements IMacroEngine {
  version = 'v1' as const;
  
  private cachedScore: any = null;
  private cacheTimestamp: number = 0;
  private CACHE_TTL_MS = 60000; // 1 minute
  
  async computePack(params: {
    asset: 'DXY' | 'SPX' | 'BTC';
    horizon: MacroHorizon;
    hybridEndReturn: number;
    hybridPath?: MacroPathPoint[];
  }): Promise<MacroPack> {
    const startTime = Date.now();
    
    // Get macro score (with caching)
    const score = await this.getCachedScore();
    
    // Extract values
    const scoreSigned = score.scoreSigned || 0;
    const confidence = this.parseConfidence(score.confidence);
    const dominantRegime = this.parseRegime(score.summary?.dominantRegime);
    
    // V1 Linear formula
    const regimeBoost = V1_REGIME_BOOSTS[dominantRegime] || 1.0;
    const horizonScale = V1_HORIZON_SCALE[params.horizon] || 1.0;
    
    const rawAdjustment = scoreSigned * V1_KAPPA * regimeBoost * confidence * horizonScale;
    const macroEndReturn = params.hybridEndReturn + rawAdjustment;
    
    // Build overlay for all horizons
    const horizons: HorizonOverlay[] = Object.keys(V1_HORIZON_SCALE).map(h => {
      const hScale = V1_HORIZON_SCALE[h as MacroHorizon];
      const hAdjust = scoreSigned * V1_KAPPA * regimeBoost * confidence * hScale;
      return {
        horizon: h as MacroHorizon,
        hybridEndReturn: params.hybridEndReturn,
        macroEndReturn: params.hybridEndReturn + hAdjust,
        delta: hAdjust,
      };
    });
    
    // Build drivers from components
    const drivers = await this.getDrivers();
    
    // Build regime probs (V1 uses deterministic thresholds)
    const probs = this.buildRegimeProbs(scoreSigned, dominantRegime);
    
    // Build guard
    const guard = this.buildGuard(dominantRegime, scoreSigned);
    
    // Build data coverage
    const dataCoverage = this.buildDataCoverage(score);
    
    return {
      engineVersion: 'v1',
      
      overlay: { horizons },
      
      regime: {
        dominant: dominantRegime,
        confidence,
        probs,
      },
      
      drivers: {
        scoreSigned,
        confidenceMultiplier: confidence,
        regimeBoost,
        components: drivers,
      },
      
      guard,
      
      meta: {
        asOf: new Date().toISOString(),
        dataCoverage,
        processingTimeMs: Date.now() - startTime,
      },
      
      internals: {
        v1: {
          kappa: V1_KAPPA,
          boost: regimeBoost,
          rawAdjustment,
        },
      },
    };
  }
  
  async getRegimeState(): Promise<{
    regime: MacroRegime;
    confidence: number;
    probs: Record<MacroRegime, number>;
  }> {
    const score = await this.getCachedScore();
    const dominantRegime = this.parseRegime(score.summary?.dominantRegime);
    const confidence = this.parseConfidence(score.confidence);
    const probs = this.buildRegimeProbs(score.scoreSigned, dominantRegime);
    
    return { regime: dominantRegime, confidence, probs };
  }
  
  async getDrivers(): Promise<MacroDriverComponent[]> {
    const score = await this.getCachedScore();
    
    if (!score.components) return [];
    
    return score.components.map((c: any) => ({
      key: c.seriesId,
      displayName: c.displayName || c.seriesId,
      role: c.role || 'rates',
      weight: c.weight || 0.1,
      lagDays: 30, // V1 doesn't track lag
      valueNow: c.normalizedPressure || 0,
      contribution: c.rawPressure || 0,
      tooltip: `${c.displayName}: ${c.regime} (${((c.rawPressure || 0) * 100).toFixed(1)}%)`,
    }));
  }
  
  async healthCheck(): Promise<{ ok: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    try {
      const score = await this.getCachedScore();
      
      if (!score.components || score.components.length === 0) {
        issues.push('No macro components loaded');
      }
      
      if (score.quality?.staleCount > 3) {
        issues.push(`${score.quality.staleCount} stale series`);
      }
      
    } catch (e) {
      issues.push(`Score computation failed: ${(e as any).message}`);
    }
    
    return { ok: issues.length === 0, issues };
  }
  
  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────
  
  private async getCachedScore(): Promise<any> {
    const now = Date.now();
    if (this.cachedScore && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cachedScore;
    }
    
    this.cachedScore = await computeMacroScore();
    this.cacheTimestamp = now;
    return this.cachedScore;
  }
  
  private parseConfidence(conf: string | number): number {
    if (typeof conf === 'number') return conf;
    if (conf === 'HIGH') return 0.9;
    if (conf === 'MEDIUM') return 0.7;
    return 0.4;
  }
  
  private parseRegime(regime?: string): MacroRegime {
    const valid: MacroRegime[] = ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL', 'NEUTRAL_MIXED', 'RISK_ON', 'RISK_OFF'];
    if (regime && valid.includes(regime as MacroRegime)) {
      return regime as MacroRegime;
    }
    return 'NEUTRAL';
  }
  
  private buildRegimeProbs(scoreSigned: number, dominant: MacroRegime): Record<MacroRegime, number> {
    // V1 uses simple threshold-based probabilities
    const base: Record<MacroRegime, number> = {
      'EASING': 0.1,
      'TIGHTENING': 0.1,
      'STRESS': 0.05,
      'NEUTRAL': 0.4,
      'NEUTRAL_MIXED': 0.25,
      'RISK_ON': 0.05,
      'RISK_OFF': 0.05,
    };
    
    // Boost dominant
    base[dominant] = 0.6;
    
    // Normalize
    const total = Object.values(base).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(base)) {
      base[k as MacroRegime] = Math.round((base[k as MacroRegime] / total) * 1000) / 1000;
    }
    
    return base;
  }
  
  private buildGuard(regime: MacroRegime, scoreSigned: number): { level: 'NONE' | 'SOFT' | 'HARD'; reasonCodes: string[] } {
    const reasonCodes: string[] = [];
    let level: 'NONE' | 'SOFT' | 'HARD' = 'NONE';
    
    if (regime === 'STRESS') {
      level = 'HARD';
      reasonCodes.push('STRESS_REGIME');
    } else if (Math.abs(scoreSigned) > 0.5) {
      level = 'SOFT';
      reasonCodes.push('HIGH_MACRO_PRESSURE');
    }
    
    return { level, reasonCodes };
  }
  
  private buildDataCoverage(score: any): Record<string, { points: number; from: string; to: string; staleDays?: number }> {
    const coverage: Record<string, { points: number; from: string; to: string; staleDays?: number }> = {};
    
    if (score.components) {
      for (const c of score.components) {
        coverage[c.seriesId] = {
          points: c.dataPoints || 0,
          from: c.dataFrom || 'unknown',
          to: c.dataTo || 'unknown',
          staleDays: c.staleDays,
        };
      }
    }
    
    return coverage;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: MacroEngineV1 | null = null;

export function getMacroEngineV1(): MacroEngineV1 {
  if (!instance) {
    instance = new MacroEngineV1();
  }
  return instance;
}
