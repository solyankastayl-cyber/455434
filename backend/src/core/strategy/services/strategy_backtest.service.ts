/**
 * S1.2 - Strategy Backtest Service
 * 
 * Runs backtests on historical signals for strategy evaluation.
 */
import type {
  BacktestInput,
  BacktestResult,
  BacktestWindow,
  SignalSnapshot,
} from '../types/strategy_backtest.types.js';
import { StrategyBacktestModel } from '../models/strategy_backtest.model.js';
import { BacktestMetricsService } from './backtest_metrics.service.js';
import { getStrategyById, STRATEGY_CATALOG } from '../types/strategy.catalog.js';
import { StrategyEvaluationService } from './strategy_evaluation.service.js';

// Window duration in milliseconds
const WINDOW_MS: Record<BacktestWindow, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Window duration in days
const WINDOW_DAYS: Record<BacktestWindow, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

export class StrategyBacktestService {
  /**
   * Run backtest for a strategy
   */
  async runBacktest(input: BacktestInput): Promise<BacktestResult> {
    const strategy = getStrategyById(input.strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${input.strategyId} not found`);
    }

    const windowEnd = new Date();
    const windowStart = new Date(Date.now() - WINDOW_MS[input.window]);
    const windowDays = WINDOW_DAYS[input.window];

    // Load historical signals
    const signals = await this.loadHistoricalSignals(
      input.network,
      windowStart,
      windowEnd
    );

    // Calculate metrics
    const metrics = BacktestMetricsService.calculate(signals, windowDays);
    
    // Derive verdict
    const { verdict, reasons } = BacktestMetricsService.deriveVerdict(metrics);

    const result: BacktestResult = {
      strategyId: input.strategyId,
      strategyName: strategy.name,
      network: input.network,
      window: input.window,
      metrics,
      verdict,
      reasons,
      windowStart,
      windowEnd,
      createdAt: new Date(),
    };

    // Save to database
    await StrategyBacktestModel.create(result);

    return result;
  }

  /**
   * Get latest backtest results for a strategy
   */
  async getBacktestHistory(
    strategyId: string,
    network?: string,
    limit: number = 10
  ): Promise<BacktestResult[]> {
    const query: any = { strategyId };
    if (network) query.network = network;

    const results = await StrategyBacktestModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return results.map(r => ({
      ...r,
      _id: undefined,
    })) as BacktestResult[];
  }

  /**
   * Run backtest for all strategies on a network
   */
  async runAllBacktests(
    network: 'ethereum' | 'bnb',
    window: BacktestWindow = '14d'
  ): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    for (const strategy of STRATEGY_CATALOG) {
      if (strategy.active && strategy.networks.includes(network)) {
        try {
          const result = await this.runBacktest({
            strategyId: strategy.id,
            network,
            window,
          });
          results.push(result);
        } catch (err) {
          console.error(`[Backtest] Failed for ${strategy.id}:`, err);
        }
      }
    }

    return results;
  }

  /**
   * Load historical signals from database
   * 
   * Note: In production, this would query a signals_history collection.
   * For now, we generate synthetic data based on current signals.
   */
  private async loadHistoricalSignals(
    network: string,
    from: Date,
    to: Date
  ): Promise<SignalSnapshot[]> {
    // Try to load from signals history collection
    try {
      const db = (await import('mongoose')).default.connection.db;
      if (!db) throw new Error('No DB connection');

      const collection = db.collection('signal_snapshots');
      const snapshots = await collection
        .find({
          network,
          timestamp: { $gte: from.getTime(), $lte: to.getTime() },
        })
        .sort({ timestamp: -1 })
        .limit(500)
        .toArray();

      if (snapshots.length > 0) {
        return snapshots as SignalSnapshot[];
      }
    } catch (err) {
      // Collection might not exist yet
    }

    // Generate synthetic historical data for testing
    return this.generateSyntheticSignals(network, from, to);
  }

  /**
   * Generate synthetic signals for testing
   * In production, replace with real historical data
   */
  private generateSyntheticSignals(
    network: string,
    from: Date,
    to: Date
  ): SignalSnapshot[] {
    const signals: SignalSnapshot[] = [];
    const decisions: Array<'BUY' | 'SELL' | 'NEUTRAL'> = ['BUY', 'SELL', 'NEUTRAL'];
    const qualities: Array<'HIGH' | 'MEDIUM' | 'LOW'> = ['HIGH', 'MEDIUM', 'LOW'];
    
    const intervalMs = 4 * 60 * 60 * 1000; // Every 4 hours
    let currentTime = from.getTime();
    let basePrice = network === 'ethereum' ? 3500 : 600;

    while (currentTime < to.getTime()) {
      // Randomize decision with bias toward NEUTRAL
      const decision = decisions[Math.floor(Math.random() * decisions.length)];
      const quality = qualities[Math.floor(Math.random() * qualities.length)];
      
      // Simulate price movement
      const priceChange = (Math.random() - 0.5) * 0.05; // ±2.5%
      const priceAtSignal = basePrice;
      basePrice = basePrice * (1 + priceChange);
      const priceAfter = basePrice;

      signals.push({
        network,
        decision,
        quality,
        drivers: {
          A: { state: 'NEUTRAL', strength: 'MEDIUM' },
          B: { state: 'NEUTRAL', strength: 'MEDIUM' },
          C: { state: 'NEUTRAL', strength: 'LOW' },
          D: { state: 'STABLE', strength: 'MEDIUM' },
          E: { state: 'NEUTRAL', strength: 'LOW' },
          F: { state: 'QUIET', strength: 'LOW' },
        },
        timestamp: currentTime,
        priceAtSignal,
        priceAfter,
      });

      currentTime += intervalMs;
    }

    return signals;
  }
}

export default StrategyBacktestService;
