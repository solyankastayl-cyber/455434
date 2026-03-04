/**
 * ETAP 6.3 — Snapshot Types
 * 
 * Type definitions for the Snapshot Layer.
 */

export type SnapshotWindow = '24h' | '7d' | '30d';

export interface SnapshotActor {
  actorId: string;
  name?: string;
  type?: string;
  
  inflow_usd: number;
  outflow_usd: number;
  net_flow_usd: number;
  tx_count: number;
  
  participation_trend: 'increasing' | 'stable' | 'decreasing';
  burst_score: number;
  
  coverage: number;
}

export interface SnapshotEdge {
  sourceId: string;
  targetId: string;
  edgeType: 'flow' | 'bridge' | 'corridor';
  
  weight: number;
  confidence: number;
  direction_balance: number;
  evidence_count: number;
}

export interface SnapshotStats {
  actorCount: number;
  edgeCount: number;
  totalVolume: number;
  avgBurstScore: number;
}

export interface SignalSnapshot {
  snapshotId: string;
  window: SnapshotWindow;
  snapshotAt: Date;
  
  actors: SnapshotActor[];
  edges: SnapshotEdge[];
  
  stats: SnapshotStats;
  
  createdAt: Date;
}
