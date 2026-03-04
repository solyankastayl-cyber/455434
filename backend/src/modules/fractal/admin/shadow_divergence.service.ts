/**
 * BLOCK 57 — Shadow Divergence Service
 * 
 * Compares ACTIVE vs SHADOW forward performance.
 * Provides recommendation (NOT auto-promotion).
 * 
 * Principles:
 * - BTC-only
 * - Forward-truth only (from resolved snapshots)
 * - No auto-promotion
 * - Advisory recommendations only
 */

import { SignalSnapshotModel, type SignalSnapshotDocument } from '../storage/signal-snapshot.schema.js';
import { forwardEquityService } from '../strategy/forward/forward.equity.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Verdict = 'HOLD_ACTIVE' | 'SHADOW_OUTPERFORMS' | 'INSUFFICIENT_DATA';
export type Preset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type Horizon = '7d' | '14d' | '30d';

export interface Metrics {
  cagr: number;
  sharpe: number;
  maxDD: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  trades: number;
}

export interface Delta {
  cagr: number;
  sharpe: number;
  maxDD: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
}

export interface PresetHorizonMetrics {
  active: Metrics;
  shadow: Metrics;
  delta: Delta;
}

export interface CalibrationMetrics {
  ece: number;
  brier: number;
  bins: Array<{ bin: number; predicted: number; actual: number; count: number }>;
}

export interface DivergenceEvent {
  asofDate: string;
  preset: string;
  horizon: string;
  activeAction: string;
  shadowAction: string;
  activeSize: number;
  shadowSize: number;
  realizedReturn: number;
  winner: 'ACTIVE' | 'SHADOW' | 'TIE';
}

export interface ShadowDivergenceResponse {
  meta: {
    symbol: string;
    from: string;
    to: string;
    resolvedCount: number;
    dataSufficiency: 'SUFFICIENT' | 'INSUFFICIENT';
  };
  
  summary: Record<Preset, Record<Horizon, PresetHorizonMetrics>>;
  
  equity: Record<Preset, Record<Horizon, {
    active: Array<{ t: string; value: number }>;
    shadow: Array<{ t: string; value: number }>;
  }>>;
  
  calibration: Record<Preset, Record<Horizon, {
    active: CalibrationMetrics;
    shadow: CalibrationMetrics;
  }>>;
  
  divergenceLedger: DivergenceEvent[];
  
