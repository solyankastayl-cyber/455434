/**
 * P0: Model Config Contract
 * 
 * Runtime-configurable engine parameters stored in MongoDB.
 * This replaces hardcoded HORIZON_CONFIG for managed assets.
 * 
 * ARCHITECTURE:
 * - BTC/SPX: Use HorizonPolicy (windowLen varies by horizon)
 * - DXY: Uses fixed strategy (windowLen=365 for all horizons)
 * 
 * windowLenStrategy determines how windowLen is resolved:
 * - 'policy': Use HorizonPolicy (default for BTC/SPX)
 * - 'fixed': Use single windowLen value (default for DXY)
 */

export type AssetKey = 'BTC' | 'SPX' | 'DXY';

export type SimilarityMode = 'zscore' | 'raw_returns';

export type WindowLenStrategy = 'policy' | 'fixed';

export interface HorizonPolicyOverrides {
  '7d'?: number;
  '14d'?: number;
  '30d'?: number;
  '90d'?: number;
  '180d'?: number;
  '365d'?: number;
}

export interface ModelConfigDoc {
  asset: AssetKey;

  // DEPRECATED: Use horizonPolicyOverrides instead for BTC/SPX
  // Only used when windowLenStrategy='fixed' (DXY)
  windowLen?: number;
  
  // NEW: Strategy for resolving windowLen
  windowLenStrategy?: WindowLenStrategy;
  
  // NEW: Horizon-specific overrides (only used when strategy='policy')
  horizonPolicyOverrides?: HorizonPolicyOverrides;

  // Core engine knobs
  topK: number;
  similarityMode: SimilarityMode;

  // Optional knobs
  minGapDays?: number;
  ageDecayLambda?: number;
  regimeConditioning?: boolean;

  // Governance weights (used by consensus)
  horizonWeights?: Record<string, number>;
  tierWeights?: Record<string, number>;

  // SPX-specific: Consensus parameters
  consensusThreshold?: number;    // Default: 0.05, min value to call BULL/BEAR
  divergencePenalty?: number;     // Default: 0.85, penalty for grade D divergence

  // DXY-specific: Path blend weights
  syntheticWeight?: number;       // Default: 0.4
  replayWeight?: number;          // Default: 0.4
  macroWeight?: number;           // Default: 0.2

  // Metadata
  updatedAt: Date;
  updatedBy?: string;
  version?: string;
}

/**
 * Default windowLen strategy by asset
 */
export const DEFAULT_WINDOW_LEN_STRATEGY: Record<AssetKey, WindowLenStrategy> = {
  BTC: 'policy',
  SPX: 'policy',
  DXY: 'fixed',
};

/**
 * Default fixed windowLen (only used when strategy='fixed')
 */
export const DEFAULT_FIXED_WINDOW_LEN: Record<AssetKey, number> = {
  BTC: 60,   // Not used (policy)
  SPX: 60,   // Not used (policy)
  DXY: 365,  // Fixed by design
};

// Default values (used as fallback)
export const DEFAULT_MODEL_CONFIG: Omit<ModelConfigDoc, 'asset' | 'updatedAt'> = {
  windowLenStrategy: 'policy',
  horizonPolicyOverrides: {},
  topK: 25,
  similarityMode: 'zscore',
  minGapDays: 60,
  ageDecayLambda: 0.0,
  regimeConditioning: true,
  horizonWeights: {
    '7d': 0.15,
    '14d': 0.20,
    '30d': 0.35,
    '90d': 0.30,
  },
  tierWeights: {
    'TIMING': 0.12,
    'TACTICAL': 0.36,
    'STRUCTURE': 0.52,
  },
};
