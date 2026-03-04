/**
 * BLOCKS 2.15-2.21 — Signal Intelligence Layer
 * =============================================
 * Funding overlay, Pattern Memory, Lifecycle, Failure Modes.
 */

import type { Db, Collection } from 'mongodb';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type LifecyclePhase = 'BIRTH' | 'EXPANSION' | 'PEAK' | 'DECAY' | 'DEATH';
export type MarketRegime = 'BULL' | 'BEAR' | 'RANGE' | 'CHAOS';
export type FundingState = 'EXTREME_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'EXTREME_SHORT';
export type Pressure = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface PatternOutcome {
  _id?: any;
  patternId: string;
  clusterId: number;
  horizon: '1h' | '4h' | '24h';
  direction: 'UP' | 'DOWN' | 'FLAT';
  moveStrength: number;
  volatility: number;
  fundingState: FundingState;
  ts: Date;
  createdAt: Date;
}

export interface ClusterLifecycle {
  clusterId: number;
  clusterRunId: string;
  phase: LifecyclePhase;
  movedRatio: number;
  timeDecayFactor: number;
  strengthDecay: number;
  avgMoveFirst: number;
  avgMoveLast: number;
  firstMoveTs: Date | null;
  updatedAt: Date;
}

export interface FailureMode {
  type: 'ONE_PUMP' | 'LIQUIDITY_VACUUM' | 'FUNDING_BAIT' | 'CORRELATION_MIRAGE';
  severity: number; // 0-1
  description: string;
}

export interface SignalIntelligence {
  symbolKey: string;
  base: string;
  
  // Base scores
  baseScore: number;
  patternMemoryScore: number;
  macroFitScore: number;
  fundingPressureScore: number;
  
  // Lifecycle
  lifecyclePhase: LifecyclePhase;
  lifecycleMultiplier: number;
  timeDecayFactor: number;
  
  // Funding overlay
  fundingState: FundingState;
  fundingModifier: number;
  
  // Failure modes
  failureModes: FailureMode[];
  aggregateFailureScore: number;
  
  // Final
  finalScore: number;
  confidence: number;
  bucket: 'CANDIDATE' | 'WATCH' | 'AVOID';
  
