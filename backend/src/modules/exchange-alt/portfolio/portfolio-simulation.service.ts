/**
 * BLOCK 12 — Portfolio Simulation Service
 * =========================================
 * 
 * Paper-simulation to validate selection logic.
 * NOT trading — proving statistical significance.
 */

import type { AltSetEntry } from '../alt-sets/alt-sets.types.js';
import type { ReplayOutcome } from '../replay/replay.types.js';

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO TYPES
// ═══════════════════════════════════════════════════════════════

export interface PortfolioConfig {
  // Selection rules
  scoreThreshold: number;      // Min altScore to include
  liquidityMin: number;        // Min volume
  maxAssets: number;           // Max assets in portfolio
  
  // Weighting mode
  weightMode: 'EQUAL' | 'SCORE_PROPORTIONAL' | 'EXPECTED_MOVE';
  
  // Horizon
  horizon: '1h' | '4h' | '24h';
}

export interface PortfolioSnapshot {
  timestamp: number;
  date: string;
  
  assets: Array<{
    symbol: string;
    weight: number;
    entryScore: number;
    entryReason: string;
  }>;
  
  config: PortfolioConfig;
}

export interface PortfolioResult {
  runId: string;
  date: string;
  horizon: string;
  
  // Our portfolio
  picks: number;
  returns: number[];
  avgReturn: number;
  medianReturn: number;
  hitRate: number;
  maxDrawdown: number;
  
  // Baseline comparison
  baseline: {
    randomReturns: number[];
    randomAvg: number;
    topVolumeReturns: number[];
    topVolumeAvg: number;
  };
  
  // Outperformance
  outperformanceVsRandom: number;
  outperformanceVsVolume: number;
  
  createdAt: number;
}

export interface PortfolioMetrics {
  // Aggregate over multiple runs
  totalRuns: number;
  totalPicks: number;
  
  // Rates
  avgHitRate: number;
  avgReturn: number;
  avgMedianReturn: number;
  avgMaxDrawdown: number;
  
  // Sharpe-like
  sharpeRatio: number;
  
  // Outperformance
  avgOutperformance: number;
  consistentOutperformance: number; // % of runs outperforming
  
