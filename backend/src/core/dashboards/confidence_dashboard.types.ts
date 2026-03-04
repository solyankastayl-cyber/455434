/**
 * P2.A — Confidence Dashboard Types
 * 
 * DTOs for confidence quality monitoring dashboard.
 */

export type ConfidenceBucket =
  | '0-40'
  | '41-60'
  | '61-79'
  | '80-90'
  | '91-100';

export interface ConfidenceHistogramRow {
  bucket: ConfidenceBucket;
  count: number;
}

export interface LifecycleRow {
  status: 'NEW' | 'ACTIVE' | 'COOLDOWN' | 'RESOLVED';
  count: number;
  avgConfidence: number;
}

export interface ActorScatterPoint {
  signalId: string;
  confidence: number;
  actorCount: number;
  diversityIndex: number; // uniqueActorTypes / actorCount
  status: string;
}

export interface DriftRow {
  day: string; // YYYY-MM-DD
  count: number;
  avgConfidence: number;
}

export interface ActorTypeRow {
  actorType: string;
  count: number;
}

export interface ConfidenceDashboardDTO {
  generatedAt: string;
  rangeDays: number;
  histogram: ConfidenceHistogramRow[];
  lifecycle: LifecycleRow[];
  scatterSample: ActorScatterPoint[];
  drift: DriftRow[];
  actorTypes: ActorTypeRow[];
  summary: {
    totalSignals: number;
    avgConfidence: number;
    highConfidenceCount: number;
    resolvedCount: number;
  };
}
