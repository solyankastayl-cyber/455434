/**
 * TA Storage Service — Persistence layer for audit trail
 * 
 * Phase 4: Pattern Storage + Audit Trail
 * 
 * Collections:
 * - ta_runs: Each analysis run with context snapshot
 * - ta_patterns: All detected candidate patterns
 * - ta_decisions: Final top-K selection
 * - ta_outcomes: Pattern results (Phase 5)
 */

import crypto from 'crypto';
import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';
import { ScoredPattern } from '../scoring/score.js';
import { TAContext, MarketRegime } from '../domain/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type TARunDoc = {
  runId: string;
  asset: string;
  timeframe: string;
  ts: Date;
  engineVersion: string;
  configHash: string;
  candles: {
    startTs: number;
    endTs: number;
    bars: number;
  };
  contextSnapshot: {
    regime: MarketRegime;
    volatility: number;
    compression: number;
    hhhlScore: number;
    pivotCount: number;
    levelCount: number;
  };
  createdAt: Date;
};

export type TAPatternDoc = {
  runId: string;
  asset: string;
  patternId: string;
  type: string;
  direction: string;
  startIdx: number;
  endIdx: number;
  startTs: number;
  endTs: number;
  geometry: Record<string, any>;
  metrics: Record<string, any>;
  scoring: {
    score: number;
    confidence: number;
    reasons: Array<{
      factor: string;
      value: number;
      weight: number;
      contribution: number;
    }>;
  };
  trade?: {
    entry: number;
    stop: number;
    target1: number;
    target2?: number;
    riskReward: number;
  };
  rank: number;
  createdAt: Date;
};

export type TADecisionDoc = {
  runId: string;
  asset: string;
  timeframe: string;
  decisionType: 'pattern';
  primaryPatternId: string | null;
  secondaryPatternId: string | null;
  topPatternIds: string[];
  totalCandidates: number;
  droppedCount: number;
  createdAt: Date;
};

// ═══════════════════════════════════════════════════════════════
// Phase F: Hypothesis & Scenario Types (Immutable Audit Trail)
// ═══════════════════════════════════════════════════════════════

export type TAHypothesisDoc = {
  runId: string;
  hypothesisId: string;
  asset: string;
  timeframe: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  score: number;
  components: Array<{
    type: string;
    group: string;
    direction: string;
    score: number;
  }>;
  reasons: string[];
  createdAt: Date;
};

export type TAScenarioDoc = {
  runId: string;
  scenarioId: string;
  hypothesisId: string;
  rank: number;
  asset: string;
  timeframe: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  score: number;
  probability: number;
  probabilitySource: 'CALIBRATED' | 'FALLBACK';
  components: Array<{
    type: string;
    group: string;
    direction: string;
    score: number;
  }>;
  intent: {
    bias: 'LONG' | 'SHORT' | 'WAIT';
    confidence: 'LOW' | 'MED' | 'HIGH';
  };
  riskPack?: {
    valid: boolean;
    entry?: number | null;
    stop?: number | null;
    target1?: number | null;
    rrToT1?: number | null;
  };
  createdAt: Date;
};

// ═══════════════════════════════════════════════════════════════
// Storage Service
// ═══════════════════════════════════════════════════════════════

