/**
 * ML v2.3 - Configuration Types
 * 
 * Feature Pruning + Sample Weighting configuration.
 * Used by Node.js orchestrator and Python training service.
 */

export type MlTask = 'market' | 'actor';

// Pruning modes
export type PruningMode = 'OFF' | 'BASIC' | 'IMPORTANCE' | 'CORRELATION' | 'FULL';

// Weighting modes
export type WeightingMode = 'OFF' | 'TIME_DECAY' | 'CLASS_WEIGHT' | 'FULL';

/**
 * Feature Pruning Configuration
 * 
 * Controls which features to remove before training:
 * - variance: Remove near-constant features
 * - correlation: Remove highly correlated features
 * - importance: Remove low-importance features
 */
export interface PruningConfig {
  mode: PruningMode;
  varianceThreshold?: number;      // default 1e-8
  corrThreshold?: number;          // default 0.98
  minImportance?: number;          // default 0.002 (relative)
  maxFeatures?: number;            // default 80
  importanceMethod?: 'permutation' | 'gain'; // default permutation
}

/**
 * Sample Weighting Configuration
 * 
 * Controls sample importance during training:
 * - timeDecay: Recent samples weighted higher
 * - strongLabelBoost: STRONG_* labels weighted higher
 * - classWeight: Minority classes weighted higher
 */
export interface WeightingConfig {
  mode: WeightingMode;
  timeDecayHalfLifeHours?: number; // default 72
  strongLabelBoost?: number;       // default 1.5
  classWeight?: 'balanced' | 'none'; // default balanced
  maxWeight?: number;              // default 5.0
}

/**
 * Full v2.3 Configuration per task
 */
export interface V23TaskConfig {
  pruning: PruningConfig;
  weighting: WeightingConfig;
}

/**
 * v2.3 Settings stored in admin settings
 */
export interface V23Settings {
  market?: V23TaskConfig;
  actor?: V23TaskConfig;
}

// Default configurations
export const DEFAULT_PRUNING: PruningConfig = {
  mode: 'FULL',
  varianceThreshold: 1e-8,
  corrThreshold: 0.98,
  minImportance: 0.002,
  maxFeatures: 80,
  importanceMethod: 'permutation',
};

export const DEFAULT_WEIGHTING: WeightingConfig = {
  mode: 'FULL',
  timeDecayHalfLifeHours: 72,
  strongLabelBoost: 1.5,
  classWeight: 'balanced',
  maxWeight: 5.0,
};

export const DEFAULT_V23_SETTINGS: V23Settings = {
  market: {
    pruning: DEFAULT_PRUNING,
    weighting: DEFAULT_WEIGHTING,
  },
  actor: {
    pruning: DEFAULT_PRUNING,
    weighting: DEFAULT_WEIGHTING,
  },
};
