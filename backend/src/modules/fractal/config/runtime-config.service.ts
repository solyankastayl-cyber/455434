/**
 * P0: Runtime Config Service
 * 
 * Single point for engine to get runtime configuration.
 * Reads from MongoDB, falls back to static HORIZON_CONFIG if empty.
 * 
 * ARCHITECTURE UPDATE:
 * - windowLen is now horizon-specific, not a single global value
 * - BTC/SPX: Use HorizonPolicy (windowLenStrategy='policy')
 * - DXY: Uses fixed strategy (windowLenStrategy='fixed', windowLen=365)
 * 
 * This is the KEY piece that connects Governance UI to Engine.
 */

import { ModelConfigStore } from './model-config.store.js';
import {
  AssetKey,
  ModelConfigDoc,
  DEFAULT_MODEL_CONFIG,
  SimilarityMode,
  WindowLenStrategy,
  HorizonPolicyOverrides,
  DEFAULT_WINDOW_LEN_STRATEGY,
  DEFAULT_FIXED_WINDOW_LEN,
} from './model-config.contract.js';
import { HORIZON_CONFIG, HorizonKey } from './horizon.config.js';
import { resolveWindowLen, type Horizon } from '../../shared/horizon-policy.service.js';

/**
 * Unified runtime config used by engine
 */
export interface RuntimeEngineConfig {
  // NEW: Strategy for resolving windowLen
  windowLenStrategy: WindowLenStrategy;
  
  // NEW: Horizon-specific overrides (only used when strategy='policy')
  horizonPolicyOverrides: HorizonPolicyOverrides;
  
  // DEPRECATED: Single windowLen (only used when strategy='fixed')
  fixedWindowLen?: number;
  
  // Core engine parameters
  topK: number;
  similarityMode: SimilarityMode;
  minGapDays: number;
  ageDecayLambda: number;
  regimeConditioning: boolean;

  // Governance weights
  horizonWeights?: Record<string, number>;
  tierWeights?: Record<string, number>;

  // SPX-specific: Consensus parameters
  consensusThreshold?: number;    // Default: 0.05
  divergencePenalty?: number;     // Default: 0.85

  // DXY-specific: Path blend weights
  syntheticWeight?: number;       // Default: 0.4
  replayWeight?: number;          // Default: 0.4
  macroWeight?: number;           // Default: 0.2

  // Metadata
  source: 'mongo' | 'static';
  version?: string;
  updatedAt?: Date;
}

/**
 * Resolve windowLen for a specific horizon
 * 
 * Priority:
 * 1. horizonPolicyOverrides[horizon] (if exists)
 * 2. HorizonPolicy.resolveWindowLen(horizon) (if strategy='policy')
 * 3. fixedWindowLen (if strategy='fixed')
 */
export function resolveWindowLenForHorizon(
  config: RuntimeEngineConfig,
  horizon: HorizonKey
): number {
  // Check for horizon-specific override first
  const override = config.horizonPolicyOverrides?.[horizon as keyof HorizonPolicyOverrides];
  if (override !== undefined) {
    return override;
  }
  
  // Use strategy
  if (config.windowLenStrategy === 'fixed') {
    return config.fixedWindowLen ?? 60;
  }
  
  // Default: use HorizonPolicy
  return resolveWindowLen(horizon as Horizon);
}

/**
 * Get runtime engine config for asset
 * 
 * Priority:
 * 1. MongoDB model_config (if exists)
 * 2. Static DEFAULT_MODEL_CONFIG (fallback)
 */
export async function getRuntimeEngineConfig(asset: AssetKey): Promise<RuntimeEngineConfig> {
  const doc = await ModelConfigStore.get(asset);
  
  // Get default strategy for this asset
  const defaultStrategy = DEFAULT_WINDOW_LEN_STRATEGY[asset];
  const defaultFixedWindowLen = DEFAULT_FIXED_WINDOW_LEN[asset];

  if (doc) {
    console.log(`[RuntimeConfig] Using Mongo config for ${asset} (updated: ${doc.updatedAt})`);
    return {
      windowLenStrategy: doc.windowLenStrategy ?? defaultStrategy,
      horizonPolicyOverrides: doc.horizonPolicyOverrides ?? {},
      fixedWindowLen: doc.windowLen ?? defaultFixedWindowLen,
      topK: doc.topK ?? DEFAULT_MODEL_CONFIG.topK,
      similarityMode: doc.similarityMode ?? DEFAULT_MODEL_CONFIG.similarityMode,
      minGapDays: doc.minGapDays ?? DEFAULT_MODEL_CONFIG.minGapDays ?? 60,
      ageDecayLambda: doc.ageDecayLambda ?? DEFAULT_MODEL_CONFIG.ageDecayLambda ?? 0,
      regimeConditioning: doc.regimeConditioning ?? DEFAULT_MODEL_CONFIG.regimeConditioning ?? true,
      horizonWeights: doc.horizonWeights ?? DEFAULT_MODEL_CONFIG.horizonWeights,
      tierWeights: doc.tierWeights ?? DEFAULT_MODEL_CONFIG.tierWeights,
      // SPX-specific
      consensusThreshold: doc.consensusThreshold ?? 0.05,
      divergencePenalty: doc.divergencePenalty ?? 0.85,
      // DXY-specific
      syntheticWeight: doc.syntheticWeight ?? 0.4,
      replayWeight: doc.replayWeight ?? 0.4,
      macroWeight: doc.macroWeight ?? 0.2,
      source: 'mongo',
      version: doc.version,
      updatedAt: doc.updatedAt,
    };
  }

  // Fallback to static config
  console.log(`[RuntimeConfig] Using STATIC config for ${asset} (no Mongo doc)`);
  return {
    windowLenStrategy: defaultStrategy,
    horizonPolicyOverrides: {},
    fixedWindowLen: defaultFixedWindowLen,
    topK: DEFAULT_MODEL_CONFIG.topK ?? 25,
    similarityMode: (DEFAULT_MODEL_CONFIG.similarityMode ?? 'zscore') as SimilarityMode,
    minGapDays: DEFAULT_MODEL_CONFIG.minGapDays ?? 60,
    ageDecayLambda: DEFAULT_MODEL_CONFIG.ageDecayLambda ?? 0,
    regimeConditioning: DEFAULT_MODEL_CONFIG.regimeConditioning ?? true,
    horizonWeights: DEFAULT_MODEL_CONFIG.horizonWeights,
    tierWeights: DEFAULT_MODEL_CONFIG.tierWeights,
    // SPX defaults
    consensusThreshold: 0.05,
    divergencePenalty: 0.85,
    // DXY defaults
    syntheticWeight: 0.4,
    replayWeight: 0.4,
    macroWeight: 0.2,
    source: 'static',
  };
}

