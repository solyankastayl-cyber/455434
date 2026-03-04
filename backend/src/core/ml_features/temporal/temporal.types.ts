/**
 * Temporal Feature Types
 * 
 * EPIC 7: Temporal Dynamics Implementation
 * Types for time-based features that capture MOVEMENT and CHANGE
 */

export type TemporalWindow = '24h' | '3d' | '7d' | '14d';

export type Regime = 'STARTING' | 'PEAKING' | 'FADING' | 'NOISE';

export interface TemporalFeatures {
  // Delta: absolute change
  delta: number;
  // Delta %: relative change
  deltaPct: number;
  // Slope: linear regression coefficient
  slope: number;
  // Acceleration: change in slope
  acceleration: number;
  // Consistency: direction stability (0..1)
  consistency: number;
  // Regime: phase classification
  regime: Regime;
}

export interface WindowedTemporalFeatures {
  '24h': TemporalFeatures;
  '3d': TemporalFeatures;
  '7d': TemporalFeatures;
  '14d': TemporalFeatures;
}

export interface MetricTemporalFeatures {
  net_flow: WindowedTemporalFeatures;
  inflow: WindowedTemporalFeatures;
  outflow: WindowedTemporalFeatures;
  tx_count: WindowedTemporalFeatures;
  active_wallets: WindowedTemporalFeatures;
}

export interface TemporalFeatureVector {
  // Flattened features for ML
  // Format: {metric}_{window}_{feature}
  // e.g., net_flow_7d_delta, net_flow_7d_slope, etc.
  [key: string]: number | string;
}

export interface TemporalSample {
  sampleId: string;
  tokenAddress: string;
  signalId?: string;
  createdAt: Date;
  
  // Raw temporal features by metric
  metrics: Partial<MetricTemporalFeatures>;
  
  // Flattened feature vector
  featureVector: TemporalFeatureVector;
  
  // Metadata
  gateVersion: string;
  sourceVersion: string;
}

// Time series data point
export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
}

// Aggregated engine data for temporal calculation
export interface EngineAggregateHistory {
  tokenAddress: string;
  metric: string;
  series: TimeSeriesPoint[];
}

// Windows in hours for calculations
export const WINDOW_HOURS: Record<TemporalWindow, number> = {
  '24h': 24,
  '3d': 72,
  '7d': 168,
  '14d': 336,
};

// All temporal windows
export const TEMPORAL_WINDOWS: TemporalWindow[] = ['24h', '3d', '7d', '14d'];

// Metrics to calculate temporal features for
export const TEMPORAL_METRICS = [
  'net_flow',
  'inflow', 
  'outflow',
  'tx_count',
  'active_wallets',
] as const;

export type TemporalMetric = typeof TEMPORAL_METRICS[number];