export class TAStorageService {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) {
      this.db = getMongoDb();
    }
    return this.db;
  }

  /**
   * Save a TA analysis run
   */
  async saveTARun(
    asset: string,
    timeframe: string,
    ctx: TAContext,
    configHash: string = 'default'
  ): Promise<string> {
    const db = this.getDb();
    const runId = crypto.randomUUID();

    const candles = ctx.series.candles;
    const lastAtr = ctx.atr[ctx.atr.length - 1] || 0;
    const lastPrice = candles[candles.length - 1]?.close || 0;

    const runDoc: TARunDoc = {
      runId,
      asset,
      timeframe,
      ts: new Date(),
      engineVersion: 'TA_v2.0',
      configHash,
      candles: {
        startTs: candles[0]?.ts || 0,
        endTs: candles[candles.length - 1]?.ts || 0,
        bars: candles.length,
      },
      contextSnapshot: {
        regime: ctx.structure.regime,
        volatility: lastPrice > 0 ? lastAtr / lastPrice : 0,
        compression: ctx.structure.compressionScore,
        hhhlScore: ctx.structure.hhhlScore,
        pivotCount: ctx.pivots.length,
        levelCount: ctx.levels.length,
      },
      createdAt: new Date(),
    };

    await db.collection('ta_runs').insertOne(runDoc);
    console.log(`[TA Storage] Saved run ${runId} for ${asset}`);

    return runId;
  }

  /**
   * Save all detected patterns from a run
   */
  async savePatterns(
    runId: string,
    asset: string,
    patterns: ScoredPattern[]
  ): Promise<void> {
    if (patterns.length === 0) return;

    const db = this.getDb();
    const now = new Date();

    const docs: TAPatternDoc[] = patterns.map((p, i) => ({
      runId,
      asset,
      patternId: p.id,
      type: p.type,
      direction: p.direction,
      startIdx: p.startIdx,
      endIdx: p.endIdx,
      startTs: p.startTs,
      endTs: p.endTs,
      geometry: p.geometry,
      metrics: p.metrics,
      scoring: {
        score: p.scoring.score,
        confidence: p.scoring.confidence,
        reasons: p.scoring.reasons,
      },
      trade: p.trade,
      rank: i + 1,
      createdAt: now,
    }));

    await db.collection('ta_patterns').insertMany(docs);
    console.log(`[TA Storage] Saved ${docs.length} patterns for run ${runId}`);
  }

  /**
   * Save the final decision (top-K selection)
   */
  async saveDecision(
    runId: string,
    asset: string,
    timeframe: string,
    top: ScoredPattern[],
    totalCandidates: number,
    droppedCount: number
  ): Promise<void> {
    const db = this.getDb();

    const decisionDoc: TADecisionDoc = {
      runId,
      asset,
      timeframe,
      decisionType: 'pattern',
      primaryPatternId: top[0]?.id ?? null,
      secondaryPatternId: top[1]?.id ?? null,
      topPatternIds: top.map(p => p.id),
      totalCandidates,
      droppedCount,
      createdAt: new Date(),
    };

    await db.collection('ta_decisions').insertOne(decisionDoc);
    console.log(`[TA Storage] Saved decision for run ${runId}: ${top.length} patterns selected`);
  }

  /**
   * Get the latest run for an asset
   */
  async getLatestRun(asset: string): Promise<{
    run: TARunDoc | null;
    patterns: TAPatternDoc[];
    decision: TADecisionDoc | null;
  }> {
    const db = this.getDb();

    const run = await db.collection('ta_runs')
      .find({ asset })
      .sort({ createdAt: -1 })
      .limit(1)
      .next() as TARunDoc | null;

    if (!run) {
      return { run: null, patterns: [], decision: null };
    }

    const patterns = await db.collection('ta_patterns')
      .find({ runId: run.runId })
      .sort({ rank: 1 })
      .toArray() as TAPatternDoc[];

    const decision = await db.collection('ta_decisions')
      .findOne({ runId: run.runId }) as TADecisionDoc | null;

    return { run, patterns, decision };
  }

  /**
   * Get a specific run by ID
   */
  async getRunById(runId: string): Promise<{
    run: TARunDoc | null;
    patterns: TAPatternDoc[];
    decision: TADecisionDoc | null;
  }> {
    const db = this.getDb();

    const run = await db.collection('ta_runs')
      .findOne({ runId }) as TARunDoc | null;

    if (!run) {
      return { run: null, patterns: [], decision: null };
    }

    const patterns = await db.collection('ta_patterns')
      .find({ runId })
      .sort({ rank: 1 })
      .toArray() as TAPatternDoc[];

    const decision = await db.collection('ta_decisions')
      .findOne({ runId }) as TADecisionDoc | null;

    return { run, patterns, decision };
  }

  /**
   * List recent runs for an asset
   */
  async listRuns(asset: string, limit: number = 10): Promise<TARunDoc[]> {
    const db = this.getDb();

    return await db.collection('ta_runs')
      .find({ asset })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as TARunDoc[];
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase F: Hypothesis & Scenario Storage (IMMUTABLE - INSERT ONLY)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Save hypotheses from a run (IMMUTABLE)
   */
  async saveHypotheses(runId: string, hypotheses: any[]): Promise<void> {
    if (!hypotheses.length) return;
    const db = this.getDb();
    const now = new Date();

    const docs: TAHypothesisDoc[] = hypotheses.map(h => ({
      runId,
      hypothesisId: h.id,
      asset: h.symbol || h.asset || '',
      timeframe: h.timeframe || '1D',
      direction: h.direction,
      score: h.score,
      components: h.components.map((c: any) => ({
        type: c.type,
        group: c.group,
        direction: c.direction,
        score: c.finalScore || c.score,
      })),
      reasons: h.reasons || [],
      createdAt: now,
    }));

    await db.collection('ta_hypotheses').insertMany(docs);
    console.log(`[TA Storage] Saved ${docs.length} hypotheses for run ${runId}`);
  }

  /**
   * Save scenarios from Decision Pack (IMMUTABLE)
   */
  async saveScenarios(runId: string, scenarios: any[]): Promise<void> {
    if (!scenarios.length) return;
    const db = this.getDb();
    const now = new Date();

    const docs: TAScenarioDoc[] = scenarios.map(s => ({
      runId,
      scenarioId: s.scenarioId,
      hypothesisId: s.hypothesisId,
      rank: s.rank,
      asset: s.asset || '',
      timeframe: s.timeframe || '1D',
      direction: s.direction,
      score: s.score,
      probability: s.probability,
      probabilitySource: s.probabilitySource,
      components: s.components.map((c: any) => ({
        type: c.type,
        group: c.group,
        direction: c.direction,
        score: c.finalScore || c.score,
      })),
      intent: {
        bias: s.intent?.bias || 'WAIT',
        confidence: s.intent?.confidenceLabel || 'LOW',
      },
      riskPack: s.riskPack ? {
        valid: s.riskPack.valid,
        entry: s.riskPack.entry?.price,
        stop: s.riskPack.stop?.price,
        target1: s.riskPack.targets?.[0]?.price,
        rrToT1: s.riskPack.metrics?.rrToT1,
      } : undefined,
      createdAt: now,
    }));

    await db.collection('ta_scenarios').insertMany(docs);
    console.log(`[TA Storage] Saved ${docs.length} scenarios for run ${runId}`);
  }

  /**
   * Get hypotheses for a run
   */
  async getHypothesesByRun(runId: string): Promise<TAHypothesisDoc[]> {
    const db = this.getDb();
    return await db.collection('ta_hypotheses')
      .find({ runId })
      .sort({ score: -1 })
      .toArray() as TAHypothesisDoc[];
  }

  /**
   * Get scenarios for a run
   */
  async getScenariosByRun(runId: string): Promise<TAScenarioDoc[]> {
    const db = this.getDb();
    return await db.collection('ta_scenarios')
      .find({ runId })
      .sort({ rank: 1 })
      .toArray() as TAScenarioDoc[];
  }

  /**
   * Get full audit for a run (Phase F)
   */
  async getFullAudit(runId: string): Promise<{
    run: TARunDoc | null;
    patterns: TAPatternDoc[];
    hypotheses: TAHypothesisDoc[];
    scenarios: TAScenarioDoc[];
    decision: TADecisionDoc | null;
  }> {
    const db = this.getDb();

    const run = await db.collection('ta_runs').findOne({ runId }) as TARunDoc | null;
    if (!run) {
      return { run: null, patterns: [], hypotheses: [], scenarios: [], decision: null };
    }

    const [patterns, hypotheses, scenarios, decision] = await Promise.all([
      db.collection('ta_patterns').find({ runId }).sort({ rank: 1 }).toArray(),
      db.collection('ta_hypotheses').find({ runId }).sort({ score: -1 }).toArray(),
      db.collection('ta_scenarios').find({ runId }).sort({ rank: 1 }).toArray(),
      db.collection('ta_decisions').findOne({ runId }),
    ]);

    return {
      run,
      patterns: patterns as TAPatternDoc[],
      hypotheses: hypotheses as TAHypothesisDoc[],
      scenarios: scenarios as TAScenarioDoc[],
      decision: decision as TADecisionDoc | null,
    };
  }

  /**
   * Get audit history for asset
   */
  async getAuditHistory(asset: string, timeframe: string = '1D', limit: number = 20): Promise<Array<{
    runId: string;
    createdAt: Date;
    hypothesesCount: number;
    scenariosCount: number;
    topDirection: string;
    topProbability: number;
  }>> {
    const db = this.getDb();

    const runs = await db.collection('ta_runs')
      .find({ asset, timeframe })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as TARunDoc[];

    const results = [];
    for (const run of runs) {
      const hypCount = await db.collection('ta_hypotheses').countDocuments({ runId: run.runId });
      const topScenario = await db.collection('ta_scenarios')
        .findOne({ runId: run.runId, rank: 1 }) as TAScenarioDoc | null;

      results.push({
        runId: run.runId,
        createdAt: run.createdAt,
        hypothesesCount: hypCount,
        scenariosCount: topScenario ? 3 : 0,
        topDirection: topScenario?.direction || 'UNKNOWN',
        topProbability: topScenario?.probability || 0,
      });
    }

    return results;
  }

  /**
   * Initialize indexes (call once on startup)
   */
  async initIndexes(): Promise<void> {
    const db = this.getDb();

    try {
      // ta_runs indexes
      await db.collection('ta_runs').createIndex(
        { asset: 1, createdAt: -1 },
        { background: true }
      );
      await db.collection('ta_runs').createIndex(
        { runId: 1 },
        { unique: true, background: true }
      );

      // ta_patterns indexes
      await db.collection('ta_patterns').createIndex(
        { runId: 1 },
        { background: true }
      );
      await db.collection('ta_patterns').createIndex(
        { asset: 1, type: 1, createdAt: -1 },
        { background: true }
      );

      // ta_decisions indexes
      await db.collection('ta_decisions').createIndex(
        { runId: 1 },
        { unique: true, background: true }
      );
      await db.collection('ta_decisions').createIndex(
        { asset: 1, createdAt: -1 },
        { background: true }
      );

      // ta_outcomes indexes (for Phase 5)
      await db.collection('ta_outcomes').createIndex(
        { runId: 1 },
        { background: true }
      );
      await db.collection('ta_outcomes').createIndex(
        { patternId: 1 },
        { background: true }
      );

      console.log('[TA Storage] Indexes initialized');
    } catch (err) {
      console.error('[TA Storage] Failed to create indexes:', err);
    }
  }
}

// Singleton instance
export const taStorageService = new TAStorageService();
