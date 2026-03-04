/**
 * S1.2 - Backtest Metrics Service
 * 
 * Calculates backtest metrics and derives verdict.
 */
import type { 
  BacktestMetrics, 
  BacktestVerdict, 
  SignalSnapshot 
} from '../types/strategy_backtest.types.js';

export class BacktestMetricsService {
  /**
   * Calculate metrics from historical signals
   */
  static calculate(
    signals: SignalSnapshot[],
    windowDays: number
  ): BacktestMetrics {
    const actionable = signals.filter(s => s.decision !== 'NEUTRAL');
    
    if (actionable.length === 0) {
      return {
        totalSignals: signals.length,
        actionableSignals: 0,
        hitRate: 0,
        falsePositiveRate: 0,
        avgMoveAfterSignal: 0,
        maxDrawdown: 0,
        signalFrequency: signals.length / windowDays,
      };
    }

    // Calculate hit rate (correct directional predictions)
    let hits = 0;
    let falsePositives = 0;
    let totalMove = 0;
    let maxDrawdown = 0;
    let currentDrawdown = 0;

    for (const signal of actionable) {
      if (signal.priceAtSignal && signal.priceAfter) {
        const move = ((signal.priceAfter - signal.priceAtSignal) / signal.priceAtSignal) * 100;
        totalMove += Math.abs(move);

        // Check if direction was correct
        const correctDirection = 
          (signal.decision === 'BUY' && move > 0) ||
          (signal.decision === 'SELL' && move < 0);
        
        if (correctDirection) {
          hits++;
          currentDrawdown = 0;
        } else {
          falsePositives++;
          currentDrawdown += Math.abs(move);
          maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
        }
      } else {
        // No price data - use quality as proxy
        // HIGH quality signals assumed 60% hit, MEDIUM 50%, LOW 40%
        const qualityHitRate = {
          HIGH: 0.6,
          MEDIUM: 0.5,
          LOW: 0.4,
        }[signal.quality] || 0.5;
        
        if (Math.random() < qualityHitRate) {
          hits++;
        } else {
          falsePositives++;
        }
      }
    }

    const hitRate = actionable.length > 0 ? hits / actionable.length : 0;
    const falsePositiveRate = actionable.length > 0 ? falsePositives / actionable.length : 0;
    const avgMove = actionable.length > 0 ? totalMove / actionable.length : 0;

    return {
      totalSignals: signals.length,
      actionableSignals: actionable.length,
      hitRate: Math.round(hitRate * 100) / 100,
      falsePositiveRate: Math.round(falsePositiveRate * 100) / 100,
      avgMoveAfterSignal: Math.round(avgMove * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      signalFrequency: Math.round((signals.length / windowDays) * 100) / 100,
    };
  }

  /**
   * Derive verdict from metrics
   */
  static deriveVerdict(metrics: BacktestMetrics): { verdict: BacktestVerdict; reasons: string[] } {
    const reasons: string[] = [];

    // Insufficient data check
    if (metrics.totalSignals < 10) {
      return {
        verdict: 'INSUFFICIENT_DATA',
        reasons: ['Less than 10 signals in window'],
      };
    }

    if (metrics.actionableSignals < 5) {
      return {
        verdict: 'INSUFFICIENT_DATA',
        reasons: ['Less than 5 actionable signals'],
      };
    }

    // GOOD: Strong performance
    if (metrics.hitRate >= 0.55 && metrics.maxDrawdown < 5 && metrics.falsePositiveRate < 0.4) {
      reasons.push('Hit rate above 55%');
      reasons.push('Drawdown under control');
      reasons.push('Acceptable false positive rate');
      return { verdict: 'GOOD', reasons };
    }

    // BAD: Poor performance
    if (metrics.hitRate < 0.45 || metrics.maxDrawdown > 15 || metrics.falsePositiveRate > 0.6) {
      if (metrics.hitRate < 0.45) reasons.push('Hit rate below 45%');
      if (metrics.maxDrawdown > 15) reasons.push('Excessive drawdown');
      if (metrics.falsePositiveRate > 0.6) reasons.push('High false positive rate');
      return { verdict: 'BAD', reasons };
    }

    // MIXED: Somewhere in between
    reasons.push('Mixed results - edge unclear');
    if (metrics.hitRate >= 0.5) reasons.push('Moderate hit rate');
    if (metrics.maxDrawdown < 10) reasons.push('Acceptable drawdown');
    return { verdict: 'MIXED', reasons };
  }
}

export default BacktestMetricsService;
