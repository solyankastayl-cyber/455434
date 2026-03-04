/**
 * BLOCK 56 — Strategy Backtest Service
 * 
 * Runs historical backtest for 3 presets (Conservative, Balanced, Aggressive)
 * Uses same Fractal signals, different risk policies.
 * 
 * Key principles:
 * - No future information leak
 * - Fixed preset per entire period
 * - Same signal feed for all presets
 * - Trade on close (or next open)
 */

import { CanonicalStore } from '../data/canonical.store.js';
import {
  EquityPoint,
  Trade,
  MetricsResult,
  calcAllMetrics,
  formatMetrics
} from './strategy.metrics.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type StrategyPresetKey = 'conservative' | 'balanced' | 'aggressive';

interface StrategyPreset {
  key: StrategyPresetKey;
  label: string;
  thresholds: {
    minConfidence: number;
    minReliability: number;
    maxEntropy: number;
    minStability: number;
    maxTailP95DD: number;
  };
  sizing: {
    baseRisk: number;
    maxSize: number;
  };
}

interface SignalSnapshot {
  t: Date;
  confidence: number;
  reliability: number;
  entropy: number;
  stability: number;
  expectedReturn: number;
  mcP95_DD: number;
  action: 'LONG' | 'SHORT' | 'HOLD';
}

