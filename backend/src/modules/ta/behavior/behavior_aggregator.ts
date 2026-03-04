/**
 * Phase AE1: Behaviour Aggregator
 * 
 * Computes statistics from scenario behaviour data:
 * - Pattern success rates
 * - Conditional performance (pattern + context)
 * - Behaviour key stats
 * 
 * This is where the system learns "when patterns actually work"
 */

import { Collection } from 'mongodb';
import { 
  ScenarioBehaviour, 
  ScenarioContext,
  OutcomeStatus
} from './behavior_types.js';
import { getBehaviourStorage } from './behavior_storage.js';

// ═══════════════════════════════════════════════════════════════
// STATS TYPES
// ═══════════════════════════════════════════════════════════════

export type PatternStats = {
  patternType: string;
  total: number;
  wins: number;
  losses: number;
  timeouts: number;
  
  successRate: number;           // wins / (wins + losses)
  winRate: number;               // wins / total (including timeouts)
  
  avgReturn: number;             // Average return on wins
  avgLoss: number;               // Average loss on losses
  expectancy: number;            // (winRate * avgReturn) - ((1-winRate) * avgLoss)
  
  avgMFE: number;                // Average maximum favorable excursion
  avgMAE: number;                // Average maximum adverse excursion
  
  avgBarsToWin: number;
  avgBarsToLoss: number;
  
  profitFactor: number;          // Total profits / Total losses
  
  confidence: number;            // Statistical confidence (based on sample size)
};

export type ConditionalStats = {
  patternType: string;
  condition: string;
  conditionValue: string;
  
  samples: number;
  
  successRate: number;
  winRate: number;
  avgReturn: number;
  
  lift: number;                  // Improvement over base rate
};

export type BehaviourKeyStats = {
  behaviourKey: string;
  label: string;
  
  patternType: string;
  entryType: string;
  stopType: string;
  targetType: string;
  timeframe: string;
  
  total: number;
  successRate: number;
  avgRMultiple: number;
  avgMFE: number;
  avgMAE: number;
};

export type TopPatternRanking = {
  patternType: string;
  successRate: number;
  samples: number;
  expectancy: number;
  rank: number;
};

// ═══════════════════════════════════════════════════════════════
// AGGREGATOR CLASS
// ═══════════════════════════════════════════════════════════════

export class BehaviourAggregator {
  private collection: Collection<ScenarioBehaviour>;

  constructor(collection: Collection<ScenarioBehaviour>) {
    this.collection = collection;
  }

  /**
   * Compute stats for a specific pattern type
   */
  async computePatternStats(patternType: string): Promise<PatternStats | null> {
    const rows = await this.collection
      .find({ 
        patternType,
        'outcome.status': { $in: ['WIN', 'LOSS', 'TIMEOUT'] }
      })
      .toArray();

    if (rows.length === 0) return null;

    const wins = rows.filter(r => r.outcome.status === 'WIN');
    const losses = rows.filter(r => r.outcome.status === 'LOSS');
    const timeouts = rows.filter(r => r.outcome.status === 'TIMEOUT');

    const total = rows.length;
    const winCount = wins.length;
    const lossCount = losses.length;
    const timeoutCount = timeouts.length;

    const resolved = winCount + lossCount;
    const successRate = resolved > 0 ? winCount / resolved : 0;
    const winRate = winCount / total;

    // Average returns
    const avgReturn = wins.length > 0
      ? wins.reduce((sum, w) => sum + (w.outcome.mfe || 0), 0) / wins.length
      : 0;
    
    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((sum, l) => sum + (l.outcome.mae || 0), 0) / losses.length)
      : 0;

    // Expectancy
    const expectancy = (winRate * avgReturn) - ((1 - winRate) * avgLoss);

    // MFE/MAE
    const avgMFE = rows.reduce((sum, r) => sum + (r.outcome.mfe || 0), 0) / total;
    const avgMAE = rows.reduce((sum, r) => sum + Math.abs(r.outcome.mae || 0), 0) / total;

