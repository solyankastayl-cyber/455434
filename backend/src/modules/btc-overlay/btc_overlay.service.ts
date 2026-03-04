/**
 * BTC OVERLAY SERVICE — SPX → BTC Influence Engine
 * 
 * Implements:
 * R_adj = R_btc + g × w × β × R_spx
 * 
 * Core logic:
 * 1. Calculate rolling beta/correlation between BTC and SPX
 * 2. Determine overlay weight from correlation stability
 * 3. Apply guard based on regime alignment
 * 4. Compute adjusted BTC forecast
 */

import type {
  HorizonKey,
  OverlayCoeffs,
  OverlayExplain,
  OverlayCoeffsResponse,
  OverlayAdjustedPathResponse,
  OverlayExplainResponse,
} from './btc_overlay.contract.js';
import { loadBtcOverlayConfig, type BtcOverlayConfig } from './btc_overlay.config.js';
import { getDb } from '../../db/mongodb.js';

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

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  const sx = std(x.slice(0, n));
  const sy = std(y.slice(0, n));
  
  if (sx === 0 || sy === 0) return 0;
  
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
  }
  cov /= n - 1;
  
  return clamp(cov / (sx * sy), -1, 1);
}

function beta(x: number[], y: number[]): number {
  // beta = Cov(BTC, SPX) / Var(SPX)
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  
  const my = mean(y.slice(0, n));
  const mx = mean(x.slice(0, n));
  
  let cov = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    varY += (y[i] - my) ** 2;
  }
  
  if (varY === 0) return 0;
  return cov / varY;
}

function logReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class BtcOverlayService {
  private config: BtcOverlayConfig;
  
  constructor(config?: BtcOverlayConfig) {
    this.config = config || loadBtcOverlayConfig();
  }
  
  /**
   * Calculate overlay coefficients (beta, rho, weight, guard)
   */
  async calculateCoeffs(horizon: HorizonKey): Promise<OverlayCoeffs> {
    const cfg = this.config;
    const windowDays = cfg.rollingWindowDays[horizon] || 90;
    
    try {
      const db = getDb();
      
      // Fetch BTC and SPX price data
      const btcData = await db.collection('btc_candles')
        .find({})
        .sort({ date: -1 })
        .limit(windowDays + 10)
        .toArray();
      
      const spxData = await db.collection('spx_candles')
        .find({})
        .sort({ date: -1 })
        .limit(windowDays + 10)
        .toArray();
      
      // Extract close prices
      const btcPrices = btcData.map(c => c.close).reverse();
      const spxPrices = spxData.map(c => c.close).reverse();
      
      // Calculate returns
      const btcReturns = logReturns(btcPrices);
      const spxReturns = logReturns(spxPrices);
      
      // Align arrays
      const n = Math.min(btcReturns.length, spxReturns.length, windowDays);
      const btcR = btcReturns.slice(-n);
      const spxR = spxReturns.slice(-n);
      
      // Calculate metrics
      const rho = round(correlation(btcR, spxR), 4);
      const betaVal = round(beta(btcR, spxR), 4);
      
      // Calculate correlation stability (rolling windows)
      const windowSize = Math.min(30, Math.floor(n / 3));
      const rollingCorrs: number[] = [];
      for (let i = windowSize; i <= n; i++) {
        const subBtc = btcR.slice(i - windowSize, i);
        const subSpx = spxR.slice(i - windowSize, i);
        rollingCorrs.push(correlation(subBtc, subSpx));
      }
      const corrStability = round(Math.max(0, 1 - std(rollingCorrs)), 4);
      
      // Quality based on sample size and data freshness
      const quality = round(clamp(n / windowDays, 0, 1), 4);
      
      // Overlay weight = |rho| × stability × quality
      const overlayWeight = round(
        clamp(Math.abs(rho) * corrStability * quality, 0, 1),
        4
      );
      
      // Guard level based on regime conflict
      // For now, use correlation stability as proxy
      const gate = round(clamp(1 - corrStability, 0, 1), 4);
      let level: 'NONE' | 'OK' | 'WARNING' | 'BLOCKED' = 'OK';
      if (gate >= cfg.gateThresholds.blocked) level = 'BLOCKED';
      else if (gate >= cfg.gateThresholds.warning) level = 'WARNING';
      else if (gate < 0.2) level = 'NONE';
      
      return {
        beta: betaVal,
        rho,
        corrStability,
        quality,
        overlayWeight,
        guard: {
          gate,
          level,
          applied: round(1 - gate, 4),
        },
      };
    } catch (err: any) {
      console.log('[BtcOverlay] Coeffs calculation failed:', err.message);
      // Return defaults
      return {
        beta: cfg.defaultBeta[horizon] || 0.2,
        rho: 0,
        corrStability: 0,
        quality: 0,
        overlayWeight: 0,
        guard: {
          gate: 1,
          level: 'BLOCKED',
          applied: 0,
        },
      };
    }
  }
  
  /**
   * Calculate adjusted BTC forecast
   */
  computeAdjustedReturn(
    btcHybridReturn: number,
    spxFinalReturn: number,
    coeffs: OverlayCoeffs
  ): OverlayExplain {
    const { beta, rho, overlayWeight, guard } = coeffs;
    const g = guard.applied;
    const w = overlayWeight;
    
    // R_adj = R_btc + g × w × β × R_spx
    const impactRet = round(g * w * beta * spxFinalReturn, 6);
    const finalRet = round(
      clamp(
        btcHybridReturn + impactRet,
        -this.config.maxOverlayImpact,
        this.config.maxOverlayImpact
      ),
      6
    );
    
    return {
      baseRet: round(btcHybridReturn, 6),
      driverRet: round(spxFinalReturn, 6),
      impactRet,
      finalRet,
      formula: 'R_adj = R_btc + g × w × β × R_spx',
      inputs: {
        beta,
        rho,
        w,
        g,
      },
    };
  }
  
  /**
   * Build series for chart (BTC Hybrid + SPX Final + BTC Adjusted)
   */
  buildAdjustedSeries(
    basePrice: number,
    btcHybridReturns: number[],
    spxFinalReturns: number[],
    coeffs: OverlayCoeffs,
    startDate: Date,
    step: 'day' | 'week' = 'day'
  ): {
    btcHybrid: Array<{ t: string; v: number }>;
    spxFinal: Array<{ t: string; v: number }>;
    btcAdjusted: Array<{ t: string; v: number }>;
  } {
    const btcHybrid: Array<{ t: string; v: number }> = [];
    const spxFinal: Array<{ t: string; v: number }> = [];
    const btcAdjusted: Array<{ t: string; v: number }> = [];
    
    const { beta, overlayWeight, guard } = coeffs;
    const g = guard.applied;
    const w = overlayWeight;
    const stepMs = step === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    
    let btcCum = 0;
    let spxCum = 0;
    let adjCum = 0;
    
    const n = Math.min(btcHybridReturns.length, spxFinalReturns.length);
    
    for (let i = 0; i < n; i++) {
      const date = new Date(startDate.getTime() + (i + 1) * stepMs);
      const t = date.toISOString();
      
      btcCum += btcHybridReturns[i] || 0;
      spxCum += spxFinalReturns[i] || 0;
      
      // Adjusted return for this step
      const impact = g * w * beta * (spxFinalReturns[i] || 0);
      adjCum += (btcHybridReturns[i] || 0) + impact;
      
      btcHybrid.push({ t, v: round(basePrice * Math.exp(btcCum), 2) });
      spxFinal.push({ t, v: round(spxCum * 100, 2) }); // SPX as % return
      btcAdjusted.push({ t, v: round(basePrice * Math.exp(adjCum), 2) });
    }
    
    return { btcHybrid, spxFinal, btcAdjusted };
  }
  
  /**
   * Get full coeffs response
   */
  async getCoeffsResponse(horizon: HorizonKey): Promise<OverlayCoeffsResponse> {
    const coeffs = await this.calculateCoeffs(horizon);
    
    return {
      meta: {
        base: 'BTC',
        driver: 'SPX',
        horizon: `${horizon}d`,
        asOf: new Date().toISOString(),
      },
      coeffs,
    };
  }
  
  /**
   * Get explain response
   */
  getExplainResponse(
    horizon: HorizonKey,
    btcHybridReturn: number,
    spxFinalReturn: number,
    coeffs: OverlayCoeffs
  ): OverlayExplainResponse {
    const explain = this.computeAdjustedReturn(btcHybridReturn, spxFinalReturn, coeffs);
    
    const notes: string[] = [];
    if (coeffs.beta < 0) {
      notes.push('Negative beta: BTC tends to move opposite to SPX');
    } else if (coeffs.beta > 0.5) {
      notes.push('High beta: BTC strongly correlated with SPX');
    }
    if (coeffs.corrStability < 0.5) {
      notes.push('Unstable correlation: overlay influence reduced');
    }
    if (coeffs.guard.level === 'WARNING' || coeffs.guard.level === 'BLOCKED') {
      notes.push(`Regime conflict: overlay ${coeffs.guard.level.toLowerCase()}`);
    }
    
    let signalStrength: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (coeffs.overlayWeight > 0.6 && coeffs.quality > 0.7) signalStrength = 'HIGH';
    else if (coeffs.overlayWeight < 0.3 || coeffs.quality < 0.5) signalStrength = 'LOW';
    
    return {
      meta: {
        base: 'BTC',
        driver: 'SPX',
        horizon: `${horizon}d`,
        asOf: new Date().toISOString(),
      },
      composition: {
        baseHybrid: {
          ret: explain.baseRet,
          label: `${explain.baseRet >= 0 ? '+' : ''}${(explain.baseRet * 100).toFixed(2)}%`,
        },
        driverImpact: {
          ret: explain.impactRet,
          label: `${explain.impactRet >= 0 ? '+' : ''}${(explain.impactRet * 100).toFixed(2)}%`,
        },
        finalAdjusted: {
          ret: explain.finalRet,
          label: `${explain.finalRet >= 0 ? '+' : ''}${(explain.finalRet * 100).toFixed(2)}%`,
        },
      },
      drivers: {
        beta: coeffs.beta,
        rho: coeffs.rho,
        corrStability: coeffs.corrStability > 0.7 ? 'STABLE' : coeffs.corrStability > 0.4 ? 'MODERATE' : 'UNSTABLE',
        overlayWeight: coeffs.overlayWeight,
        guardLevel: coeffs.guard.level,
      },
      confidence: {
        signalStrength,
        quality: coeffs.quality,
        notes,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: BtcOverlayService | null = null;

export function getBtcOverlayService(): BtcOverlayService {
  if (!_instance) {
    _instance = new BtcOverlayService();
  }
  return _instance;
}