/**
 * Get merged horizon config (static + runtime overrides)
 * 
 * NOW USES: resolveWindowLenForHorizon() which respects strategy
 */
export async function getMergedHorizonConfig(
  asset: AssetKey,
  horizon: HorizonKey
): Promise<{
  windowLen: number;
  aftermathDays: number;
  topK: number;
  minHistory: number;
  source: 'mongo' | 'static';
  windowLenStrategy: WindowLenStrategy;
  policySource: string;
}> {
  const runtime = await getRuntimeEngineConfig(asset);
  const staticCfg = HORIZON_CONFIG[horizon];
  
  // Resolve windowLen using new strategy
  const windowLen = resolveWindowLenForHorizon(runtime, horizon);
  
  // Determine policy source for debugging
  const hasOverride = runtime.horizonPolicyOverrides?.[horizon as keyof HorizonPolicyOverrides] !== undefined;
  let policySource: string;
  if (hasOverride) {
    policySource = `override:${horizon}`;
  } else if (runtime.windowLenStrategy === 'fixed') {
    policySource = `fixed:${runtime.fixedWindowLen}`;
  } else {
    policySource = 'horizon-policy';
  }

  return {
    windowLen,
    aftermathDays: staticCfg.aftermathDays,
    topK: runtime.topK,
    minHistory: staticCfg.minHistory,
    source: runtime.source,
    windowLenStrategy: runtime.windowLenStrategy,
    policySource,
  };
}

/**
 * Debug endpoint data
 * P1-A: Added activeVersion from lifecycle
 * P2: Added windowLenStrategy and policySource
 */
export async function getRuntimeDebugInfo(asset: AssetKey): Promise<{
  asset: AssetKey;
  configSource: 'mongo' | 'static';
  windowLenStrategy: WindowLenStrategy;
  horizonPolicyOverrides: HorizonPolicyOverrides;
  fixedWindowLen?: number;
  // Resolved windowLen by horizon (for debugging)
  resolvedWindowLens: Record<string, number>;
  topK: number;
  similarityMode: string;
  minGapDays: number;
  ageDecayLambda: number;
  regimeConditioning: boolean;
  horizonWeights?: Record<string, number>;
  tierWeights?: Record<string, number>;
  // SPX-specific
  consensusThreshold?: number;
  divergencePenalty?: number;
  // DXY-specific
  syntheticWeight?: number;
  replayWeight?: number;
  macroWeight?: number;
  version?: string;
  updatedAt?: string;
  activeVersion?: string;
  activeConfigHash?: string;
  promotedAt?: string;
}> {
  const cfg = await getRuntimeEngineConfig(asset);
  
  // P1-A: Get lifecycle state for activeVersion
  let lifecycleState: any = null;
  try {
    const { LifecycleStore } = await import('../lifecycle/lifecycle.store.js');
    lifecycleState = await LifecycleStore.getState(asset);
  } catch (err) {
    // Lifecycle store may not exist yet
  }
  
  // Compute resolved windowLens for all horizons
  const horizons: HorizonKey[] = ['7d', '14d', '30d', '90d', '180d', '365d'];
  const resolvedWindowLens: Record<string, number> = {};
  for (const h of horizons) {
    resolvedWindowLens[h] = resolveWindowLenForHorizon(cfg, h);
  }
  
  return {
    asset,
    configSource: cfg.source,
    windowLenStrategy: cfg.windowLenStrategy,
    horizonPolicyOverrides: cfg.horizonPolicyOverrides,
    fixedWindowLen: cfg.fixedWindowLen,
    resolvedWindowLens,
    topK: cfg.topK,
    similarityMode: cfg.similarityMode,
    minGapDays: cfg.minGapDays,
    ageDecayLambda: cfg.ageDecayLambda,
    regimeConditioning: cfg.regimeConditioning,
    horizonWeights: cfg.horizonWeights,
    tierWeights: cfg.tierWeights,
    // SPX-specific
    consensusThreshold: cfg.consensusThreshold,
    divergencePenalty: cfg.divergencePenalty,
    // DXY-specific
    syntheticWeight: cfg.syntheticWeight,
    replayWeight: cfg.replayWeight,
    macroWeight: cfg.macroWeight,
    version: cfg.version,
    updatedAt: cfg.updatedAt?.toISOString(),
    // P1-A: Lifecycle info
    activeVersion: lifecycleState?.activeVersion,
    activeConfigHash: lifecycleState?.activeConfigHash,
    promotedAt: lifecycleState?.promotedAt?.toISOString(),
  };
}
