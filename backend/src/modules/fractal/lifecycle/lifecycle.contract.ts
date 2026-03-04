/**
 * P1-A: Lifecycle Contract
 * 
 * Defines types for model versioning and lifecycle management.
 */

export type AssetKey = 'BTC' | 'SPX' | 'DXY';

export type LifecycleStatus = 'ACTIVE' | 'DEPRECATED' | 'SHADOW';

export type LifecycleEventType = 'PROMOTE' | 'DEPRECATE' | 'ROLLBACK';

/**
 * Current state of model lifecycle per asset
 */
export interface LifecycleStateDoc {
  asset: AssetKey;
  activeVersion: string;
  activeConfigHash: string;
  status: LifecycleStatus;
  promotedAt: Date;
  promotedBy?: string;
}

/**
 * Historical lifecycle events
 */
export interface LifecycleEventDoc {
  asset: AssetKey;
  version: string;
  type: LifecycleEventType;
  configHash: string;
  configSnapshot: any;
  createdAt: Date;
  createdBy?: string;
  notes?: string;
  fromVersion?: string; // For rollback events
}

/**
 * Prediction snapshot for version tracking
 */
export interface PredictionSnapshotDoc {
  asset: AssetKey;
  version: string;
  horizon: string;
  asOf: Date;
  asOfPrice: number;
  forecastPath: number[];
  upperBand?: number[];
  lowerBand?: number[];
  primaryMatchId?: string;
  resolved: boolean;
  resolvedAt?: Date;
  realizedReturn?: number;
  expectedReturn?: number;
  error?: number;
}

/**
 * Decision outcome for attribution/drift
 */
export interface DecisionOutcomeDoc {
  asset: AssetKey;
  version: string;
  horizon: string;
  snapshotId: string;
  predictedDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  actualDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  hit: boolean;
  predictedReturn: number;
  actualReturn: number;
  error: number;
  resolvedAt: Date;
}
