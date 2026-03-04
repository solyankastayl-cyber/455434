/**
 * BLOCK 77.4 — Bootstrap Types
 * 
 * Types for Historical Bootstrap Engine.
 * Enables backfilling Memory Layer with 2020-2025 data.
 */

export interface BootstrapRunInput {
  symbol: 'BTC';
  from: string;              // YYYY-MM-DD
  to: string;                // YYYY-MM-DD
  horizons: string[];        // ['7d', '14d', '30d', '90d', '180d', '365d']
  presets: string[];         // ['conservative', 'balanced', 'aggressive']
  roles: string[];           // ['ACTIVE', 'SHADOW']
  policyHash: string;        // Current policy version
  engineVersion: string;     // e.g., 'v2.1.0'
}

export interface BootstrapProgress {
  batchId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  totalDays: number;
  processedDays: number;
  snapshotsCreated: number;
  snapshotsSkipped: number;
  errors: string[];
  startedAt: string;
  completedAt?: string;
  currentDate?: string;
}

export interface BootstrapResolveInput {
  symbol: 'BTC';
  batchId?: string;          // Resolve specific batch, or all unresolved
  forceResolve?: boolean;    // Re-resolve even if already resolved
}

export interface BootstrapResolveProgress {
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalSnapshots: number;
  resolvedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
  startedAt: string;
  completedAt?: string;
}

export interface BootstrapStats {
  totalSnapshots: number;
  totalOutcomes: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
  byHorizon: Record<string, number>;
  byPreset: Record<string, number>;
  hitRate: number;
  avgReturn: number;
}

// Guardrails constants
export const BOOTSTRAP_GUARDRAILS = {
  // LIVE samples required for governance APPLY
  minLiveSamplesForApply: 30,
  
  // Bootstrap does NOT count for these
  governanceExcluded: true,
  
  // Weight decay for old bootstrap data
  decayAfterYears: 2,
  decayFactor: 0.5,
  
  // Max age for bootstrap data to be used
  maxAgeYears: 5,
};
