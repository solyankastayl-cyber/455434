/**
 * SPX DECADE TRACKER SERVICE
 * 
 * BLOCK B6.10.2 + B6.10.2.1 — Live aggregation of skill by decade + Volatility Overlay
 * 
 * Watches calibration progress and shows how model evolves
 * across decades (1950s, 1960s, ... 2020s)
 * 
 * B6.10.2.1 additions:
 * - Realized volatility (annualized std of daily returns)
 * - Average max drawdown per decade
 * - Trend duration proxy (avg days in same direction)
 */

import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';
import mongoose from 'mongoose';

const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function getDecade(dateStr: string): string {
  const year = parseInt(dateStr.substring(0, 4));
  const decadeStart = Math.floor(year / 10) * 10;
  return `${decadeStart}s`;
}

function getConfidence(samples: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (samples < 300) return 'LOW';
  if (samples < 1500) return 'MEDIUM';
  return 'HIGH';
}

// B6.10.2.1: Calculate standard deviation
function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = sqDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

// B6.10.2.1: Volatility regime classification
function getVolRegime(annualizedVol: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
  if (annualizedVol < 0.12) return 'LOW';       // < 12%
  if (annualizedVol < 0.18) return 'MEDIUM';    // 12-18%
  if (annualizedVol < 0.30) return 'HIGH';      // 18-30%
  return 'EXTREME';                              // > 30%
}

export interface HorizonSkill {
  horizon: string;
  samples: number;
  hitRate: number;
  baselineUp: number;
  skill: number;
}

// B6.10.2.1: Volatility overlay data
export interface VolatilityOverlay {
  realizedVol: number;           // Annualized std of daily returns
  avgMaxDD: number;              // Average max drawdown
  avgTrendDuration: number;      // Avg days in same direction trend
  volRegime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface DecadeStats {
  decade: string;
  samples: number;
  hitRate: number;
  baselineUp: number;
  baselineDown: number;
  skillTotal: number;
  skillUp: number;
  skillDown: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  byHorizon: HorizonSkill[];
  // B6.10.2.1
  volatility?: VolatilityOverlay;
}

export interface DecadeTrackerResult {
  preset: string;
  computedAt: string;
  decades: DecadeStats[];
  global: {
    totalSamples: number;
    avgSkill: number;
    bestDecade: string | null;
    worstDecade: string | null;
    modelState: 'EDGE_POSITIVE' | 'EDGE_NEUTRAL' | 'EDGE_FRAGILE';
    // B6.10.2.1: Global volatility correlation
    volSkillCorrelation?: number;
  };
  heatmap: {
    decades: string[];
    horizons: string[];
    cells: { decade: string; horizon: string; skill: number; samples: number }[];
  };
}

export class SpxDecadeTrackerService {

  /**
   * B6.10.2.1: Compute volatility overlay for a decade
   */
  private async computeVolatilityOverlay(decade: string): Promise<VolatilityOverlay | null> {
    try {
      // Get decade date range
      const decadeStart = parseInt(decade.replace('s', ''));
      const startDate = `${decadeStart}-01-01`;
      const endDate = `${decadeStart + 9}-12-31`;

      // Fetch candles for this decade
      const db = mongoose.connection.db;
      if (!db) return null;
      
      const candles = await db.collection('spx_candles')
        .find({ date: { $gte: startDate, $lte: endDate } })
        .sort({ date: 1 })
        .toArray();

      if (candles.length < 20) return null;

      // Calculate daily returns
      const dailyReturns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prevClose = candles[i - 1].close as number;
        const currClose = candles[i].close as number;
        if (prevClose > 0) {
          dailyReturns.push((currClose - prevClose) / prevClose);
        }
      }

      if (dailyReturns.length < 10) return null;

      // Realized volatility (annualized)
      const dailyVol = calcStdDev(dailyReturns);
      const realizedVol = dailyVol * Math.sqrt(252); // Annualize

      // Max drawdown calculation
      const drawdowns: number[] = [];
      let peak = candles[0].close as number;
      let maxDD = 0;
      
      for (const candle of candles) {
        const close = candle.close as number;
        if (close > peak) {
          peak = close;
          if (maxDD > 0) {
            drawdowns.push(maxDD);
            maxDD = 0;
          }
        } else {
          const dd = (peak - close) / peak;
          if (dd > maxDD) maxDD = dd;
        }
      }
      if (maxDD > 0) drawdowns.push(maxDD);

      const avgMaxDD = drawdowns.length > 0 
        ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length 
        : 0;

      // Trend duration (avg consecutive days in same direction)
      let trendDurations: number[] = [];
      let currentTrend = 0;
      let lastDirection = 0;

      for (const ret of dailyReturns) {
        const dir = ret > 0 ? 1 : ret < 0 ? -1 : 0;
        if (dir === lastDirection && dir !== 0) {
          currentTrend++;
        } else {
          if (currentTrend > 0) {
            trendDurations.push(currentTrend);
          }
          currentTrend = 1;
          lastDirection = dir;
        }
      }
      if (currentTrend > 0) trendDurations.push(currentTrend);

      const avgTrendDuration = trendDurations.length > 0
        ? trendDurations.reduce((a, b) => a + b, 0) / trendDurations.length
        : 0;

      return {
        realizedVol: round4(realizedVol),
        avgMaxDD: round4(avgMaxDD),
        avgTrendDuration: round4(avgTrendDuration),
        volRegime: getVolRegime(realizedVol),
      };
    } catch (err) {
      console.error(`[DecadeTracker] Error computing volatility for ${decade}:`, err);
      return null;
    }
  }

