/**
 * BLOCK 37.2 — Two-Stage Retrieval Contracts
 * 
 * Stage 1: Fast candidate selection (cheap)
 * Stage 2: Precise multi-rep rescoring (expensive)
 */

export type RetrievalStage1Mode =
  | "ret_fast"      // fast cosine on raw_returns only
  | "ret_hash";     // optional later (LSH-like)

export interface TwoStageRetrievalConfig {
  enabled: boolean;

  // stage-1
  stage1Mode: RetrievalStage1Mode;
  stage1TopK: number;       // default 600 (cheap filter)
  stage1MinSim?: number;    // default 0.10 (avoid trash)

  // stage-2
  stage2TopN: number;       // default 120 (final rerank)
  stage2MinSim?: number;    // default 0.35 (final cutoff)
}

export interface TwoStageStats {
  stage1Candidates: number;
  stage2Scored: number;
  stage2Kept: number;
  stage1Ms: number;
  stage2Ms: number;
}

// Default two-stage retrieval configuration
export const DEFAULT_TWO_STAGE_CONFIG: TwoStageRetrievalConfig = {
  enabled: true,
  stage1Mode: "ret_fast",
  stage1TopK: 600,
  stage1MinSim: 0.10,
  stage2TopN: 120,
  stage2MinSim: 0.35,
};
