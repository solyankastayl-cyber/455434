/**
 * Outcome Engine - Tracks and evaluates pattern outcomes
 * 
 * Responsibilities:
 * - Track active patterns
 * - Check for target/stop hits
 * - Record outcomes
 * - Update statistics
 */

import { getMongoDb } from '../../../db/mongoose.js';
import { TaPatternModel, ITaPattern } from '../models/ta_pattern.model.js';
import { TaOutcomeModel, ITaOutcome } from '../models/ta_outcome.model.js';
import { TaStatisticsModel } from '../models/ta_statistics.model.js';
import { v4 as uuid } from 'uuid';

export interface OutcomeCheckResult {
  patternId: string;
  result: 'WIN' | 'LOSS' | 'PARTIAL' | 'PENDING';
  exitPrice?: number;
  returnPct?: number;
}

export class OutcomeEngine {
  /**
   * Check all active patterns for outcome
   */
  async checkActivePatterns(asset: string, currentPrice: number): Promise<OutcomeCheckResult[]> {
    const results: OutcomeCheckResult[] = [];
    
    // Find active patterns for this asset
    const activePatterns = await TaPatternModel.find({
      asset,
      status: 'ACTIVE'
    });

    for (const pattern of activePatterns) {
      const result = await this.evaluatePattern(pattern, currentPrice);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Evaluate a single pattern against current price
   */
  private async evaluatePattern(
    pattern: ITaPattern,
    currentPrice: number
  ): Promise<OutcomeCheckResult | null> {
    const { targetPrice, stopPrice, entryPrice, direction } = pattern;
    
    // Skip if no target/stop defined
    if (!targetPrice || !stopPrice) {
      return null;
    }

    let result: 'WIN' | 'LOSS' | 'PARTIAL' | 'PENDING' = 'PENDING';
    let exitPrice: number | undefined;

    if (direction === 'BULLISH') {
      if (currentPrice >= targetPrice) {
        result = 'WIN';
        exitPrice = targetPrice;
      } else if (currentPrice <= stopPrice) {
        result = 'LOSS';
        exitPrice = stopPrice;
      }
    } else if (direction === 'BEARISH') {
      if (currentPrice <= targetPrice) {
        result = 'WIN';
        exitPrice = targetPrice;
      } else if (currentPrice >= stopPrice) {
        result = 'LOSS';
        exitPrice = stopPrice;
      }
    }

    if (result !== 'PENDING') {
      // Record outcome
      await this.recordOutcome(pattern, result, exitPrice!);
      
      // Update pattern status
      await TaPatternModel.findByIdAndUpdate(pattern._id, {
        status: result === 'WIN' ? 'TRIGGERED' : 'INVALIDATED'
      });

      return {
        patternId: pattern.patternId,
        result,
        exitPrice,
        returnPct: this.calculateReturn(entryPrice, exitPrice!, direction)
      };
    }

    return null;
  }

  /**
   * Record outcome to database
   */
  async recordOutcome(
    pattern: ITaPattern,
    result: 'WIN' | 'LOSS' | 'PARTIAL',
    exitPrice: number
  ): Promise<void> {
    const returnPct = this.calculateReturn(
      pattern.entryPrice,
      exitPrice,
      pattern.direction
    );

    const outcome = new TaOutcomeModel({
      outcomeId: `outcome_${uuid()}`,
      patternId: pattern.patternId,
      asset: pattern.asset,
      patternType: pattern.patternType,
      direction: pattern.direction,
      entryPrice: pattern.entryPrice,
      targetPrice: pattern.targetPrice,
      stopPrice: pattern.stopPrice,
      result,
      exitPrice,
      returnPct,
      entryTime: pattern.detectedAt,
      exitTime: new Date(),
      evaluatedAt: new Date(),
      confidenceAtEntry: pattern.confidence
    });

    await outcome.save();

    // Update statistics
    await this.updateStatistics(pattern.asset, pattern.patternType, pattern.metadata?.timeframe || '1D');
  }

  /**
   * Calculate return percentage
   */
  private calculateReturn(
    entryPrice: number,
    exitPrice: number,
    direction: string
  ): number {
    if (direction === 'BULLISH') {
      return ((exitPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - exitPrice) / entryPrice) * 100;
    }
  }

  /**
   * Update pattern statistics
   */
  async updateStatistics(
    asset: string,
    patternType: string,
    timeframe: string
  ): Promise<void> {
    // Aggregate outcomes
    const outcomes = await TaOutcomeModel.find({
      asset,
      patternType,
      result: { $ne: 'PENDING' }
    });

    if (outcomes.length === 0) return;

    const wins = outcomes.filter(o => o.result === 'WIN').length;
    const losses = outcomes.filter(o => o.result === 'LOSS').length;
    const partials = outcomes.filter(o => o.result === 'PARTIAL').length;
    
    const winRate = wins / outcomes.length;
    
    const returns = outcomes.map(o => o.returnPct || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    
    const winReturns = outcomes.filter(o => o.result === 'WIN').map(o => o.returnPct || 0);
    const lossReturns = outcomes.filter(o => o.result === 'LOSS').map(o => o.returnPct || 0);
    
    const avgWin = winReturns.length > 0 
      ? winReturns.reduce((a, b) => a + b, 0) / winReturns.length 
      : 0;
    const avgLoss = lossReturns.length > 0 
      ? Math.abs(lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length)
      : 0;
    
    const profitFactor = avgLoss > 0 ? (avgWin * wins) / (avgLoss * losses) : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Find date range
    const dates = outcomes.map(o => o.entryTime).sort();
    
    await TaStatisticsModel.findOneAndUpdate(
      { asset, patternType, timeframe },
      {
        $set: {
          statsId: `stats_${asset}_${patternType}_${timeframe}`,
          totalSignals: outcomes.length,
          wins,
          losses,
          partials,
          winRate: Math.round(winRate * 100) / 100,
          avgReturn: Math.round(avgReturn * 100) / 100,
          avgWin: Math.round(avgWin * 100) / 100,
          avgLoss: Math.round(avgLoss * 100) / 100,
          profitFactor: Math.round(profitFactor * 100) / 100,
          expectancy: Math.round(expectancy * 100) / 100,
          periodStart: dates[0],
          periodEnd: dates[dates.length - 1],
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
  }

  /**
   * Get statistics for asset/pattern
   */
  async getStatistics(asset: string, patternType?: string): Promise<any[]> {
    const query: any = { asset };
    if (patternType) query.patternType = patternType;
    
    return TaStatisticsModel.find(query).sort({ winRate: -1 });
  }

  /**
   * Get recent outcomes
   */
  async getRecentOutcomes(asset: string, limit: number = 20): Promise<any[]> {
    return TaOutcomeModel.find({ asset })
      .sort({ exitTime: -1 })
      .limit(limit);
  }
}