  /**
   * Build decade tracker from outcomes
   */
  async buildDecadeTracker(preset = 'BALANCED'): Promise<DecadeTrackerResult> {
    // Fetch all outcomes
    const outcomes = await SpxOutcomeModel.find({
      preset,
      symbol: 'SPX',
    }).lean();

    // Group by decade
    const byDecade = new Map<string, any[]>();
    for (const o of outcomes) {
      const decade = getDecade(o.asOfDate);
      const arr = byDecade.get(decade) ?? [];
      arr.push(o);
      byDecade.set(decade, arr);
    }

    // Sort decades chronologically
    const sortedDecades = [...byDecade.keys()].sort();

    // Process each decade
    const decades: DecadeStats[] = [];
    const heatmapCells: { decade: string; horizon: string; skill: number; samples: number }[] = [];

    for (const decade of sortedDecades) {
      const docs = byDecade.get(decade) ?? [];
      const stats = this.computeDecadeStats(decade, docs);
      
      // B6.10.2.1: Add volatility overlay
      const volatility = await this.computeVolatilityOverlay(decade);
      if (volatility) {
        stats.volatility = volatility;
      }
      
      decades.push(stats);

      // Add to heatmap
      for (const h of stats.byHorizon) {
        heatmapCells.push({
          decade,
          horizon: h.horizon,
          skill: h.skill,
          samples: h.samples,
        });
      }
    }

    // Global stats
    const totalSamples = decades.reduce((s, d) => s + d.samples, 0);
    const avgSkill = totalSamples > 0
      ? decades.reduce((s, d) => s + d.skillTotal * d.samples, 0) / totalSamples
      : 0;

    const decadesWithData = decades.filter(d => d.samples >= 300);
    const bestDecade = decadesWithData.length > 0
      ? decadesWithData.reduce((best, d) => d.skillTotal > best.skillTotal ? d : best).decade
      : null;
    const worstDecade = decadesWithData.length > 0
      ? decadesWithData.reduce((worst, d) => d.skillTotal < worst.skillTotal ? d : worst).decade
      : null;

    // B6.10.2.1: Calculate vol-skill correlation
    let volSkillCorrelation: number | undefined;
    const decadesWithVol = decades.filter(d => d.volatility && d.samples >= 100);
    if (decadesWithVol.length >= 2) {
      const vols = decadesWithVol.map(d => d.volatility!.realizedVol);
      const skills = decadesWithVol.map(d => d.skillTotal);
      volSkillCorrelation = this.calcCorrelation(vols, skills);
    }

    // Model state
    let modelState: DecadeTrackerResult['global']['modelState'] = 'EDGE_NEUTRAL';
    if (avgSkill > 0.01) modelState = 'EDGE_POSITIVE';
    else if (avgSkill < -0.02) modelState = 'EDGE_FRAGILE';

    return {
      preset,
      computedAt: new Date().toISOString(),
      decades,
      global: {
        totalSamples,
        avgSkill: round4(avgSkill),
        bestDecade,
        worstDecade,
        modelState,
        volSkillCorrelation: volSkillCorrelation ? round4(volSkillCorrelation) : undefined,
      },
      heatmap: {
        decades: sortedDecades,
        horizons: HORIZONS,
        cells: heatmapCells,
      },
    };
  }

