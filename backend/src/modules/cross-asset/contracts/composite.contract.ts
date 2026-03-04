/**
 * P4: Cross-Asset Composite Contract
 * 
 * Defines types for composite lifecycle with smart blending:
 * - Vol-adjusted weights
 * - Confidence weighting
 * - Reliability factor
 * - Version lineage tracking
 */

export type ParentAsset = 'BTC' | 'SPX' | 'DXY';

export interface ParentVersions {
  BTC: string;
  SPX: string;
  DXY: string;
}

export interface BlendConfig {
  // Base weights (should sum to 1.0)
  btcWeight: number;
  spxWeight: number;
  dxyWeight: number;
  
  // Blending mode
  rebalanceMode: 'static' | 'vol_adjusted' | 'confidence_weighted' | 'smart';
  normalizationMode: 'return' | 'level';
  
  // Vol penalty params
  volRefSigma: number;      // Reference volatility (default 0.02 = 2% daily)
  volPenaltyPower: number;  // Penalty curve power (default 1.5)
  volLookbackDays: number;  // Days for vol calculation (default 30)
  
  // Daily return cap
  dailyReturnCap: number;   // Max daily return (default 0.07 = 7%)
}

export const DEFAULT_BLEND_CONFIG: BlendConfig = {
  btcWeight: 0.50,
  spxWeight: 0.30,
  dxyWeight: 0.20,
  rebalanceMode: 'smart',
  normalizationMode: 'return',
  volRefSigma: 0.02,
  volPenaltyPower: 1.5,
  volLookbackDays: 30,
  dailyReturnCap: 0.07,
};

export interface ParentSnapshotData {
  asset: ParentAsset;
  versionId: string;
  asOf: string;
  asOfPrice: number;
  forecastPath: number[];  // Price levels
  confidence: number;      // 0..1
  reliability?: number;    // 0..1 (optional)
  stance?: string;         // 'BULL' | 'BEAR' | 'NEUTRAL'
}

export interface ComputedWeights {
  BTC: number;
  SPX: number;
  DXY: number;
  raw: {
    BTC: number;
    SPX: number;
    DXY: number;
  };
  volPenalties: {
    BTC: number;
    SPX: number;
    DXY: number;
  };
  confFactors: {
    BTC: number;
    SPX: number;
    DXY: number;
  };
}

export interface CompositeSnapshotDoc {
  _id?: any;
  asset: 'CROSS_ASSET';
  versionId: string;
  horizonDays: number;
  
  // Parent lineage (immutable after creation)
  parentVersions: ParentVersions;
  
  // Blend configuration used
  blendConfig: BlendConfig;
  
  // Computed weights
  computedWeights: ComputedWeights;
  
  // Composite forecast
  asOf: string;
  anchorPrice: number;  // Usually 100 for index
  forecastPath: number[];
  forecastReturns: number[];
  upperBand?: number[];
  lowerBand?: number[];
  
  // Aggregated metrics
  expectedReturn: number;
  confidence: number;
  stance: string;
  
  // Metadata
  createdAt: Date;
  createdBy: string;
  resolved: boolean;
  resolvedAt?: Date;
  realizedReturn?: number;
  error?: number;
}

export interface CompositeLifecycleState {
  asset: 'CROSS_ASSET';
  activeVersion: string;
  activeConfigHash: string;
  promotedAt: Date;
  promotedBy: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface CompositeLifecycleEvent {
  asset: 'CROSS_ASSET';
  version: string;
  type: 'PROMOTE' | 'ROLLBACK' | 'RESOLVE';
  parentVersions: ParentVersions;
  blendConfig: BlendConfig;
  createdAt: Date;
  createdBy: string;
  reason?: string;
}

// Audit types
export interface CompositeAuditResult {
  ok: boolean;
  checks: {
    weightsSum: { ok: boolean; value: number };
    weightsBounded: { ok: boolean; violations: string[] };
    noNaN: { ok: boolean; found: string[] };
    volPenaltyBounded: { ok: boolean; violations: string[] };
    confFactorBounded: { ok: boolean; violations: string[] };
    dailyReturnCapped: { ok: boolean; maxReturn: number };
    parentVersionsExist: { ok: boolean; missing: string[] };
  };
  errors: string[];
}