    // Time to outcome
    const avgBarsToWin = wins.length > 0
      ? wins.reduce((sum, w) => sum + w.outcome.barsToOutcome, 0) / wins.length
      : 0;
    
    const avgBarsToLoss = losses.length > 0
      ? losses.reduce((sum, l) => sum + l.outcome.barsToOutcome, 0) / losses.length
      : 0;

    // Profit factor
    const totalProfit = wins.reduce((sum, w) => sum + (w.outcome.mfe || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, l) => sum + (l.outcome.mae || 0), 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    // Confidence based on sample size (using Wilson score interval concept)
    const confidence = this.calculateConfidence(total, successRate);

    return {
      patternType,
      total,
      wins: winCount,
      losses: lossCount,
      timeouts: timeoutCount,
      successRate,
      winRate,
      avgReturn,
      avgLoss,
      expectancy,
      avgMFE,
      avgMAE,
      avgBarsToWin,
      avgBarsToLoss,
      profitFactor,
      confidence,
    };
  }

  /**
   * Compute conditional stats (pattern + context condition)
   */
  async computeConditionalStats(
    patternType: string,
    condition: keyof ScenarioContext,
    conditionValue: any
  ): Promise<ConditionalStats | null> {
    const query: any = {
      patternType,
      'outcome.status': { $in: ['WIN', 'LOSS'] },
      [`context.${condition}`]: conditionValue,
    };

    const rows = await this.collection.find(query).toArray();
    if (rows.length < 5) return null; // Need minimum samples

    const wins = rows.filter(r => r.outcome.status === 'WIN').length;
    const successRate = wins / rows.length;

    const avgReturn = rows
      .filter(r => r.outcome.status === 'WIN')
      .reduce((sum, r) => sum + (r.outcome.mfe || 0), 0) / (wins || 1);

    // Get base rate for lift calculation
    const baseStats = await this.computePatternStats(patternType);
    const baseRate = baseStats?.successRate || 0.5;
    const lift = baseRate > 0 ? (successRate - baseRate) / baseRate : 0;

    return {
      patternType,
      condition: String(condition),
      conditionValue: String(conditionValue),
      samples: rows.length,
      successRate,
      winRate: successRate,
      avgReturn,
      lift,
    };
  }

  /**
   * Compute stats grouped by behaviour key
   */
  async computeBehaviourKeyStats(behaviourKey: string): Promise<BehaviourKeyStats | null> {
    const rows = await this.collection
      .find({ 
        behaviourKey,
        'outcome.status': { $in: ['WIN', 'LOSS', 'TIMEOUT'] }
      })
      .toArray();

    if (rows.length === 0) return null;

    const first = rows[0];
    const wins = rows.filter(r => r.outcome.status === 'WIN');
    const resolved = rows.filter(r => ['WIN', 'LOSS'].includes(r.outcome.status));

    const successRate = resolved.length > 0 ? wins.length / resolved.length : 0;
    
    const avgRMultiple = rows
      .filter(r => r.outcome.rMultiple !== undefined)
      .reduce((sum, r) => sum + (r.outcome.rMultiple || 0), 0) / (rows.length || 1);

    const avgMFE = rows.reduce((sum, r) => sum + (r.outcome.mfe || 0), 0) / rows.length;
    const avgMAE = rows.reduce((sum, r) => sum + Math.abs(r.outcome.mae || 0), 0) / rows.length;

    return {
      behaviourKey,
      label: `${first.patternType}:${first.protocol.entryType}:${first.protocol.stopType}:${first.protocol.targetType}:${first.timeframe}`,
      patternType: first.patternType,
      entryType: first.protocol.entryType,
      stopType: first.protocol.stopType,
      targetType: first.protocol.targetType,
      timeframe: first.timeframe,
      total: rows.length,
      successRate,
      avgRMultiple,
      avgMFE,
      avgMAE,
    };
  }

