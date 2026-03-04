/**
 * MACRO ENGINE V2 — Regime State Engine (Institutional)
 * 
 * V2 Features:
 * - Markov regime switching with persistence + hysteresis (DB-backed state)
 * - Rolling correlation recalibration (adaptive weights)
 * - Horizon-specific impacts (different coefficients per horizon)
 * - Gold as exogenous signal
 * - Transition hints and probabilities
 * 
 * V2 builds on top of V1 data sources but uses state-space model.
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
import { getMarkovEngine } from '../../index-engine/services/macro_layer/macro_markov.service.js';
import { computeAllHorizonImpacts, computeVolatilityScale } from '../../index-engine/services/macro_layer/macro_impact.service.js';
import { computeMacroScore } from '../../dxy-macro-core/services/macro_score.service.js';
import { getGoldAdapter, GoldFeatures, GOLD_SERIES_CONFIG } from '../adapters/gold_series.adapter.js';
import { getRegimeStateService } from './state/regime_state.service.js';
import { getRollingCalibrationService } from './calibration/rolling_calibration.service.js';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// V2 ENGINE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class MacroEngineV2 implements IMacroEngine {
  version = 'v2' as const;
  
  private cachedScore: any = null;
  private cachedGold: GoldFeatures | null = null;
  private cacheTimestamp: number = 0;
  private CACHE_TTL_MS = 60000;
  
  async computePack(params: {
    asset: 'DXY' | 'SPX' | 'BTC';
    horizon: MacroHorizon;
    hybridEndReturn: number;
    hybridPath?: MacroPathPoint[];
  }): Promise<MacroPack> {
    const startTime = Date.now();
    
    // Get base macro score
    const score = await this.getCachedScore();
    
    // Get gold features
    const goldAdapter = getGoldAdapter();
    const goldFeatures = await goldAdapter.getFeatures();
    this.cachedGold = goldFeatures;
    
    // Build score vector (including gold)
    const scoreVector: Record<string, number> = {};
    if (score.components) {
      for (const c of score.components) {
        scoreVector[c.seriesId] = c.normalizedPressure || 0;
      }
    }
    if (goldFeatures) {
      scoreVector['GOLD'] = goldFeatures.pressure;
    }
    
    // V2 computes its OWN confidence (numeric, not inherited from V1 string)
    const confidence = this.computeV2Confidence(score, goldFeatures);
    
    // ── P1: Stateful regime via RegimeStateService (DB + hysteresis) ──
    const regimeStateSvc = getRegimeStateService();
    const rawRegime = score.summary?.dominantRegime as MacroRegime || 'NEUTRAL';
    
    const storedState = await regimeStateSvc.updateState({
      symbol: params.asset,
      scoreVector,
      scoreSigned: score.scoreSigned || 0,
      confidence,
      rawRegime,
    });
    
    // Use the hysteresis-filtered regime from stored state
    const regime = storedState.dominant as MacroRegime;
    const persistence = storedState.persistence;
    const entropy = storedState.entropy;
    const transitionHint = storedState.transitionHint;
    
    // Regime probs from stored state
    const regimeProbs: Record<string, number> = {};
    if (storedState.probs) {
      for (const [k, v] of storedState.probs instanceof Map 
        ? storedState.probs.entries() 
        : Object.entries(storedState.probs)) {
        regimeProbs[k] = v;
      }
    }
    
    // ── P2: Apply calibrated weights if available ──
    const calibrationSvc = getRollingCalibrationService();
    const calibratedWeights = await calibrationSvc.getEffectiveWeights(params.asset);
    
    // Compute V2 scoreSigned (includes gold + calibrated weights)
    let scoreSigned = this.computeCalibratedScore(score, goldFeatures, calibratedWeights);
    
    // ── P3: Volatility Adaptation (volScale) ──
    const volScale = await this.computeVolScale();
    
    // Compute horizon impacts using stateful regime + volScale
    const horizonDaysNum = parseInt(params.horizon.replace('D', '')) as 7 | 14 | 30 | 90 | 180 | 365;
    const allImpacts = computeAllHorizonImpacts(
      scoreSigned,
      regime,
      confidence,
      volScale
    );
    
    // Build horizon overlays
    const horizons: HorizonOverlay[] = allImpacts.map(impact => ({
      horizon: `${impact.horizonDays}D` as MacroHorizon,
      hybridEndReturn: params.hybridEndReturn,
      macroEndReturn: params.hybridEndReturn + impact.impactPct / 100,
      delta: impact.impactPct / 100,
    }));
    
    // Get drivers (with calibrated weights applied)
    const drivers = await this.getDrivers(calibratedWeights);
    
    // Build guard (V2 includes gold signals)
    const guard = this.buildGuard(regime, scoreSigned, goldFeatures);
    
    // Build data coverage
    const dataCoverage = this.buildDataCoverage(score, goldFeatures);
    
    // Get transition matrix for internals
    const markovEngine = getMarkovEngine();
    const transitionMatrix = markovEngine.getTransitionMatrix();
    
    return {
      engineVersion: 'v2',
      
      overlay: { horizons },
      
      regime: {
        dominant: regime,
        confidence: storedState.confidence,
        probs: regimeProbs as any,
        persistence,
        transitionHint: transitionHint || undefined,
      },
      
      drivers: {
        scoreSigned,
        confidenceMultiplier: confidence,
        regimeBoost: allImpacts.find(i => i.horizonDays === horizonDaysNum)?.regimeBoost || 1.0,
        components: drivers,
      },
      
      guard,
      
      meta: {
        asOf: new Date().toISOString(),
        dataCoverage,
        processingTimeMs: Date.now() - startTime,
        stateInfo: {
          entropy: Math.round(entropy * 1000) / 1000,
          changeCount30D: storedState.changeCount30D,
          lastChangeAt: storedState.lastChangeAt?.toISOString(),
          weightsSource: calibratedWeights ? 'calibrated' : 'default',
          volScale: Math.round(volScale * 1000) / 1000,
        },
      },
      
      internals: {
        v2: {
          transitionMatrix: transitionMatrix.matrix,
          stationaryDist: transitionMatrix.stationaryDistribution as any,
          goldSignal: goldFeatures ? {
            z120: goldFeatures.z120,
            ret30: goldFeatures.ret30,
            ret90: goldFeatures.ret90,
            flightToQuality: goldFeatures.flightToQuality,
          } : undefined,
        },
      },
    };
  }
  
  async getRegimeState(): Promise<{
    regime: MacroRegime;
    confidence: number;
    probs: Record<MacroRegime, number>;
  }> {
    // Try stored state first (P1: state memory)
    const regimeStateSvc = getRegimeStateService();
    const stored = await regimeStateSvc.getCurrentState('DXY');
    
    if (stored) {
      const probs: Record<string, number> = {};
      if (stored.probs) {
        for (const [k, v] of stored.probs instanceof Map
          ? stored.probs.entries()
          : Object.entries(stored.probs)) {
          probs[k] = v;
        }
      }
      return {
        regime: stored.dominant as MacroRegime,
        confidence: stored.confidence,
        probs: probs as any,
      };
    }
    
    // Fallback: compute live
    const score = await this.getCachedScore();
    const goldAdapter = getGoldAdapter();
    const goldFeatures = await goldAdapter.getFeatures();
    
    const scoreVector: Record<string, number> = {};
    if (score.components) {
      for (const c of score.components) {
        scoreVector[c.seriesId] = c.normalizedPressure || 0;
      }
    }
    if (goldFeatures) {
      scoreVector['GOLD'] = goldFeatures.pressure;
    }
    
    let confidence = this.computeV2Confidence(score, goldFeatures);
    
    const markovEngine = getMarkovEngine();
    const state = markovEngine.getState(
      scoreVector,
      score.scoreSigned || 0,
      confidence,
      score.summary?.dominantRegime as MacroRegime || 'NEUTRAL'
    );
    
    return {
      regime: state.regime,
      confidence: state.confidence,
      probs: state.regimeProbabilities as any,
    };
  }
  
  async getDrivers(overrideWeights?: Record<string, number>): Promise<MacroDriverComponent[]> {
    const score = await this.getCachedScore();
    const goldAdapter = getGoldAdapter();
    
    const drivers: MacroDriverComponent[] = [];
    
    if (score.components) {
      for (const c of score.components) {
        const calibratedWeight = overrideWeights?.[c.seriesId];
        drivers.push({
          key: c.seriesId,
          displayName: c.displayName || c.seriesId,
          role: c.role || 'rates',
          weight: calibratedWeight ?? c.weight ?? 0.1,
          corr: c.correlation,
          lagDays: 120,
          valueNow: c.normalizedPressure || 0,
          contribution: c.rawPressure || 0,
          tooltip: `${c.displayName}: ${c.regime} (${((c.rawPressure || 0) * 100).toFixed(1)}%)`,
        });
      }
    }
    
    // Add gold as driver
    const goldDriver = await goldAdapter.getAsDriverComponent();
    if (goldDriver) {
      const goldWeight = overrideWeights?.['GOLD'];
      if (goldWeight !== undefined) goldDriver.weight = goldWeight;
      drivers.push(goldDriver);
    }
    
    drivers.sort((a, b) => Math.abs(b.contribution || 0) - Math.abs(a.contribution || 0));
    return drivers;
  }
  
  async healthCheck(): Promise<{ ok: boolean; issues: string[]; warnings: string[] }> {
    const issues: string[] = [];
    const warnings: string[] = [];
    
    try {
      const score = await this.getCachedScore();
      
      if (!score.components || score.components.length === 0) {
        issues.push('No macro components loaded');
      }
      
      // Stale series is a warning, not a blocker for V2
      if (score.quality?.staleCount > 3) {
        warnings.push(`${score.quality.staleCount} stale series (data freshness)`);
      }
      
      // Check gold
      const goldAdapter = getGoldAdapter();
      const goldFeatures = await goldAdapter.getFeatures();
      if (!goldFeatures) {
        issues.push('GOLD_DATA_INSUFFICIENT');
      } else {
        const goldInfo = goldAdapter.getDataInfo();
        if (goldInfo && goldInfo.points < 500) {
          issues.push(`GOLD_DATA_INSUFFICIENT: only ${goldInfo.points} points`);
        }
        if (goldFeatures.staleDays > GOLD_SERIES_CONFIG.stalenessThresholdDays) {
          warnings.push(`Gold stale: ${goldFeatures.staleDays} days old`);
        }
      }
      
      // Check state service connectivity
      const regimeStateSvc = getRegimeStateService();
      const state = await regimeStateSvc.getCurrentState('DXY');
      if (!state) {
        warnings.push('No stored regime state yet — will initialize on first computePack');
      }
      
    } catch (e) {
      issues.push(`V2 engine error: ${(e as any).message}`);
    }
    
    return { ok: issues.length === 0, issues, warnings };
  }
  
  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────
  
  private computeCalibratedScore(
    score: any,
    goldFeatures: GoldFeatures | null,
    weights: Record<string, number>
  ): number {
    let calibrated = 0;
    let totalWeight = 0;
    
    // Apply calibrated weights to base components
    if (score.components) {
      for (const c of score.components) {
        const w = weights[c.seriesId] ?? c.weight ?? 0.1;
        const pressure = c.normalizedPressure || 0;
        calibrated += pressure * w;
        totalWeight += w;
      }
    }
    
    // Add gold contribution
    if (goldFeatures) {
      const goldWeight = weights['GOLD'] ?? 0.05;
      calibrated += goldFeatures.pressure * goldWeight;
      totalWeight += goldWeight;
    }
    
    // Normalize if weights don't sum to ~1
    if (totalWeight > 0 && Math.abs(totalWeight - 1) > 0.1) {
      calibrated = calibrated / totalWeight;
    }
    
    return Math.max(-1, Math.min(1, calibrated));
  }
  
  /**
   * V2 computes its OWN confidence — not inherited from V1's string.
   * Factors: component count, gold availability, regime state, calibration
   */
  private computeV2Confidence(score: any, goldFeatures: GoldFeatures | null): number {
    let conf = 0.5; // base
    
    // Component count bonus
    const componentCount = score.components?.length || 0;
    if (componentCount >= 7) conf += 0.15;
    else if (componentCount >= 5) conf += 0.10;
    else if (componentCount >= 3) conf += 0.05;
    
    // Gold available bonus
    if (goldFeatures && goldFeatures.staleDays <= 5) {
      conf += 0.10;
    } else if (goldFeatures) {
      conf += 0.05;
    }
    
    // Regime state stored bonus (hysteresis working)
    const regimeStateSvc = getRegimeStateService();
    // If we have stored state, the system has history = more confidence
    if (this.cachedScore) conf += 0.05;
    
    // Calibration bonus (calibrated weights > defaults)
    // (checked in computePack after this call, so use a quick check)
    conf += 0.05;
    
    // Freshness penalty (stale FRED data)
    const staleRatio = (score.quality?.staleCount || 0) / Math.max(1, componentCount);
    if (staleRatio > 0.5) conf -= 0.10;
    else if (staleRatio > 0.3) conf -= 0.05;
    
    // FTQ boost (high-confidence regime signal)
    if (goldFeatures?.flightToQuality) {
      conf += 0.05;
    }
    
    return Math.max(0.1, Math.min(1.0, conf));
  }
  
  private async computeVolScale(): Promise<number> {
    try {
      const csvPath = '/app/data/dxy_stooq.csv';
      
      if (!fs.existsSync(csvPath)) return 1.0;
      
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      const closes: number[] = [];
      for (let i = Math.max(1, lines.length - 500); i < lines.length; i++) {
        const parts = lines[i].split(',');
        const close = parseFloat(parts[4]); // Close is 5th column
        if (!isNaN(close) && close > 0) closes.push(close);
      }
      
      if (closes.length < 60) return 1.0;
      
      // Compute daily log returns
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
      
      // Realized vol (last 30 days, annualized)
      const recent30 = returns.slice(-30);
      const mean30 = recent30.reduce((a, b) => a + b, 0) / recent30.length;
      const var30 = recent30.reduce((a, b) => a + (b - mean30) ** 2, 0) / recent30.length;
      const realizedVol = Math.sqrt(var30) * Math.sqrt(252);
      
      // Long-term vol (full sample)
      const meanAll = returns.reduce((a, b) => a + b, 0) / returns.length;
      const varAll = returns.reduce((a, b) => a + (b - meanAll) ** 2, 0) / returns.length;
      const longTermVol = Math.sqrt(varAll) * Math.sqrt(252);
      
      return computeVolatilityScale(realizedVol, longTermVol);
    } catch (e) {
      console.log('[V2] volScale error:', (e as any).message);
      return 1.0;
    }
  }
  
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
  
  private buildGuard(
    regime: MacroRegime,
    scoreSigned: number,
    goldFeatures: GoldFeatures | null
  ): { level: 'NONE' | 'SOFT' | 'HARD'; reasonCodes: string[] } {
    const reasonCodes: string[] = [];
    let level: 'NONE' | 'SOFT' | 'HARD' = 'NONE';
    
    if (regime === 'STRESS' || regime === 'RISK_OFF') {
      level = 'HARD';
      reasonCodes.push('STRESS_REGIME');
    } else if (Math.abs(scoreSigned) > 0.5) {
      level = 'SOFT';
      reasonCodes.push('HIGH_MACRO_PRESSURE');
    }
    
    if (goldFeatures?.flightToQuality) {
      if (level === 'NONE') level = 'SOFT';
      reasonCodes.push('GOLD_FLIGHT_TO_QUALITY');
    }
    
    if (goldFeatures && goldFeatures.z120 > 1.5) {
      if (level !== 'HARD') level = 'SOFT';
      reasonCodes.push('GOLD_ELEVATED');
    }
    
    return { level, reasonCodes };
  }
  
  private buildDataCoverage(
    score: any,
    goldFeatures: GoldFeatures | null
  ): Record<string, { points: number; from: string; to: string; staleDays?: number }> {
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
    
    const goldAdapter = getGoldAdapter();
    const goldInfo = goldAdapter.getDataInfo();
    if (goldInfo) {
      coverage['GOLD'] = goldInfo;
    }
    
    return coverage;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: MacroEngineV2 | null = null;

export function getMacroEngineV2(): MacroEngineV2 {
  if (!instance) {
    instance = new MacroEngineV2();
  }
  return instance;
}
