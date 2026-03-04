/**
 * Ablation Suite Types - P0.2
 * 
 * Types for ablation matrix experiments
 */
import { FeaturePack } from './feature_packs.js';

export type AblationSuiteName =
  | 'PACK_A_CORE'
  | 'PACK_A_VS_DEX'
  | 'FULL_MATRIX';

export interface AblationSuiteDefinition {
  name: AblationSuiteName;
  basePack: FeaturePack;
  variants: FeaturePack[];
  minRows: number;
  description: string;
}

export interface AblationMatrixRunInput {
  task: 'market' | 'actor';
  network: string;
  datasetId: string;
  suite: AblationSuiteName;
  useSyntheticIfNeeded?: boolean;
  includeStability?: boolean; // P1.1: Run stability check for base model
  stabilityRuns?: number;     // P1.1: Number of stability runs (default 3)
}

export interface AblationVariantResult {
  variantPack: string;
  modelId: string;
  ablationReportId: string;
  verdict: 'IMPROVES' | 'DEGRADES' | 'NEUTRAL' | 'INCONCLUSIVE';
  deltaF1: number;
  deltaAccuracy: number;
  fpRateChange: number;
  reasons: string[];
  // P1.1: Stability integration
  stabilityVerdict?: 'STABLE' | 'UNSTABLE' | 'INCONCLUSIVE';
  finalDecision?: 'ACCEPT' | 'EXPERIMENT_ONLY' | 'IGNORE' | 'REJECT' | 'INCONCLUSIVE';
}

export interface AblationMatrixResult {
  matrixId: string;
  suite: string;
  baseModelId: string;
  basePack: string;
  datasetId: string;
  rows: number;
  results: AblationVariantResult[];
  summary: {
    totalVariants: number;
    improves: number;
    degrades: number;
    neutral: number;
    inconclusive: number;
    // P1.1: Stability summary
    stable?: number;
    accepted?: number;
  };
  // P1.1: Base model stability
  baseStability?: {
    verdict: 'STABLE' | 'UNSTABLE' | 'INCONCLUSIVE';
    meanF1: number;
    stdF1: number;
    runs: number;
  };
  createdAt: Date;
}