interface DailyBar {
  t: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface BacktestConfig {
  symbol: string;
  from: Date;
  to: Date;
  feesBps: number;
  slippageBps: number;
  tradeOnClose: boolean;
}

interface PresetResult {
  preset: StrategyPresetKey;
  metrics: MetricsResult;
  equitySeries: EquityPoint[];
  trades: Trade[];
}

export interface BacktestGridResult {
  symbol: string;
  tf: string;
  period: { from: string; to: string };
  assumptions: {
    feesBps: number;
    slippageBps: number;
    tradeOnClose: boolean;
  };
  signalSource: 'ENGINE_ASOF' | 'SNAPSHOT';
  results: Array<{
    preset: StrategyPresetKey;
    cagr: number;
    sharpe: number;
    maxDD: number;
    trades: number;
    avgPosition: number;
    winRate: number;
    expectancy: number;
    timeInMarket: number;
  }>;
  equitySeries: Record<StrategyPresetKey, Array<{ t: string; eq: number; pos: number }>>;
}

// ═══════════════════════════════════════════════════════════════
// PRESETS
// ═══════════════════════════════════════════════════════════════

const STRATEGY_PRESETS: Record<StrategyPresetKey, StrategyPreset> = {
  conservative: {
    key: 'conservative',
    label: 'Conservative',
    thresholds: {
      minConfidence: 0.10,
      minReliability: 0.75,
      maxEntropy: 0.40,
      minStability: 0.75,
      maxTailP95DD: 0.45,
    },
    sizing: {
      baseRisk: 0.6,
      maxSize: 0.6,
    },
  },
  balanced: {
    key: 'balanced',
    label: 'Balanced',
    thresholds: {
      minConfidence: 0.05,
      minReliability: 0.60,
      maxEntropy: 0.60,
      minStability: 0.65,
      maxTailP95DD: 0.55,
    },
    sizing: {
      baseRisk: 0.8,
      maxSize: 0.8,
    },
  },
  aggressive: {
    key: 'aggressive',
    label: 'Aggressive',
    thresholds: {
      minConfidence: 0.02,
      minReliability: 0.50,
      maxEntropy: 0.80,
      minStability: 0.55,
      maxTailP95DD: 0.65,
    },
    sizing: {
      baseRisk: 1.0,
      maxSize: 1.0,
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// SIGNAL GENERATOR (ENGINE_ASOF mode)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate synthetic historical signals based on price action.
 * This is a simplified model for backtest - in production use actual snapshots.
 * 
 * Uses only data available up to date t.
 * 
 * Calibrated to produce realistic confidence/reliability/entropy values
 * that span across all preset thresholds.
 */
function generateSignalAsOf(
  bars: DailyBar[],
  idx: number
): SignalSnapshot {
  // We only use data up to idx (no future leak)
  const lookback = 60;
  const start = Math.max(0, idx - lookback);
  const windowBars = bars.slice(start, idx + 1);
  
  if (windowBars.length < 30) {
    return {
      t: bars[idx].t,
      confidence: 0.01,
      reliability: 0.50,
      entropy: 0.95,
      stability: 0.50,
      expectedReturn: 0,
      mcP95_DD: 0.50,
      action: 'HOLD'
    };
  }
  
  // Calculate momentum and volatility signals
  const closes = windowBars.map(b => b.close);
  const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  
  // Recent momentum (7-day)
  const recent7 = returns.slice(-7);
  const recentMean = recent7.reduce((a, b) => a + b, 0) / recent7.length;
  
  // Longer momentum (30-day)
  const recent30 = returns.slice(-30);
  const mean30 = recent30.reduce((a, b) => a + b, 0) / recent30.length;
  
  // Volatility
  const volatility = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);
  
  // SMA crossover signal
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.slice(-Math.min(50, closes.length)).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
  const trendSignal = (sma20 - sma50) / sma50;
  
  // Momentum strength (normalized)
  const momentum = recentMean / (volatility + 0.0001);
  const momentumAbs = Math.abs(momentum);
  
  // === CALIBRATED SIGNAL GENERATION ===
  
  // Confidence: 0.01 - 0.25
  // Strong trend = higher confidence
  // Scale: momentum of 2+ should give conf ~0.15-0.20
  const confBase = 0.03 + momentumAbs * 0.06;
  const confTrend = Math.abs(trendSignal) * 5;
  let confidence = Math.min(0.25, Math.max(0.01, confBase + confTrend));
  
  // Add some variation based on recent consistency
  const returnSigns = recent7.map(r => r > 0 ? 1 : -1);
  const consistency = Math.abs(returnSigns.reduce((a, b) => a + b, 0)) / 7;
  confidence *= (0.7 + consistency * 0.6);
  confidence = Math.min(0.25, Math.max(0.01, confidence));
  
  // Reliability: 0.50 - 0.95
  // Higher when trend is clear and volatility is moderate
  const reliabilityBase = 0.65;
  const reliabilityTrend = Math.min(0.2, Math.abs(trendSignal) * 3);
  const reliabilityVol = volatility < 0.02 ? 0.1 : volatility < 0.04 ? 0 : -0.1;
  let reliability = reliabilityBase + reliabilityTrend + reliabilityVol;
  reliability = Math.min(0.95, Math.max(0.45, reliability));
  
  // Entropy: 0.20 - 0.90
  // Higher when signals are mixed/unclear
  // Lower when trend is strong and consistent
  const entropyBase = 0.55;
  const entropyTrend = -Math.abs(trendSignal) * 2; // Strong trend = lower entropy
  const entropyVol = volatility * 3; // High vol = higher entropy
  const entropyConsistency = -(consistency - 0.5) * 0.3; // High consistency = lower entropy
  let entropy = entropyBase + entropyTrend + entropyVol + entropyConsistency;
  entropy = Math.min(0.90, Math.max(0.20, entropy));
  
  // Stability: 0.50 - 0.95
  // Higher when recent behavior matches longer-term
  const stabilityBase = 0.70;
  const stabilityAlign = Math.sign(recentMean) === Math.sign(mean30) ? 0.15 : -0.10;
  const stabilityVol = -volatility * 2;
  let stability = stabilityBase + stabilityAlign + stabilityVol;
  stability = Math.min(0.95, Math.max(0.50, stability));
  
  // Expected return based on momentum
  const expectedReturn = mean30 * 30; // 30-day projection
  
  // Tail risk from recent drawdown
  let maxDD = 0;
  let peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (peak - c) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const mcP95_DD = Math.min(0.70, Math.max(0.15, maxDD * 1.3 + 0.10));
  
  // Action determination
  let action: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
  if (momentum > 0.3 && trendSignal > 0.005) action = 'LONG';
  else if (momentum > 0.15 && trendSignal > 0.01) action = 'LONG';
  else if (momentum < -0.3 && trendSignal < -0.005) action = 'SHORT';
  
  return {
    t: bars[idx].t,
    confidence,
    reliability,
    entropy,
    stability,
    expectedReturn,
    mcP95_DD,
    action
  };
}

// ═══════════════════════════════════════════════════════════════
// POLICY APPLICATION
// ═══════════════════════════════════════════════════════════════

function applyPresetPolicy(
  signal: SignalSnapshot,
  preset: StrategyPreset
): { allowTrade: boolean; positionSize: number } {
  const { thresholds, sizing } = preset;
  
  // Check blockers
  const blockers: string[] = [];
  
  if (signal.confidence < thresholds.minConfidence) {
    blockers.push('LOW_CONFIDENCE');
  }
  if (signal.entropy > thresholds.maxEntropy) {
    blockers.push('HIGH_ENTROPY');
  }
  if (signal.reliability < thresholds.minReliability) {
    blockers.push('LOW_RELIABILITY');
  }
  if (signal.stability < thresholds.minStability) {
    blockers.push('LOW_STABILITY');
  }
  if (signal.mcP95_DD > thresholds.maxTailP95DD) {
    blockers.push('HIGH_TAIL_RISK');
  }
  
  const allowTrade = blockers.length === 0;
  
  if (!allowTrade) {
    return { allowTrade: false, positionSize: 0 };
  }
  
  // Calculate position size
  const rawSize = signal.confidence * signal.reliability * (1 - signal.entropy) * 3;
  const positionSize = Math.min(rawSize * sizing.baseRisk, sizing.maxSize);
  
  return { allowTrade, positionSize };
}

// ═══════════════════════════════════════════════════════════════
// EQUITY SIMULATOR
// ═══════════════════════════════════════════════════════════════

function simulateEquity(
  bars: DailyBar[],
  signals: SignalSnapshot[],
  preset: StrategyPreset,
  config: BacktestConfig
): { equitySeries: EquityPoint[]; trades: Trade[] } {
  const equitySeries: EquityPoint[] = [];
  const trades: Trade[] = [];
  
  const costBps = (config.feesBps + config.slippageBps) / 10000;
  
  let equity = 1.0;
  let position = 0;
  let entryPrice = 0;
  let entryDate: Date | null = null;
  
  for (let i = 60; i < bars.length && i < signals.length; i++) {
    const bar = bars[i];
    const signal = signals[i];
    const prevBar = bars[i - 1];
    
    // Get target position from policy
    const { allowTrade, positionSize } = applyPresetPolicy(signal, preset);
    let targetPosition = allowTrade && signal.action === 'LONG' ? positionSize : 0;
    
    // Calculate daily PnL from existing position
    const priceReturn = (bar.close - prevBar.close) / prevBar.close;
    const portfolioReturn = position * priceReturn;
    
    // Check if we need to trade
    const positionDelta = Math.abs(targetPosition - position);
    const tradeThreshold = 0.05;
    
    let tradeCost = 0;
    if (positionDelta >= tradeThreshold) {
      tradeCost = positionDelta * costBps;
      
      // Record trade if closing position
      if (position > 0.01 && targetPosition < position && entryDate) {
        trades.push({
          entryDate,
          exitDate: bar.t,
          entryPrice,
          exitPrice: bar.close,
          positionSize: position,
          pnl: (bar.close - entryPrice) / entryPrice * position,
          pnlPct: (bar.close - entryPrice) / entryPrice
        });
      }
      
      // Record new entry
      if (targetPosition > position) {
        entryPrice = bar.close;
        entryDate = bar.t;
      }
      
      position = targetPosition;
    }
    
    // Update equity
    const dailyReturn = portfolioReturn - tradeCost;
    equity *= (1 + dailyReturn);
    
    equitySeries.push({
      t: bar.t,
      equity,
      position,
      dailyReturn
    });
  }
  
  return { equitySeries, trades };
}

// ═══════════════════════════════════════════════════════════════
// MAIN BACKTEST SERVICE
// ═══════════════════════════════════════════════════════════════

export class StrategyBacktestService {
  private canonicalStore = new CanonicalStore();
  
  async runBacktestGrid(
    symbol: string,
    from: Date,
    to: Date,
    feesBps = 24,
    slippageBps = 24
  ): Promise<BacktestGridResult> {
    console.log(`[Backtest] Running grid for ${symbol} from ${from.toISOString()} to ${to.toISOString()}`);
    
    // Load canonical OHLCV data
    const candles = await this.canonicalStore.getRange(symbol, '1d', from, to);
    
    if (candles.length < 100) {
      throw new Error(`Insufficient data: ${candles.length} candles. Need at least 100.`);
    }
    
    // Convert to bars
    const bars: DailyBar[] = candles.map(c => ({
      t: c.ts,
      open: c.ohlcv.o,
      high: c.ohlcv.h,
      low: c.ohlcv.l,
      close: c.ohlcv.c
    }));
    
    console.log(`[Backtest] Loaded ${bars.length} bars`);
    
    // Generate signals (ENGINE_ASOF mode)
    const signals: SignalSnapshot[] = [];
    for (let i = 0; i < bars.length; i++) {
      signals.push(generateSignalAsOf(bars, i));
    }
    
    console.log(`[Backtest] Generated ${signals.length} signals`);
    
    const config: BacktestConfig = {
      symbol,
      from,
      to,
      feesBps,
      slippageBps,
      tradeOnClose: true
    };
    
    // Run simulation for each preset
    const results: PresetResult[] = [];
    
    for (const presetKey of ['conservative', 'balanced', 'aggressive'] as StrategyPresetKey[]) {
      const preset = STRATEGY_PRESETS[presetKey];
      const { equitySeries, trades } = simulateEquity(bars, signals, preset, config);
      const metrics = calcAllMetrics(equitySeries, trades);
      
      results.push({
        preset: presetKey,
        metrics,
        equitySeries,
        trades
      });
      
      console.log(`[Backtest] ${presetKey}: CAGR=${(metrics.cagr * 100).toFixed(1)}%, Sharpe=${metrics.sharpe.toFixed(2)}, MaxDD=${(metrics.maxDD * 100).toFixed(1)}%`);
    }
    
    // Format response
    const equitySeries: Record<StrategyPresetKey, Array<{ t: string; eq: number; pos: number }>> = {
      conservative: [],
      balanced: [],
      aggressive: []
    };
    
    for (const r of results) {
      // Sample every 7th point to reduce payload
      const sampled = r.equitySeries.filter((_, i) => i % 7 === 0 || i === r.equitySeries.length - 1);
      equitySeries[r.preset] = sampled.map(e => ({
        t: e.t.toISOString(),
        eq: Number(e.equity.toFixed(4)),
        pos: Number(e.position.toFixed(3))
      }));
    }
    
    return {
      symbol,
      tf: '1D',
      period: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
      },
      assumptions: {
        feesBps,
        slippageBps,
        tradeOnClose: true
      },
      signalSource: 'ENGINE_ASOF',
      results: results.map(r => ({
        preset: r.preset,
        cagr: Number(r.metrics.cagr.toFixed(4)),
        sharpe: Number(r.metrics.sharpe.toFixed(3)),
        maxDD: Number(r.metrics.maxDD.toFixed(4)),
        trades: r.metrics.trades,
        avgPosition: Number(r.metrics.avgPosition.toFixed(3)),
        winRate: Number(r.metrics.winRate.toFixed(3)),
        expectancy: Number(r.metrics.expectancy.toFixed(4)),
        timeInMarket: Number(r.metrics.timeInMarket.toFixed(3))
      })),
      equitySeries
    };
  }
  
  /**
   * Get worst drawdown segments
   */
  getWorstDrawdowns(
    equitySeries: EquityPoint[],
    topN = 5
  ): Array<{ start: Date; end: Date; depth: number; recovery: number | null }> {
    const drawdowns: Array<{ start: Date; end: Date; depth: number; recovery: number | null }> = [];
    
    let peak = equitySeries[0].equity;
    let peakIdx = 0;
    let inDrawdown = false;
    let ddStart = 0;
    let maxDepth = 0;
    
    for (let i = 1; i < equitySeries.length; i++) {
      const eq = equitySeries[i].equity;
      
      if (eq >= peak) {
        if (inDrawdown && maxDepth > 0.02) {
          // Recovered from drawdown
          drawdowns.push({
            start: equitySeries[ddStart].t,
            end: equitySeries[i].t,
            depth: maxDepth,
            recovery: i - ddStart
          });
        }
        peak = eq;
        peakIdx = i;
        inDrawdown = false;
        maxDepth = 0;
      } else {
        const dd = (peak - eq) / peak;
        if (!inDrawdown) {
          inDrawdown = true;
          ddStart = peakIdx;
        }
        if (dd > maxDepth) {
          maxDepth = dd;
        }
      }
    }
    
    // If still in drawdown at end
    if (inDrawdown && maxDepth > 0.02) {
      drawdowns.push({
        start: equitySeries[ddStart].t,
        end: equitySeries[equitySeries.length - 1].t,
        depth: maxDepth,
        recovery: null
      });
    }
    
    // Sort by depth and return top N
    return drawdowns
      .sort((a, b) => b.depth - a.depth)
      .slice(0, topN);
  }
}

// Export singleton
export const strategyBacktestService = new StrategyBacktestService();