  // Explanation
  reasons: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function classifyFundingState(fundingRate: number): FundingState {
  if (fundingRate > 0.05) return 'EXTREME_LONG';
  if (fundingRate > 0.01) return 'LONG';
  if (fundingRate < -0.05) return 'EXTREME_SHORT';
  if (fundingRate < -0.01) return 'SHORT';
  return 'NEUTRAL';
}

function getFundingModifier(state: FundingState): number {
  switch (state) {
    case 'EXTREME_LONG': return 0.7;
    case 'LONG': return 0.85;
    case 'NEUTRAL': return 1.0;
    case 'SHORT': return 1.1;
    case 'EXTREME_SHORT': return 1.2;
  }
}

function getLifecycleMultiplier(phase: LifecyclePhase): number {
  switch (phase) {
    case 'BIRTH': return 0.8;
    case 'EXPANSION': return 1.0;
    case 'PEAK': return 0.6;
    case 'DECAY': return 0.3;
    case 'DEATH': return 0.0;
  }
}

function computeTimeDecayFactor(
  firstMoveTs: Date | null,
  movedRatio: number,
  strengthDecay: number,
  lambda = 0.1
): number {
  if (!firstMoveTs) return 1.0;
  
  const hoursSinceFirst = (Date.now() - firstMoveTs.getTime()) / 3600_000;
  const timeFactor = Math.exp(-lambda * hoursSinceFirst);
  const ratioFactor = 1 - movedRatio;
  
  return clamp01(timeFactor * ratioFactor * strengthDecay);
}

function determineLifecyclePhase(
  movedRatio: number,
  timeDecayFactor: number,
  strengthDecay: number
): LifecyclePhase {
  if (movedRatio < 0.15 && timeDecayFactor > 0.9) return 'BIRTH';
  if (movedRatio < 0.6 && timeDecayFactor > 0.5) return 'EXPANSION';
  if (movedRatio >= 0.6 || strengthDecay < 0.5) return 'PEAK';
  if (timeDecayFactor < 0.25 || movedRatio > 0.8) return 'DECAY';
  return 'DEATH';
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL INTELLIGENCE SERVICE
// ═══════════════════════════════════════════════════════════════

export class SignalIntelligenceService {
  private outcomesCol: Collection<PatternOutcome> | null = null;
  private lifecycleCol: Collection<ClusterLifecycle> | null = null;
  private membershipsCol: Collection | null = null;
  private returnsCol: Collection | null = null;
  private snapshotsCol: Collection | null = null;

  init(db: Db) {
    this.outcomesCol = db.collection('pattern_outcomes');
    this.lifecycleCol = db.collection('cluster_lifecycle');
    this.membershipsCol = db.collection('exchange_pattern_memberships');
    this.returnsCol = db.collection('exchange_symbol_returns');
    this.snapshotsCol = db.collection('exchange_symbol_snapshots');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (this.outcomesCol) {
      await this.outcomesCol.createIndex({ clusterId: 1, horizon: 1, ts: -1 });
      await this.outcomesCol.createIndex({ patternId: 1 });
    }
    if (this.lifecycleCol) {
      await this.lifecycleCol.createIndex({ clusterRunId: 1, clusterId: 1 }, { unique: true });
    }
  }

  /**
   * Block 2.16 — Get pattern memory score
   */
  async getPatternMemoryScore(clusterId: number, horizon: '1h' | '4h' | '24h'): Promise<{
    score: number;
    samples: number;
    winRate: number;
    avgMove: number;
  }> {
    if (!this.outcomesCol) return { score: 0.5, samples: 0, winRate: 0, avgMove: 0 };

    const outcomes = await this.outcomesCol
      .find({ clusterId, horizon })
      .sort({ ts: -1 })
      .limit(100)
      .toArray();

    if (outcomes.length < 10) {
      return { score: 0.5, samples: outcomes.length, winRate: 0, avgMove: 0 };
    }

    const wins = outcomes.filter(o => o.direction === 'UP').length;
    const winRate = wins / outcomes.length;
    const avgMove = outcomes.reduce((s, o) => s + o.moveStrength, 0) / outcomes.length;
    
    // Sample confidence (log scale)
    const sampleConfidence = Math.min(1, Math.log10(outcomes.length) / 2);
    
    const score = winRate * clamp01(avgMove * 10) * sampleConfidence;

    return { score, samples: outcomes.length, winRate, avgMove };
  }

  /**
   * Block 2.19 — Compute cluster lifecycle
   */
  async computeClusterLifecycle(
    clusterRunId: string,
    clusterId: number,
    horizon: '1h' | '4h' | '24h',
    winnersThreshold: number
  ): Promise<ClusterLifecycle> {
    if (!this.membershipsCol || !this.returnsCol) {
      return {
        clusterId,
        clusterRunId,
        phase: 'BIRTH',
        movedRatio: 0,
        timeDecayFactor: 1,
        strengthDecay: 1,
        avgMoveFirst: 0,
        avgMoveLast: 0,
        firstMoveTs: null,
        updatedAt: new Date(),
      };
    }

    // Get members
    const members = await this.membershipsCol
      .find({ clusterRunId, clusterId })
      .toArray();

    const symbolKeys = members.map((m: any) => m.symbolKey);

    // Get returns
    const returns = await this.returnsCol
      .find({ symbolKey: { $in: symbolKeys } })
      .sort({ ts: -1 })
      .limit(symbolKeys.length)
      .toArray();

    const retMap = new Map(returns.map((r: any) => [r.symbolKey, r]));

    let moved = 0;
    let firstMoveTs: Date | null = null;
    const moves: number[] = [];

    for (const m of members) {
      const ret = retMap.get((m as any).symbolKey);
      const move = ret?.[`ret_${horizon}`];
      if (typeof move === 'number' && move >= winnersThreshold) {
        moved++;
        moves.push(move);
        if (!firstMoveTs || ret.ts < firstMoveTs) {
          firstMoveTs = ret.ts;
        }
      }
    }

    const movedRatio = members.length > 0 ? moved / members.length : 0;
    
    // Compute strength decay (compare first half to last half of moves)
    const half = Math.floor(moves.length / 2);
    const avgMoveFirst = half > 0 ? moves.slice(0, half).reduce((a, b) => a + b, 0) / half : 0;
    const avgMoveLast = half > 0 ? moves.slice(half).reduce((a, b) => a + b, 0) / (moves.length - half) : 0;
    const strengthDecay = avgMoveFirst > 0 ? avgMoveLast / avgMoveFirst : 1;

    const timeDecayFactor = computeTimeDecayFactor(firstMoveTs, movedRatio, strengthDecay);
    const phase = determineLifecyclePhase(movedRatio, timeDecayFactor, strengthDecay);

    return {
      clusterId,
      clusterRunId,
      phase,
      movedRatio,
      timeDecayFactor,
      strengthDecay,
      avgMoveFirst,
      avgMoveLast,
      firstMoveTs,
      updatedAt: new Date(),
    };
  }

  /**
   * Block 2.20 — Detect failure modes
   */
  detectFailureModes(opts: {
    movedRatio: number;
    movedCount: number;
    totalCount: number;
    avgVolume: number;
    volumeZ: number;
    oiChange: number;
    fundingShift: number;
    btcCorrelation: number;
  }): FailureMode[] {
    const modes: FailureMode[] = [];

    // FM1: One-Pump Trap
    if (opts.movedRatio < 0.15 && opts.movedCount === 1) {
      modes.push({
        type: 'ONE_PUMP',
        severity: 0.8,
        description: 'Single asset moved, pattern not confirmed',
      });
    }

    // FM2: Liquidity Vacuum
    if (opts.volumeZ < 0 && opts.oiChange < 0.01) {
      modes.push({
        type: 'LIQUIDITY_VACUUM',
        severity: 0.6,
        description: 'Price moved without volume/OI confirmation',
      });
    }

    // FM3: Funding Bait
    if (Math.abs(opts.fundingShift) > 0.02 && opts.movedRatio < 0.3) {
      modes.push({
        type: 'FUNDING_BAIT',
        severity: 0.7,
        description: 'Funding shifted but movement incomplete',
      });
    }

    // FM4: Correlation Mirage
    if (opts.btcCorrelation > 0.8) {
      modes.push({
        type: 'CORRELATION_MIRAGE',
        severity: 0.5,
        description: 'Movement correlated with BTC, not pattern-driven',
      });
    }

    return modes;
  }

  /**
   * Block 2.17 — Build full signal intelligence
   */
  async buildSignalIntelligence(opts: {
    symbolKey: string;
    base: string;
    clusterId: number;
    clusterRunId: string;
    horizon: '1h' | '4h' | '24h';
    baseScore: number;
    fundingRate: number;
    volumeZ?: number;
    oiChange?: number;
    btcCorrelation?: number;
    clusterMovedRatio: number;
    clusterMovedCount: number;
    clusterTotalCount: number;
  }): Promise<SignalIntelligence> {
    // Pattern memory
    const patternMemory = await this.getPatternMemoryScore(opts.clusterId, opts.horizon);

    // Lifecycle
    const lifecycle = await this.computeClusterLifecycle(
      opts.clusterRunId,
      opts.clusterId,
      opts.horizon,
      0.06
    );

    // Funding
    const fundingState = classifyFundingState(opts.fundingRate);
    const fundingModifier = getFundingModifier(fundingState);

    // Lifecycle multiplier
    const lifecycleMultiplier = getLifecycleMultiplier(lifecycle.phase);

    // Macro fit (simplified)
    const macroFitScore = 0.5; // Would come from macro layer

    // Funding pressure score
    const fundingPressureScore = clamp01(Math.abs(opts.fundingRate) * 20);

    // Failure modes
    const failureModes = this.detectFailureModes({
      movedRatio: opts.clusterMovedRatio,
      movedCount: opts.clusterMovedCount,
      totalCount: opts.clusterTotalCount,
      avgVolume: 0,
      volumeZ: opts.volumeZ ?? 0,
      oiChange: opts.oiChange ?? 0,
      fundingShift: opts.fundingRate,
      btcCorrelation: opts.btcCorrelation ?? 0,
    });

    const aggregateFailureScore = failureModes.reduce((s, m) => s + m.severity * 0.25, 0);

    // Final score calculation (Block 2.17 formula)
    const w1 = 0.45; // base
    const w2 = 0.25; // pattern memory
    const w3 = 0.15; // macro fit
    const w4 = 0.15; // funding pressure

    const rawScore =
      w1 * opts.baseScore +
      w2 * patternMemory.score +
      w3 * macroFitScore -
      w4 * fundingPressureScore;

    const finalScore = clamp01(rawScore * lifecycleMultiplier * fundingModifier * (1 - aggregateFailureScore));

    // Confidence
    const confidence = clamp01(
      0.40 * (1 - fundingPressureScore) +
      0.25 * (patternMemory.samples > 30 ? 1 : patternMemory.samples / 30) +
      0.20 * (lifecycle.timeDecayFactor) +
      0.15 * (1 - aggregateFailureScore)
    );

    // Bucket
    let bucket: 'CANDIDATE' | 'WATCH' | 'AVOID' = 'WATCH';
    if (confidence < 0.35 || aggregateFailureScore > 0.6) {
      bucket = 'AVOID';
    } else if (finalScore >= 0.7 && confidence >= 0.55) {
      bucket = 'CANDIDATE';
    }

    // Reasons
    const reasons: string[] = [];
    if (patternMemory.samples >= 10) {
      reasons.push(`Pattern history: ${(patternMemory.winRate * 100).toFixed(0)}% win rate (${patternMemory.samples} samples)`);
    }
    reasons.push(`Lifecycle: ${lifecycle.phase}`);
    reasons.push(`Funding: ${fundingState}`);
    if (failureModes.length > 0) {
      reasons.push(`Warnings: ${failureModes.map(m => m.type).join(', ')}`);
    }

    return {
      symbolKey: opts.symbolKey,
      base: opts.base,
      baseScore: opts.baseScore,
      patternMemoryScore: patternMemory.score,
      macroFitScore,
      fundingPressureScore,
      lifecyclePhase: lifecycle.phase,
      lifecycleMultiplier,
      timeDecayFactor: lifecycle.timeDecayFactor,
      fundingState,
      fundingModifier,
      failureModes,
      aggregateFailureScore,
      finalScore,
      confidence,
      bucket,
      reasons,
    };
  }

  /**
   * Save pattern outcome for learning
   */
  async saveOutcome(outcome: Omit<PatternOutcome, '_id' | 'createdAt'>): Promise<void> {
    if (!this.outcomesCol) return;
    await this.outcomesCol.insertOne({
      ...outcome,
      createdAt: new Date(),
    });
  }
}

export const signalIntelligenceService = new SignalIntelligenceService();

console.log('[SignalIntelligence] Service loaded (Blocks 2.15-2.21)');