  /**
   * Get top performing patterns
   */
  async getTopPatterns(
    minSamples: number = 10,
    limit: number = 20
  ): Promise<TopPatternRanking[]> {
    const pipeline = [
      {
        $match: {
          'outcome.status': { $in: ['WIN', 'LOSS'] }
        }
      },
      {
        $group: {
          _id: '$patternType',
          total: { $sum: 1 },
          wins: {
            $sum: { $cond: [{ $eq: ['$outcome.status', 'WIN'] }, 1, 0] }
          },
          totalMFE: {
            $sum: { $cond: [{ $eq: ['$outcome.status', 'WIN'] }, '$outcome.mfe', 0] }
          },
          totalMAE: {
            $sum: { $cond: [{ $eq: ['$outcome.status', 'LOSS'] }, '$outcome.mae', 0] }
          }
        }
      },
      {
        $match: { total: { $gte: minSamples } }
      },
      {
        $project: {
          patternType: '$_id',
          samples: '$total',
          successRate: { $divide: ['$wins', '$total'] },
          avgReturn: { 
            $cond: [
              { $gt: ['$wins', 0] },
              { $divide: ['$totalMFE', '$wins'] },
              0
            ]
          },
          avgLoss: {
            $cond: [
              { $gt: [{ $subtract: ['$total', '$wins'] }, 0] },
              { $divide: ['$totalMAE', { $subtract: ['$total', '$wins'] }] },
              0
            ]
          }
        }
      },
      {
        $addFields: {
          expectancy: {
            $subtract: [
              { $multiply: ['$successRate', '$avgReturn'] },
              { $multiply: [{ $subtract: [1, '$successRate'] }, { $abs: '$avgLoss' }] }
            ]
          }
        }
      },
      {
        $sort: { expectancy: -1 }
      },
      {
        $limit: limit
      }
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    
    return results.map((r, i) => ({
      patternType: r.patternType,
      successRate: r.successRate,
      samples: r.samples,
      expectancy: r.expectancy,
      rank: i + 1,
    }));
  }

  /**
   * Get all unique behaviour keys with counts
   */
  async getBehaviourKeySummary(): Promise<Array<{ key: string; count: number }>> {
    const pipeline = [
      {
        $group: {
          _id: '$behaviourKey',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    return results.map(r => ({ key: r._id, count: r.count }));
  }

  /**
   * Get conditions that improve success rate
   */
  async getConditionBoosts(
    patternType: string
  ): Promise<ConditionalStats[]> {
    const conditions: Array<{ field: keyof ScenarioContext; values: any[] }> = [
      { field: 'volumeSpike', values: [true, false] },
      { field: 'maAlignment', values: [true, false] },
      { field: 'regime', values: ['STRONG_UP', 'WEAK_UP', 'RANGE', 'WEAK_DOWN', 'STRONG_DOWN'] },
      { field: 'volatility', values: ['LOW', 'NORMAL', 'HIGH', 'EXTREME'] },
      { field: 'rsiZone', values: ['OVERSOLD', 'NEUTRAL', 'OVERBOUGHT'] },
    ];

    const boosts: ConditionalStats[] = [];

    for (const { field, values } of conditions) {
      for (const value of values) {
        const stats = await this.computeConditionalStats(patternType, field, value);
        if (stats && stats.samples >= 5) {
          boosts.push(stats);
        }
      }
    }

    // Sort by lift (improvement over base)
    return boosts.sort((a, b) => b.lift - a.lift);
  }

  /**
   * Calculate statistical confidence based on sample size
   * Uses Wilson score interval approximation
   */
  private calculateConfidence(n: number, p: number): number {
    if (n === 0) return 0;
    
    // Confidence increases with sample size
    // 30+ samples = high confidence
    // 10-30 = medium
    // <10 = low
    
    const z = 1.96; // 95% confidence
    const denominator = 1 + z * z / n;
    const centre = p + z * z / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    
    // Return confidence as 0-1 score
    const intervalWidth = 2 * margin / denominator;
    return Math.max(0, Math.min(1, 1 - intervalWidth));
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

export function createBehaviourAggregator(): BehaviourAggregator | null {
  const storage = getBehaviourStorage();
  if (!storage) return null;
  
  return new BehaviourAggregator(storage.getCollection());
}
