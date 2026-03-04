/**
 * C7 Cluster Contracts
 * Type definitions for clustering results
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export type ClusterMetric = 'cosine';
export type SeedStrategy = 'farthest';

export interface ClusterConfig {
  k: number;
  metric: ClusterMetric;
  maxIter: number;
  seedStrategy: SeedStrategy;
}

// ═══════════════════════════════════════════════════════════════
// DIMENSION NAMES
// ═══════════════════════════════════════════════════════════════

export type DimName =
  | 'macroSigned'
  | 'macroConfidence'
  | 'guardLevel'
  | 'dxySignalSigned'
  | 'dxyConfidence'
  | 'regimeBias90d';

export const DIM_NAMES: DimName[] = [
  'macroSigned',
  'macroConfidence',
  'guardLevel',
  'dxySignalSigned',
  'dxyConfidence',
  'regimeBias90d',
];

// ═══════════════════════════════════════════════════════════════
// CLUSTER INFO
// ═══════════════════════════════════════════════════════════════

export interface DominantDim {
  idx: number;
  name: string;
  value: number;
}

export interface ClusterStats {
  meanDistance: number;
  p90Distance: number;
}

export interface ClusterInfo {
  clusterId: number;
  label: string;
  size: number;
  centroid: number[];
  stats: ClusterStats;
  dominantDims: DominantDim[];
}

// ═══════════════════════════════════════════════════════════════
// RUN RESULT
// ═══════════════════════════════════════════════════════════════

export interface ClusterQuality {
  inertia: number;
  avgDistance: number;
  iters: number;
}

export interface ClusterRunResult {
  runId: string;
  createdAt: string;
  config: ClusterConfig;
  nSnapshots: number;
  dims: number;
  quality: ClusterQuality;
  clusters: ClusterInfo[];
}

// ═══════════════════════════════════════════════════════════════
// ASSIGNMENT
// ═══════════════════════════════════════════════════════════════

export interface ClusterAssignment {
  idx: number;
  clusterId: number;
  distance: number;
}

export interface ClusterTimelinePoint {
  ts: string;
  clusterId: number;
  label: string;
  distance: number;
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSES
// ═══════════════════════════════════════════════════════════════

export interface ClusterLatestResponse {
  ok: boolean;
  latestRun: ClusterRunResult | null;
}

export interface ClusterCurrentResponse {
  ok: boolean;
  ts: string;
  vec: number[];
  clusterId: number;
  label: string;
  distance: number;
  nearestCentroid: number[];
}

export interface ClusterTimelineResponse {
  ok: boolean;
  from: string;
  to: string;
  runId: string;
  points: ClusterTimelinePoint[];
}
