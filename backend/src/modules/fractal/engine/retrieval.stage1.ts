/**
 * BLOCK 37.2 — Two-Stage Retrieval: Stage 1 (Fast Selection)
 * 
 * Fast candidate selection using raw returns only.
 * Filters out obviously dissimilar windows before expensive multi-rep scoring.
 */

import { TwoStageRetrievalConfig } from '../contracts/retrieval.contracts.js';
import { buildRawReturns } from './similarity.engine.v2.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface Stage1Candidate {
  endIdx: number;
  endTs: Date;
  startTs: Date;
  closes: number[];
  meta?: Record<string, any>;
}

export interface Stage1Result {
  cand: Stage1Candidate;
  s1: number;  // stage-1 similarity score
}

// ═══════════════════════════════════════════════════════════════
// Math Utilities
// ═══════════════════════════════════════════════════════════════

function l2norm(a: number[]): number {
  return Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
}

function l2normalize(x: number[]): number[] {
  const n = l2norm(x);
  return x.map(v => v / n);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
  }
  const denom = l2norm(a) * l2norm(b);
  return denom > 0 ? dot / denom : 0;
}

// ═══════════════════════════════════════════════════════════════
// Stage 1: Fast Selection
// ═══════════════════════════════════════════════════════════════

/**
 * Stage 1: Fast candidate selection using raw returns only
 * 
 * @param curCloses - current window closes (length = windowLen + 1)
 * @param candidates - all historical candidates
 * @param cfg - retrieval configuration
 * @returns top-K candidates sorted by stage-1 similarity
 */
export function stage1SelectByReturns(
  curCloses: number[],
  candidates: Stage1Candidate[],
  cfg: TwoStageRetrievalConfig
): Stage1Result[] {
  const t0 = Date.now();
  
  // Build current window vector (normalized)
  const curRet = buildRawReturns(curCloses);
  const curVec = l2normalize(curRet);

  const minSim = cfg.stage1MinSim ?? 0.10;

  // Score all candidates
  const scored: Stage1Result[] = [];
  
  for (const cand of candidates) {
    const r = buildRawReturns(cand.closes);
    const v = l2normalize(r);
    const s1 = cosineSim(curVec, v);
    
    if (s1 >= minSim) {
      scored.push({ cand, s1 });
    }
  }

  // Sort descending by similarity
  scored.sort((a, b) => b.s1 - a.s1);

  // Take top-K
  const result = scored.slice(0, cfg.stage1TopK);
  
  const elapsed = Date.now() - t0;
  if (elapsed > 100) {
    console.log(`[Stage1] Processed ${candidates.length} candidates in ${elapsed}ms, kept ${result.length}`);
  }

  return result;
}

/**
 * Stage 1 with batch processing for very large candidate sets
 * (optimization for >10k candidates)
 */
export function stage1SelectBatch(
  curCloses: number[],
  candidates: Stage1Candidate[],
  cfg: TwoStageRetrievalConfig,
  batchSize = 2000
): Stage1Result[] {
  const curRet = buildRawReturns(curCloses);
  const curVec = l2normalize(curRet);
  const minSim = cfg.stage1MinSim ?? 0.10;

  const allScored: Stage1Result[] = [];

  // Process in batches to avoid blocking
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    
    for (const cand of batch) {
      const r = buildRawReturns(cand.closes);
      const v = l2normalize(r);
      const s1 = cosineSim(curVec, v);
      
      if (s1 >= minSim) {
        allScored.push({ cand, s1 });
      }
    }
  }

  // Sort and take top-K
  allScored.sort((a, b) => b.s1 - a.s1);
  return allScored.slice(0, cfg.stage1TopK);
}