  recommendation: {
    verdict: Verdict;
    reasoning: string[];
    shadowScore: number; // 0-100
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ShadowDivergenceService {
  
  /**
   * Get default date range (last 90 days)
   */
  private getDefaultDateRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10)
    };
  }
  
  /**
   * Calculate delta between two metrics
   */
  private calcDelta(active: Metrics, shadow: Metrics): Delta {
    return {
      cagr: shadow.cagr - active.cagr,
      sharpe: shadow.sharpe - active.sharpe,
      maxDD: shadow.maxDD - active.maxDD,
      winRate: shadow.winRate - active.winRate,
      expectancy: shadow.expectancy - active.expectancy,
      profitFactor: shadow.profitFactor - active.profitFactor
    };
  }
  
  /**
   * Calculate calibration metrics (ECE, Brier)
   */
  private async calcCalibration(
    symbol: string,
    role: 'ACTIVE' | 'SHADOW',
    preset: Preset,
    horizon: number
  ): Promise<CalibrationMetrics> {
    const horizonKey = `${horizon}d`;
    
    const snapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: role,
      'strategy.preset': preset,
      [`outcomes.${horizonKey}.resolvedAt`]: { $exists: true }
    }).lean() as SignalSnapshotDocument[];
    
    // Build bins (10 bins: 0-10%, 10-20%, ..., 90-100%)
    const bins: Map<number, { predicted: number; hits: number; total: number }> = new Map();
    for (let i = 0; i <= 10; i++) {
      bins.set(i, { predicted: (i + 0.5) / 10, hits: 0, total: 0 });
    }
    
    let brierSum = 0;
    let totalCount = 0;
    
    for (const s of snapshots) {
      const conf = s.confidence;
      const binIdx = Math.min(10, Math.floor(conf * 10));
      
      const outcomes = (s as any).outcomes;
      const outcome = outcomes?.[horizonKey];
      
      if (outcome) {
        const hit = outcome.hit ? 1 : 0;
        const bin = bins.get(binIdx)!;
        bin.total++;
        bin.hits += hit;
        
        // Brier score
        brierSum += Math.pow(conf - hit, 2);
        totalCount++;
      }
    }
    
    // Calculate ECE
    let ece = 0;
    const binArray: CalibrationMetrics['bins'] = [];
    
    for (const [idx, data] of bins.entries()) {
      const actual = data.total > 0 ? data.hits / data.total : 0;
      binArray.push({
        bin: idx,
        predicted: data.predicted,
        actual,
        count: data.total
      });
      
      if (data.total > 0) {
        ece += data.total * Math.abs(data.predicted - actual);
      }
    }
    
    ece = totalCount > 0 ? ece / totalCount : 0;
    const brier = totalCount > 0 ? brierSum / totalCount : 0;
    
    return { ece, brier, bins: binArray };
  }
  
  /**
   * Find divergent decisions between ACTIVE and SHADOW
   */
  private async findDivergence(
    symbol: string,
    from: string,
    to: string
  ): Promise<DivergenceEvent[]> {
    const events: DivergenceEvent[] = [];
    
    // Get ACTIVE snapshots
    const activeSnapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'ACTIVE',
      asOf: { $gte: new Date(from), $lte: new Date(to) }
    }).lean() as SignalSnapshotDocument[];
    
    // Get SHADOW snapshots
    const shadowSnapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'SHADOW',
      asOf: { $gte: new Date(from), $lte: new Date(to) }
    }).lean() as SignalSnapshotDocument[];
    
    // Index shadow by date+preset
    const shadowIndex = new Map<string, SignalSnapshotDocument>();
    for (const s of shadowSnapshots) {
      const key = `${s.asOf.toISOString().slice(0, 10)}-${s.strategy.preset}`;
      shadowIndex.set(key, s);
    }
    
    // Find divergent decisions
    for (const active of activeSnapshots) {
      const key = `${active.asOf.toISOString().slice(0, 10)}-${active.strategy.preset}`;
      const shadow = shadowIndex.get(key);
      
      if (!shadow) continue;
      
      // Check if actions differ
      if (active.action !== shadow.action || 
          Math.abs(active.strategy.positionSize - shadow.strategy.positionSize) > 0.1) {
        
        // Check outcomes for 7d horizon
        const outcomes7d = (active as any).outcomes?.['7d'];
        
        if (outcomes7d?.resolvedAt) {
          const realizedReturn = outcomes7d.realizedReturn;
          
          // Determine winner
          const activePnl = active.action === 'LONG' 
            ? active.strategy.positionSize * realizedReturn
            : active.action === 'SHORT' 
              ? active.strategy.positionSize * (-realizedReturn)
              : 0;
          
          const shadowPnl = shadow.action === 'LONG'
            ? shadow.strategy.positionSize * realizedReturn
            : shadow.action === 'SHORT'
              ? shadow.strategy.positionSize * (-realizedReturn)
              : 0;
          
          let winner: 'ACTIVE' | 'SHADOW' | 'TIE' = 'TIE';
          if (activePnl > shadowPnl + 0.001) winner = 'ACTIVE';
          else if (shadowPnl > activePnl + 0.001) winner = 'SHADOW';
          
          events.push({
            asofDate: active.asOf.toISOString().slice(0, 10),
            preset: active.strategy.preset,
            horizon: '7d',
            activeAction: active.action,
            shadowAction: shadow.action,
            activeSize: active.strategy.positionSize,
            shadowSize: shadow.strategy.positionSize,
            realizedReturn,
            winner
          });
        }
      }
    }
    
    // Sort by date desc
    events.sort((a, b) => b.asofDate.localeCompare(a.asofDate));
    
    return events.slice(0, 30); // Last 30 divergent events
  }
  
  /**
   * Calculate recommendation score (0-100)
   */
  private calcShadowScore(
    summary: ShadowDivergenceResponse['summary']
  ): { score: number; reasoning: string[] } {
    const reasoning: string[] = [];
    let score = 50; // Start neutral
    
    const presets: Preset[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
    const horizons: Horizon[] = ['7d', '14d', '30d'];
    
    let totalComparisons = 0;
    let shadowWins = 0;
    
    for (const preset of presets) {
      for (const horizon of horizons) {
        const metrics = summary[preset]?.[horizon];
        if (!metrics || metrics.active.trades < 5) continue;
        
        totalComparisons++;
        
        // Sharpe comparison (weight: 40)
        if (metrics.delta.sharpe > 0.15) {
          shadowWins++;
          score += 5;
          reasoning.push(`ΔSharpe +${metrics.delta.sharpe.toFixed(2)} in ${preset} ${horizon}`);
        } else if (metrics.delta.sharpe < -0.15) {
          score -= 5;
        }
        
        // MaxDD comparison (weight: 30) - lower is better
        if (metrics.delta.maxDD < -0.02) {
          shadowWins++;
          score += 4;
          reasoning.push(`ΔMaxDD ${(metrics.delta.maxDD * 100).toFixed(1)}% in ${preset} ${horizon}`);
        } else if (metrics.delta.maxDD > 0.02) {
          score -= 4;
        }
        
        // Win rate comparison (weight: 20)
        if (metrics.delta.winRate > 0.05) {
          score += 3;
        } else if (metrics.delta.winRate < -0.05) {
          score -= 3;
        }
        
        // Profit factor comparison (weight: 10)
        if (metrics.delta.profitFactor > 0.2) {
          score += 2;
        } else if (metrics.delta.profitFactor < -0.2) {
          score -= 2;
        }
      }
    }
    
    // Clamp score
    score = Math.max(0, Math.min(100, score));
    
    if (totalComparisons === 0) {
      reasoning.push('Insufficient data for comparison');
    } else if (shadowWins > totalComparisons * 0.6) {
      reasoning.push(`Shadow outperforms in ${shadowWins}/${totalComparisons} categories`);
    }
    
    return { score, reasoning };
  }
  
  /**
   * Main aggregator - get full divergence report
   */
  async getDivergenceReport(
    symbol: string,
    fromDate?: string,
    toDate?: string
  ): Promise<ShadowDivergenceResponse> {
    // BTC-only guard
    if (symbol !== 'BTC') {
      throw new Error('Shadow divergence supports BTC only');
    }
    
    const { from, to } = fromDate && toDate 
      ? { from: fromDate, to: toDate }
      : this.getDefaultDateRange();
    
    console.log(`[ShadowDivergence] Building report for ${symbol} from ${from} to ${to}`);
    
    // Initialize response structure
    const presets: Preset[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
    const horizons: Array<{ key: Horizon; num: 7 | 14 | 30 }> = [
      { key: '7d', num: 7 },
      { key: '14d', num: 14 },
      { key: '30d', num: 30 }
    ];
    
    const summary: ShadowDivergenceResponse['summary'] = {} as any;
    const equity: ShadowDivergenceResponse['equity'] = {} as any;
    const calibration: ShadowDivergenceResponse['calibration'] = {} as any;
    
    let totalResolved = 0;
    
    // Build metrics for each preset × horizon
    for (const preset of presets) {
      summary[preset] = {} as any;
      equity[preset] = {} as any;
      calibration[preset] = {} as any;
      
      for (const { key: horizon, num } of horizons) {
        // Get ACTIVE metrics
        const activeResult = await forwardEquityService.build({
          symbol,
          role: 'ACTIVE',
          preset,
          horizon: num,
          from,
          to
        });
        
        // Get SHADOW metrics
        const shadowResult = await forwardEquityService.build({
          symbol,
          role: 'SHADOW',
          preset,
          horizon: num,
          from,
          to
        });
        
        totalResolved += activeResult.summary.resolved;
        
        const activeMetrics: Metrics = {
          cagr: activeResult.metrics.cagr,
          sharpe: activeResult.metrics.sharpe,
          maxDD: activeResult.metrics.maxDD,
          winRate: activeResult.metrics.winRate,
          expectancy: activeResult.metrics.expectancy,
          profitFactor: activeResult.metrics.profitFactor,
          trades: activeResult.metrics.trades
        };
        
        const shadowMetrics: Metrics = {
          cagr: shadowResult.metrics.cagr,
          sharpe: shadowResult.metrics.sharpe,
          maxDD: shadowResult.metrics.maxDD,
          winRate: shadowResult.metrics.winRate,
          expectancy: shadowResult.metrics.expectancy,
          profitFactor: shadowResult.metrics.profitFactor,
          trades: shadowResult.metrics.trades
        };
        
        summary[preset][horizon] = {
          active: activeMetrics,
          shadow: shadowMetrics,
          delta: this.calcDelta(activeMetrics, shadowMetrics)
        };
        
        equity[preset][horizon] = {
          active: activeResult.equity,
          shadow: shadowResult.equity
        };
        
        // Calibration
        const activeCal = await this.calcCalibration(symbol, 'ACTIVE', preset, num);
        const shadowCal = await this.calcCalibration(symbol, 'SHADOW', preset, num);
        
        calibration[preset][horizon] = {
          active: activeCal,
          shadow: shadowCal
        };
      }
    }
    
    // Divergence ledger
    const divergenceLedger = await this.findDivergence(symbol, from, to);
    
    // Recommendation
    const { score, reasoning } = this.calcShadowScore(summary);
    
    let verdict: Verdict = 'HOLD_ACTIVE';
    if (totalResolved < 30) {
      verdict = 'INSUFFICIENT_DATA';
      reasoning.unshift(`Only ${totalResolved} resolved snapshots (need 30+)`);
    } else if (score >= 65) {
      verdict = 'SHADOW_OUTPERFORMS';
    }
    
    return {
      meta: {
        symbol,
        from,
        to,
        resolvedCount: totalResolved,
        dataSufficiency: totalResolved >= 30 ? 'SUFFICIENT' : 'INSUFFICIENT'
      },
      summary,
      equity,
      calibration,
      divergenceLedger,
      recommendation: {
        verdict,
        reasoning: reasoning.slice(0, 5),
        shadowScore: score
      }
    };
  }
}

// Export singleton
export const shadowDivergenceService = new ShadowDivergenceService();
