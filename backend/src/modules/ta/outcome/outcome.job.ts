/**
 * Outcome Job — Batch evaluation of past pattern predictions
 * 
 * Phase 5: Outcome Engine
 * 
 * This job:
 * 1. Fetches ta_decisions from past N days
 * 2. For each decision, loads the patterns
 * 3. Evaluates each pattern's outcome using candle data
 * 4. Writes results to ta_outcomes collection
 */

import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';
import { evaluateOutcome, extractTradePlan } from './outcome.evaluator.js';
import { OutcomeRecord, TradePlan, OutcomeEvalResult } from './outcome.types.js';
import { TAPatternDoc, TADecisionDoc, TARunDoc } from '../storage/ta-storage.service.js';

// ═══════════════════════════════════════════════════════════════
// Job Configuration
// ═══════════════════════════════════════════════════════════════

export type OutcomeJobConfig = {
  asset: string;
  lookbackDays: number;      // how far back to look for decisions
  timeoutBars: number;       // default timeout for patterns
  forceRecompute: boolean;   // recompute even if already evaluated
  horizon: string;           // e.g., "30D"
};

export const DEFAULT_OUTCOME_JOB_CONFIG: OutcomeJobConfig = {
  asset: 'SPX',
  lookbackDays: 60,
  timeoutBars: 30,
  forceRecompute: false,
  horizon: '30D',
};

// ═══════════════════════════════════════════════════════════════
// Job Result
// ═══════════════════════════════════════════════════════════════

export type OutcomeJobResult = {
  ok: boolean;
  asset: string;
  decisionsProcessed: number;
  patternsEvaluated: number;
  outcomes: {
    wins: number;
    losses: number;
    timeouts: number;
    pending: number;
    skipped: number;
  };
  errors: string[];
  durationMs: number;
};

// ═══════════════════════════════════════════════════════════════
// Outcome Job Service
// ═══════════════════════════════════════════════════════════════

