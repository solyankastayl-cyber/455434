/**
 * HORIZON META SERVICE — Core Calculation Engine
 * 
 * Implements:
 * 1. Divergence calculation (real vs predicted)
 * 2. Adaptive similarity decay (confidence reduction)
 * 3. Horizon hierarchy weighting
 * 4. Consensus bias computation
 * 
 * CRITICAL INVARIANTS:
 * - NEVER modifies projection series
 * - Only affects confidence/weight
 * - Decay is clamped to [0.35, 1.0]
 * - Weights always sum to 1.0
 */

import type {
  HorizonKey,
  HorizonBias,
  HorizonMetaInput,
  HorizonMetaPack,
  HorizonDivergence,
  HorizonConsensus,
  ConsensusState,
} from './horizon_meta.contract.js';
import { loadHorizonMetaConfig, type HorizonMetaConfig } from './horizon_meta.config.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function round(x: number, decimals: number): number {
  const mult = Math.pow(10, decimals);
  return Math.round(x * mult) / mult;
}

/**
 * Convert close prices to log returns
 * r[i] = ln(close[i] / close[i-1])
 */
function logReturnsFromCloses(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    } else {
      returns.push(0);
    }
  }
  return returns;
}

/**
 * Build predicted close prices from cumulative returns
 * predClose[t] = spotCloseAsOf * (1 + cumReturn[t])
 */