  /**
   * B6.10.2.1: Calculate Pearson correlation
   */
  private calcCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    let num = 0;
    let denX = 0;
    let denY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  /**
   * Compute stats for a single decade
   */
  private computeDecadeStats(decade: string, docs: any[]): DecadeStats {
    const total = docs.length;

    if (total === 0) {
      return {
        decade,
        samples: 0,
        hitRate: 0,
        baselineUp: 0.5,
        baselineDown: 0.5,
        skillTotal: 0,
        skillUp: 0,
        skillDown: 0,
        confidence: 'LOW',
        byHorizon: HORIZONS.map(h => ({ horizon: h, samples: 0, hitRate: 0, baselineUp: 0.5, skill: 0 })),
      };
    }

    // Compute realized direction from return
    const withDir = docs.map(d => ({
      ...d,
      realizedDirection: d.actualReturnPct > 0.1 ? 'UP' : d.actualReturnPct < -0.1 ? 'DOWN' : 'NEUTRAL',
      predictedDirection: d.expectedDirection === 'BULL' ? 'UP' : d.expectedDirection === 'BEAR' ? 'DOWN' : 'NEUTRAL',
    }));

    // Filter valid (non-neutral realized)
    const valid = withDir.filter(d => d.realizedDirection !== 'NEUTRAL');
    const validTotal = valid.length || 1;

    // Baseline
    const baseUp = valid.filter(d => d.realizedDirection === 'UP').length;
    const baseDown = valid.filter(d => d.realizedDirection === 'DOWN').length;
    const baselineUp = safeDiv(baseUp, validTotal);
    const baselineDown = safeDiv(baseDown, validTotal);
    const baseline = Math.max(baselineUp, baselineDown);

    // Hit rate
    const hits = docs.filter(d => d.hit === true).length;
    const hitRate = safeDiv(hits, total);
    const skillTotal = hitRate - baseline;

    // Directional skill
    const predUp = withDir.filter(d => d.predictedDirection === 'UP');
    const predDown = withDir.filter(d => d.predictedDirection === 'DOWN');
    const hitUp = predUp.length > 0 ? safeDiv(predUp.filter(d => d.hit).length, predUp.length) : 0;
    const hitDown = predDown.length > 0 ? safeDiv(predDown.filter(d => d.hit).length, predDown.length) : 0;
    const skillUp = hitUp - baselineUp;
    const skillDown = hitDown - baselineDown;

    // By horizon
    const byHorizon: HorizonSkill[] = [];
    for (const horizon of HORIZONS) {
      const hDocs = docs.filter(d => d.horizon === horizon);
      const hTotal = hDocs.length;
      
      if (hTotal === 0) {
        byHorizon.push({ horizon, samples: 0, hitRate: 0, baselineUp: 0.5, skill: 0 });
        continue;
      }

      const hWithDir = hDocs.map(d => ({
        ...d,
        realizedDirection: d.actualReturnPct > 0.1 ? 'UP' : d.actualReturnPct < -0.1 ? 'DOWN' : 'NEUTRAL',
      }));
      const hValid = hWithDir.filter(d => d.realizedDirection !== 'NEUTRAL');
      const hValidTotal = hValid.length || 1;

      const hBaseUp = hValid.filter(d => d.realizedDirection === 'UP').length;
      const hBaselineUp = safeDiv(hBaseUp, hValidTotal);
      const hBaseline = Math.max(hBaselineUp, 1 - hBaselineUp);

      const hHits = hDocs.filter(d => d.hit === true).length;
      const hHitRate = safeDiv(hHits, hTotal);
      const hSkill = hHitRate - hBaseline;

      byHorizon.push({
        horizon,
        samples: hTotal,
        hitRate: round4(hHitRate),
        baselineUp: round4(hBaselineUp),
        skill: round4(hSkill),
      });
    }

    return {
      decade,
      samples: total,
      hitRate: round4(hitRate),
      baselineUp: round4(baselineUp),
      baselineDown: round4(baselineDown),
      skillTotal: round4(skillTotal),
      skillUp: round4(skillUp),
      skillDown: round4(skillDown),
      confidence: getConfidence(total),
      byHorizon,
    };
  }
}

export const spxDecadeTrackerService = new SpxDecadeTrackerService();
export default SpxDecadeTrackerService;