export class OutcomeJobService {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) {
      this.db = getMongoDb();
    }
    return this.db;
  }

  /**
   * Run outcome evaluation job
   */
  async runJob(config: Partial<OutcomeJobConfig> = {}): Promise<OutcomeJobResult> {
    const cfg = { ...DEFAULT_OUTCOME_JOB_CONFIG, ...config };
    const startTime = Date.now();
    const db = this.getDb();
    const errors: string[] = [];

    const result: OutcomeJobResult = {
      ok: true,
      asset: cfg.asset,
      decisionsProcessed: 0,
      patternsEvaluated: 0,
      outcomes: { wins: 0, losses: 0, timeouts: 0, pending: 0, skipped: 0 },
      errors: [],
      durationMs: 0,
    };

    try {
      // 1. Get decisions from lookback period
      const since = new Date();
      since.setDate(since.getDate() - cfg.lookbackDays);

      const decisions = await db.collection('ta_decisions')
        .find({
          asset: cfg.asset,
          createdAt: { $gte: since },
        })
        .sort({ createdAt: -1 })
        .toArray() as TADecisionDoc[];

      console.log(`[Outcome Job] Found ${decisions.length} decisions for ${cfg.asset}`);

      // 2. Process each decision
      for (const decision of decisions) {
        try {
          await this.processDecision(db, decision, cfg, result);
          result.decisionsProcessed++;
        } catch (err) {
          errors.push(`Decision ${decision.runId}: ${err}`);
        }
      }

    } catch (err) {
      result.ok = false;
      errors.push(`Job failed: ${err}`);
    }

    result.errors = errors;
    result.durationMs = Date.now() - startTime;

    console.log(`[Outcome Job] Completed: ${result.patternsEvaluated} patterns, ${result.outcomes.wins} wins, ${result.outcomes.losses} losses`);

    return result;
  }

  /**
   * Process a single decision
   */
  private async processDecision(
    db: Db,
    decision: TADecisionDoc,
    cfg: OutcomeJobConfig,
    result: OutcomeJobResult
  ): Promise<void> {
    const { runId, topPatternIds } = decision;

    if (!topPatternIds || topPatternIds.length === 0) {
      return;
    }

    // Get patterns for this decision
    const patterns = await db.collection('ta_patterns')
      .find({ runId, patternId: { $in: topPatternIds } })
      .toArray() as TAPatternDoc[];

    // Get run info for entry timestamp
    const run = await db.collection('ta_runs')
      .findOne({ runId }) as TARunDoc | null;

    if (!run) {
      return;
    }

    // Load candles for outcome evaluation
    const candles = await this.loadCandles(db, cfg.asset, run.ts.getTime(), cfg.timeoutBars + 10);

    // Process each pattern
    for (const pattern of patterns) {
      await this.processPattern(db, pattern, run, candles, cfg, result);
    }
  }

  /**
   * Process a single pattern
   */
  private async processPattern(
    db: Db,
    pattern: TAPatternDoc,
    run: TARunDoc,
    candles: any[],
    cfg: OutcomeJobConfig,
    result: OutcomeJobResult
  ): Promise<void> {
    const { runId, patternId, asset } = pattern;

    // Check if already evaluated (unless forceRecompute)
    if (!cfg.forceRecompute) {
      const existing = await db.collection('ta_outcomes')
        .findOne({ runId, patternId });
      
      if (existing) {
        return; // Already evaluated
      }
    }

    // Extract trade plan from pattern
    const tradePlan = extractTradePlan({
      direction: pattern.direction,
      trade: pattern.trade,
    }, cfg.timeoutBars);

    if (!tradePlan) {
      // No valid trade plan - mark as skipped
      await this.saveOutcome(db, {
        runId,
        patternId,
        asset,
        tradePlan: { direction: 'LONG', entry: 0, stop: 0, target: 0, timeoutBars: 0 },
        result: 'SKIPPED',
        mfe: 0,
        mfePct: 0,
        mae: 0,
        maePct: 0,
        entryTs: run.ts.getTime(),
        evaluatedAt: new Date(),
        horizon: cfg.horizon,
        barsEvaluated: 0,
      });
      result.outcomes.skipped++;
      result.patternsEvaluated++;
      return;
    }

    // Evaluate outcome
    const evalResult = evaluateOutcome({
      tradePlan,
      candles,
      entryTs: run.ts.getTime(),
      tieBreak: 'LOSS_FIRST',
    });

    // Save outcome
    await this.saveOutcome(db, {
      runId,
      patternId,
      asset,
      tradePlan,
      result: evalResult.result,
      exitTs: evalResult.exitTs,
      exitPrice: evalResult.exitPrice,
      exitBar: evalResult.exitBar,
      exitReason: evalResult.exitReason,
      mfe: evalResult.mfe,
      mfePct: evalResult.mfePct,
      mae: evalResult.mae,
      maePct: evalResult.maePct,
      returnAbs: evalResult.returnAbs,
      returnPct: evalResult.returnPct,
      entryTs: run.ts.getTime(),
      evaluatedAt: new Date(),
      horizon: cfg.horizon,
      barsEvaluated: evalResult.barsEvaluated,
    });

    // Update counts
    result.patternsEvaluated++;
    switch (evalResult.result) {
      case 'WIN': result.outcomes.wins++; break;
      case 'LOSS': result.outcomes.losses++; break;
      case 'TIMEOUT': result.outcomes.timeouts++; break;
      case 'PENDING': result.outcomes.pending++; break;
      case 'SKIPPED': result.outcomes.skipped++; break;
    }
  }

  /**
   * Load candles after a given timestamp
   */
  private async loadCandles(
    db: Db,
    asset: string,
    afterTs: number,
    limit: number
  ): Promise<any[]> {
    let collection = 'fractal_canonical_ohlcv';
    if (asset.toUpperCase() === 'SPX') {
      collection = 'spx_candles';
    } else if (asset.toUpperCase() === 'DXY') {
      collection = 'dxy_candles';
    }

    const candles = await db.collection(collection)
      .find({ ts: { $gt: afterTs } })
      .sort({ ts: 1 })
      .limit(limit)
      .toArray();

    return candles.map((c: any) => ({
      ts: c.ts || new Date(c.date).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }

  /**
   * Save outcome to database
   */
  private async saveOutcome(db: Db, outcome: OutcomeRecord): Promise<void> {
    await db.collection('ta_outcomes').updateOne(
      { runId: outcome.runId, patternId: outcome.patternId },
      { $set: outcome },
      { upsert: true }
    );
  }

  /**
   * Get outcomes for a specific run
   */
  async getOutcomesByRun(runId: string): Promise<OutcomeRecord[]> {
    const db = this.getDb();
    return await db.collection('ta_outcomes')
      .find({ runId })
      .toArray() as OutcomeRecord[];
  }

  /**
   * Get latest outcomes for an asset
   */
  async getLatestOutcomes(asset: string, limit: number = 20): Promise<OutcomeRecord[]> {
    const db = this.getDb();
    return await db.collection('ta_outcomes')
      .find({ asset, result: { $ne: 'PENDING' } })
      .sort({ evaluatedAt: -1 })
      .limit(limit)
      .toArray() as OutcomeRecord[];
  }

  /**
   * Get performance summary
   */
  async getPerformance(asset: string, since?: Date): Promise<any> {
    const db = this.getDb();
    
    const query: any = { asset, result: { $in: ['WIN', 'LOSS', 'TIMEOUT'] } };
    if (since) {
      query.evaluatedAt = { $gte: since };
    }

    const outcomes = await db.collection('ta_outcomes')
      .find(query)
      .toArray() as OutcomeRecord[];

    if (outcomes.length === 0) {
      return {
        asset,
        totalEvaluated: 0,
        wins: 0,
        losses: 0,
        timeouts: 0,
        winRate: 0,
        avgReturnPct: 0,
        avgMfePct: 0,
        avgMaePct: 0,
      };
    }

    const wins = outcomes.filter(o => o.result === 'WIN');
    const losses = outcomes.filter(o => o.result === 'LOSS');
    const timeouts = outcomes.filter(o => o.result === 'TIMEOUT');

    const decisiveOutcomes = wins.length + losses.length;
    const winRate = decisiveOutcomes > 0 ? wins.length / decisiveOutcomes : 0;

    const avgReturnPct = outcomes.reduce((s, o) => s + (o.returnPct || 0), 0) / outcomes.length;
    const avgWinPct = wins.length > 0 ? wins.reduce((s, o) => s + (o.returnPct || 0), 0) / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((s, o) => s + (o.returnPct || 0), 0) / losses.length : 0;
    const avgMfePct = outcomes.reduce((s, o) => s + o.mfePct, 0) / outcomes.length;
    const avgMaePct = outcomes.reduce((s, o) => s + o.maePct, 0) / outcomes.length;

    const profitFactor = (avgLossPct !== 0 && losses.length > 0) 
      ? Math.abs((avgWinPct * wins.length) / (avgLossPct * losses.length))
      : 0;
    
    const expectancy = winRate * avgWinPct - (1 - winRate) * Math.abs(avgLossPct);

    // Group by pattern type
    const byPatternType: Record<string, any> = {};
    const patternIds = [...new Set(outcomes.map(o => o.patternId))];
    
    // Get pattern types from ta_patterns
    const patterns = await db.collection('ta_patterns')
      .find({ patternId: { $in: patternIds } })
      .toArray();
    
    const patternTypeMap = new Map(patterns.map(p => [p.patternId, p.type]));
    
    for (const outcome of outcomes) {
      const type = patternTypeMap.get(outcome.patternId) || 'UNKNOWN';
      if (!byPatternType[type]) {
        byPatternType[type] = { count: 0, wins: 0, losses: 0, timeouts: 0 };
      }
      byPatternType[type].count++;
      if (outcome.result === 'WIN') byPatternType[type].wins++;
      if (outcome.result === 'LOSS') byPatternType[type].losses++;
      if (outcome.result === 'TIMEOUT') byPatternType[type].timeouts++;
    }

    // Calculate win rates
    for (const type of Object.keys(byPatternType)) {
      const t = byPatternType[type];
      t.winRate = (t.wins + t.losses) > 0 ? t.wins / (t.wins + t.losses) : 0;
      t.winRate = Math.round(t.winRate * 100) / 100;
    }

    return {
      asset,
      since: since || 'all',
      totalEvaluated: outcomes.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      winRate: Math.round(winRate * 100) / 100,
      avgReturnPct: Math.round(avgReturnPct * 100) / 100,
      avgWinPct: Math.round(avgWinPct * 100) / 100,
      avgLossPct: Math.round(avgLossPct * 100) / 100,
      avgMfePct: Math.round(avgMfePct * 100) / 100,
      avgMaePct: Math.round(avgMaePct * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      byPatternType,
    };
  }

  /**
   * Initialize indexes
   */
  async initIndexes(): Promise<void> {
    const db = this.getDb();
    
    try {
      await db.collection('ta_outcomes').createIndex(
        { asset: 1, evaluatedAt: -1 },
        { background: true }
      );
      await db.collection('ta_outcomes').createIndex(
        { runId: 1 },
        { background: true }
      );
      await db.collection('ta_outcomes').createIndex(
        { patternId: 1 },
        { background: true }
      );
      await db.collection('ta_outcomes').createIndex(
        { result: 1 },
        { background: true }
      );
      await db.collection('ta_outcomes').createIndex(
        { runId: 1, patternId: 1 },
        { unique: true, background: true }
      );

      console.log('[Outcome Job] Indexes initialized');
    } catch (err) {
      console.error('[Outcome Job] Failed to create indexes:', err);
    }
  }
}

// Singleton instance
export const outcomeJobService = new OutcomeJobService();