function buildPredCloses(
  input: HorizonMetaInput,
  horizon: HorizonKey
): number[] {
  const series = input.predSeriesByHorizon[horizon];
  if (!series || series.length === 0) return [];
  
  if (input.predSeriesType === 'close') {
    return series;
  }
  
  // cumReturn: series[t] = cumulative return at t (starting from 0 at t=0)
  return series.map(cr => input.spotCloseAsOf * (1 + cr));
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class HorizonMetaService {
  private config: HorizonMetaConfig;
  
  constructor(config?: HorizonMetaConfig) {
    this.config = config || loadHorizonMetaConfig();
  }
  
  /**
   * Main computation: divergence + decay + consensus
   */
  compute(input: HorizonMetaInput): HorizonMetaPack {
    const cfg = this.config;
    
    // Feature flag check
    if (!cfg.enabled) {
      return { enabled: false, mode: cfg.mode };
    }
    
    const horizons: HorizonKey[] = [30, 90, 180, 365];
    const divergences: HorizonDivergence[] = [];
    const confAdj: Record<HorizonKey, number> = { 30: 0, 90: 0, 180: 0, 365: 0 };
    
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Calculate divergence and decay per horizon
    // ═══════════════════════════════════════════════════════════
    
    for (const H of horizons) {
      const baseConf = input.baseConfidenceByHorizon[H] ?? 0;
      const stability = input.stabilityByHorizon?.[H] ?? 1.0;
      
      let decay = 1.0;
      let div = 0;
      let excess = 0;
      const k = cfg.kWindowByHorizon[H];
      const thr = cfg.thrByHorizon[H];
      const lambda = cfg.lambdaByHorizon[H];
      
      // Calculate divergence only if we have realized data
      if (input.realizedClosesAfterAsOf && input.realizedClosesAfterAsOf.length >= k + 1) {
        const realCloses = input.realizedClosesAfterAsOf.slice(0, k + 1);
        const predCloses = buildPredCloses(input, H).slice(0, k + 1);
        
        if (predCloses.length >= k + 1) {
          const realReturns = logReturnsFromCloses(realCloses);
          const predReturns = logReturnsFromCloses(predCloses);
          
          const n = Math.min(realReturns.length, predReturns.length);
          if (n > 0) {
            // Mean absolute return error
            let sumAbsErr = 0;
            for (let i = 0; i < n; i++) {
              sumAbsErr += Math.abs(realReturns[i] - predReturns[i]);
            }
            div = sumAbsErr / n;
            
            // Calculate excess and decay
            excess = Math.max(0, (div - thr) / thr);
            decay = Math.exp(-lambda * excess);
            decay = clamp(decay, cfg.decayMin, cfg.decayMax);
            
            divergences.push({
              horizon: H,
              k,
              div: round(div, 6),
              thr,
              excess: round(excess, 4),
              decay: round(decay, 4),
              adjustedConfidence: round(clamp(baseConf * decay * stability, 0, 1), 4),
            });
          }
        }
      }
      
      // Store adjusted confidence (even without divergence data)
      confAdj[H] = clamp(baseConf * decay * stability, 0, 1);
    }
    
    // ═══════════════════════════════════════════════════════════
    // STEP 2: Compute effective weights
    // ═══════════════════════════════════════════════════════════
    
    const weightsEff: Record<HorizonKey, number> = { 30: 0, 90: 0, 180: 0, 365: 0 };
    let sumW = 0;
    
    for (const H of horizons) {
      // Weight = base weight * adjusted confidence
      const w = cfg.weightsBase[H] * Math.max(confAdj[H], 0.001);
      weightsEff[H] = w;
      sumW += w;
    }
    
    // Normalize to sum = 1
    if (sumW > 0) {
      for (const H of horizons) {
        weightsEff[H] = round(weightsEff[H] / sumW, 4);
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // STEP 3: Calculate consensus bias
    // ═══════════════════════════════════════════════════════════
    
    let consensusBias = 0;
    for (const H of horizons) {
      const bias = input.biasByHorizon[H] ?? 0;
      consensusBias += weightsEff[H] * bias;
    }
    
    // Determine state
    const th = cfg.consensusThreshold;
    let consensusState: ConsensusState;
    if (consensusBias > th) {
      consensusState = 'BULLISH';
    } else if (consensusBias < -th) {
      consensusState = 'BEARISH';
    } else {
      consensusState = 'HOLD';
    }
    
    // Build reasons
    const reasons: string[] = [];
    reasons.push(
      `weights: 365D=${(weightsEff[365] * 100).toFixed(1)}% ` +
      `180D=${(weightsEff[180] * 100).toFixed(1)}% ` +
      `90D=${(weightsEff[90] * 100).toFixed(1)}% ` +
      `30D=${(weightsEff[30] * 100).toFixed(1)}%`
    );
    reasons.push(`consensusBias=${round(consensusBias, 3)} → ${consensusState}`);
    
    // Add divergence warnings
    for (const d of divergences) {
      if (d.decay < 0.7) {
        reasons.push(`${d.horizon}D confidence reduced (decay=${d.decay.toFixed(2)}, div=${(d.div * 100).toFixed(2)}%)`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // BUILD OUTPUT
    // ═══════════════════════════════════════════════════════════
    
    const consensus: HorizonConsensus = {
      weightsBase: { ...cfg.weightsBase },
      weightsEff,
      consensusBias: round(consensusBias, 4),
      consensusState,
      reasons,
    };
    
    return {
      enabled: true,
      mode: cfg.mode,
      divergences: divergences.length > 0 ? divergences : undefined,
      consensus,
      computedAt: new Date().toISOString(),
    };
  }
  
  /**
   * Get consensus state for header (if mode === 'on')
   */
  getHeaderOverride(pack: HorizonMetaPack): {
    shouldOverride: boolean;
    marketState?: ConsensusState;
    confidence?: number;
  } {
    if (!pack.enabled || pack.mode !== 'on' || !pack.consensus) {
      return { shouldOverride: false };
    }
    
    // Calculate average adjusted confidence
    let avgConf = 0;
    const horizons: HorizonKey[] = [30, 90, 180, 365];
    for (const H of horizons) {
      avgConf += pack.consensus.weightsEff[H] * 100; // Convert to percentage contribution
    }
    
    return {
      shouldOverride: true,
      marketState: pack.consensus.consensusState,
      confidence: Math.round(avgConf * 100), // Scale to 0-100
    };
  }
  
  /**
   * Update config at runtime (for testing/calibration)
   */
  updateConfig(partial: Partial<HorizonMetaConfig>): void {
    this.config = { ...this.config, ...partial };
  }
  
  /**
   * Get current config (for debugging)
   */
  getConfig(): HorizonMetaConfig {
    return { ...this.config };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let _instance: HorizonMetaService | null = null;

export function getHorizonMetaService(): HorizonMetaService {
  if (!_instance) {
    _instance = new HorizonMetaService();
  }
  return _instance;
}

export function resetHorizonMetaService(): void {
  _instance = null;
}
