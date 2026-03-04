/**
 * BLOCK 37.2 — Two-Stage Retrieval Pipeline
 * 
 * Combines Stage 1 (fast) + Stage 2 (precise multi-rep) retrieval.
 * Achieves quality without CPU explosion.
 */

import {
  TwoStageRetrievalConfig,
  TwoStageStats,
  DEFAULT_TWO_STAGE_CONFIG,
} from '../contracts/retrieval.contracts.js';
import { MultiRepConfig, DEFAULT_MULTI_REP_CONFIG } from '../contracts/similarity.contracts.js';
import { buildMultiRepVectors, multiRepSimilarity } from './similarity.engine.v2.js';
import { Stage1Result } from './retrieval.stage1.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface Stage2Result {
  cand: Stage1Result['cand'];
  sim: number;           // final multi-rep similarity
  byRep: Record<string, number>;
  s1: number;            // stage-1 similarity (for diagnostics)
}

export interface TwoStageOutput {
  ranked: Stage2Result[];
  stats: TwoStageStats;
}

// ═══════════════════════════════════════════════════════════════
// Stage 2: Precise Re-ranking
// ═══════════════════════════════════════════════════════════════

/**
 * Two-Stage Retrieval: Re-score stage-1 candidates with multi-rep similarity
 * 
 * @param curCloses - current window closes
 * @param stage1 - stage-1 results (already filtered and sorted)
 * @param cfg - retrieval configuration
 * @param multiCfg - multi-rep configuration
 */
export function twoStageRetrieve(
  curCloses: number[],
  stage1: Stage1Result[],
  cfg: TwoStageRetrievalConfig = DEFAULT_TWO_STAGE_CONFIG,
  multiCfg: MultiRepConfig = DEFAULT_MULTI_REP_CONFIG
): TwoStageOutput {
  const t0 = Date.now();

  // Take top-N from stage-1 for stage-2 scoring
  const stage2Input = stage1.slice(0, cfg.stage2TopN);

  // Build current window multi-rep vectors (once)
  const curReps = buildMultiRepVectors(curCloses, multiCfg);
  
  const t1 = Date.now();
  const stage1Ms = t1 - t0;

  // Re-score each candidate with multi-rep similarity
  const rescored: Stage2Result[] = [];
  
  for (const { cand, s1 } of stage2Input) {
    const histReps = buildMultiRepVectors(cand.closes, multiCfg);
    const score = multiRepSimilarity(curReps, histReps, multiCfg);
    
    rescored.push({
      cand,
      sim: score.total,
      byRep: score.byRep as Record<string, number>,
      s1,
    });
  }

  // Filter by stage-2 minimum similarity
  const stage2Min = cfg.stage2MinSim ?? 0.35;
  const kept = rescored
    .filter(x => x.sim >= stage2Min)
    .sort((a, b) => b.sim - a.sim);

  const t2 = Date.now();
  const stage2Ms = t2 - t1;

  const stats: TwoStageStats = {
    stage1Candidates: stage1.length,
    stage2Scored: stage2Input.length,
    stage2Kept: kept.length,
    stage1Ms,
    stage2Ms,
  };

  return { ranked: kept, stats };
}

/**
 * Full two-stage pipeline with stage-1 included
 * (convenience function for single-call usage)
 */
export function twoStageRetrieveFull(
  curCloses: number[],
  allCandidates: Array<{
    endIdx: number;
    endTs: Date;
    startTs: Date;
    closes: number[];
    meta?: Record<string, any>;
  }>,
  cfg: TwoStageRetrievalConfig = DEFAULT_TWO_STAGE_CONFIG,
  multiCfg: MultiRepConfig = DEFAULT_MULTI_REP_CONFIG
): TwoStageOutput {
  // Import stage1 dynamically to avoid circular deps
  const { stage1SelectByReturns } = require('./retrieval.stage1.js');
  
  const stage1 = stage1SelectByReturns(curCloses, allCandidates, cfg);
  return twoStageRetrieve(curCloses, stage1, cfg, multiCfg);
}

// ═══════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════

/**
 * Analyze stage-1 vs stage-2 correlation
 * Useful for tuning stage-1 threshold
 */
export function analyzeStageCorrelation(
  results: Stage2Result[]
): {
  correlation: number;
  avgS1: number;
  avgS2: number;
  s1S2Gap: number;
  reorderPct: number;
} {
  if (results.length < 2) {
    return { correlation: 1, avgS1: 0, avgS2: 0, s1S2Gap: 0, reorderPct: 0 };
  }

  const n = results.length;
  const s1 = results.map(r => r.s1);
  const s2 = results.map(r => r.sim);

  const avgS1 = s1.reduce((a, b) => a + b, 0) / n;
  const avgS2 = s2.reduce((a, b) => a + b, 0) / n;

  // Pearson correlation
  let cov = 0, var1 = 0, var2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = s1[i] - avgS1;
    const d2 = s2[i] - avgS2;
    cov += d1 * d2;
    var1 += d1 * d1;
    var2 += d2 * d2;
  }
  const correlation = cov / (Math.sqrt(var1 * var2) || 1);

  // Average gap between s1 and s2 scores
  const s1S2Gap = avgS1 - avgS2;

  // Percentage of reordering (rank changes)
  let reorders = 0;
  for (let i = 0; i < n - 1; i++) {
    const s1Rank = s1.indexOf(s1[i]);
    const s2Rank = i; // already sorted by s2
    if (Math.abs(s1Rank - s2Rank) > 2) reorders++;
  }
  const reorderPct = reorders / n;

  return {
    correlation: Math.round(correlation * 1000) / 1000,
    avgS1: Math.round(avgS1 * 1000) / 1000,
    avgS2: Math.round(avgS2 * 1000) / 1000,
    s1S2Gap: Math.round(s1S2Gap * 1000) / 1000,
    reorderPct: Math.round(reorderPct * 1000) / 1000,
  };
}