  // Rolling stats
  rolling7d: {
    hitRate: number;
    avgReturn: number;
    outperformance: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO SIMULATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class PortfolioSimulationService {
  private results: PortfolioResult[] = [];
  private config: PortfolioConfig;

  constructor(config?: Partial<PortfolioConfig>) {
    this.config = {
      scoreThreshold: 50,
      liquidityMin: 1_000_000,
      maxAssets: 10,
      weightMode: 'EQUAL',
      horizon: '4h',
      ...config,
    };
  }

  /**
   * Build portfolio from alt set entries
   */
  buildPortfolio(entries: AltSetEntry[]): PortfolioSnapshot {
    // Filter by threshold and regime
    const filtered = entries.filter(e => 
      e.altScore >= this.config.scoreThreshold &&
      e.regimeFit
    );

    // Sort by score and take top N
    const sorted = filtered
      .sort((a, b) => b.altScore - a.altScore)
      .slice(0, this.config.maxAssets);

    // Calculate weights
    const weights = this.calculateWeights(sorted);

    return {
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0],
      assets: sorted.map((e, i) => ({
        symbol: e.symbol,
        weight: weights[i],
        entryScore: e.altScore,
        entryReason: e.why,
      })),
      config: { ...this.config },
    };
  }

  /**
   * Calculate weights based on mode
   */
  private calculateWeights(entries: AltSetEntry[]): number[] {
    if (entries.length === 0) return [];

    switch (this.config.weightMode) {
      case 'EQUAL':
        return entries.map(() => 1 / entries.length);

      case 'SCORE_PROPORTIONAL': {
        const totalScore = entries.reduce((sum, e) => sum + e.altScore, 0);
        return entries.map(e => e.altScore / totalScore);
      }

      case 'EXPECTED_MOVE': {
        // Parse expected move and weight by it
        const moves = entries.map(e => {
          const match = e.expectedMove.match(/(\d+)-(\d+)/);
          return match ? (parseInt(match[1]) + parseInt(match[2])) / 2 : 5;
        });
        const totalMove = moves.reduce((sum, m) => sum + m, 0);
        return moves.map(m => m / totalMove);
      }

      default:
        return entries.map(() => 1 / entries.length);
    }
  }

  /**
   * Evaluate portfolio against outcomes
   */
  evaluatePortfolio(
    snapshot: PortfolioSnapshot,
    outcomes: ReplayOutcome[],
    baselineReturns: { random: number[]; topVolume: number[] }
  ): PortfolioResult {
    const outcomeMap = new Map(outcomes.map(o => [o.asset, o]));
    
    // Get returns for our picks
    const returns: number[] = [];
    for (const asset of snapshot.assets) {
      const outcome = outcomeMap.get(asset.symbol);
      if (outcome) {
        returns.push(outcome.returnPct);
      }
    }

    // Calculate metrics
    const avgReturn = this.mean(returns);
    const medianReturn = this.median(returns);
    const hitRate = returns.filter(r => r > 0).length / Math.max(1, returns.length);
    const maxDrawdown = Math.abs(Math.min(0, ...returns));

    // Baseline
    const randomAvg = this.mean(baselineReturns.random);
    const topVolumeAvg = this.mean(baselineReturns.topVolume);

    // Outperformance
    const outperformanceVsRandom = avgReturn - randomAvg;
    const outperformanceVsVolume = avgReturn - topVolumeAvg;

    const result: PortfolioResult = {
      runId: `run_${Date.now()}`,
      date: snapshot.date,
      horizon: this.config.horizon,
      picks: returns.length,
      returns,
      avgReturn,
      medianReturn,
      hitRate,
      maxDrawdown,
      baseline: {
        randomReturns: baselineReturns.random,
        randomAvg,
        topVolumeReturns: baselineReturns.topVolume,
        topVolumeAvg,
      },
      outperformanceVsRandom,
      outperformanceVsVolume,
      createdAt: Date.now(),
    };

    this.results.push(result);

    // Keep results manageable
    if (this.results.length > 500) {
      this.results = this.results.slice(-300);
    }

    return result;
  }

  /**
   * Get aggregate metrics
   */
  getMetrics(windowDays?: number): PortfolioMetrics {
    let relevantResults = this.results;
    
    if (windowDays) {
      const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
      relevantResults = this.results.filter(r => r.createdAt >= cutoff);
    }

    if (relevantResults.length === 0) {
      return this.emptyMetrics();
    }

    const totalPicks = relevantResults.reduce((sum, r) => sum + r.picks, 0);
    const avgHitRate = this.mean(relevantResults.map(r => r.hitRate));
    const avgReturn = this.mean(relevantResults.map(r => r.avgReturn));
    const avgMedianReturn = this.mean(relevantResults.map(r => r.medianReturn));
    const avgMaxDrawdown = this.mean(relevantResults.map(r => r.maxDrawdown));
    
    // Sharpe-like ratio
    const returnStd = this.std(relevantResults.map(r => r.avgReturn));
    const sharpeRatio = returnStd > 0 ? avgReturn / returnStd : 0;

    // Outperformance
    const avgOutperformance = this.mean(relevantResults.map(r => r.outperformanceVsRandom));
    const consistentOutperformance = 
      relevantResults.filter(r => r.outperformanceVsRandom > 0).length / relevantResults.length;

    // Rolling 7d
    const last7d = relevantResults.slice(-7);
    const rolling7d = {
      hitRate: this.mean(last7d.map(r => r.hitRate)),
      avgReturn: this.mean(last7d.map(r => r.avgReturn)),
      outperformance: this.mean(last7d.map(r => r.outperformanceVsRandom)),
    };

    return {
      totalRuns: relevantResults.length,
      totalPicks,
      avgHitRate,
      avgReturn,
      avgMedianReturn,
      avgMaxDrawdown,
      sharpeRatio,
      avgOutperformance,
      consistentOutperformance,
      rolling7d,
    };
  }

  /**
   * Generate random baseline (control group)
   */
  generateRandomBaseline(
    universe: string[],
    size: number,
    outcomeMap: Map<string, ReplayOutcome>
  ): number[] {
    const shuffled = [...universe].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, size);
    
    return selected
      .map(s => outcomeMap.get(s)?.returnPct ?? 0)
      .filter(r => r !== 0);
  }

  /**
   * Get results history
   */
  getResults(limit: number = 50): PortfolioResult[] {
    return this.results.slice(-limit);
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<PortfolioConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private std(values: number[]): number {
    if (values.length === 0) return 0;
    const m = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private emptyMetrics(): PortfolioMetrics {
    return {
      totalRuns: 0,
      totalPicks: 0,
      avgHitRate: 0,
      avgReturn: 0,
      avgMedianReturn: 0,
      avgMaxDrawdown: 0,
      sharpeRatio: 0,
      avgOutperformance: 0,
      consistentOutperformance: 0,
      rolling7d: { hitRate: 0, avgReturn: 0, outperformance: 0 },
    };
  }
}

export const portfolioSimulationService = new PortfolioSimulationService();

console.log('[Block12] Portfolio Simulation Service loaded');
