/**
 * EPIC D1 — Engine Signals Types
 * 
 * L1 interpretation of structural changes from Graph + Actors (L0).
 * Rules-only, NO ML, NO price predictions, NO trading advice.
 */

// Signal Types (structural observations only)
export type D1SignalType = 
  | 'NEW_CORRIDOR'
  | 'DENSITY_SPIKE'
  | 'DIRECTION_IMBALANCE'
  | 'ACTOR_REGIME_CHANGE'
  | 'NEW_BRIDGE'
  | 'CLUSTER_RECONFIGURATION';

// Signal Severity
export type D1Severity = 'low' | 'medium' | 'high';

// Signal Lifecycle Status
export type D1Status = 'new' | 'active' | 'cooling' | 'archived';

// Signal Scope
export type D1Scope = 'actor' | 'entity' | 'wallet' | 'cluster' | 'corridor';

// Time Window
export type D1Window = '24h' | '7d' | '30d';

// Direction for corridors
export type D1Direction = 'inflow' | 'outflow' | 'bidirectional' | 'neutral';

// Confidence Level
export type D1Confidence = 'low' | 'medium' | 'high';

// Entity Reference (actor, entity, wallet)
export interface D1EntityRef {
  kind: 'actor' | 'entity' | 'wallet';
  id: string;
  label: string;
  type?: string;
  source?: string;
  coverage?: number;
}

// Evidence for signal explanation
export interface D1Evidence {
  rule: {
    name: string;
    version: string;
    thresholds?: Record<string, number>;
  };
  baseline?: {
    density?: number;
    weight?: number;
    direction?: D1Direction;
    window?: string;
  };
  current?: {
    density?: number;
    weight?: number;
    direction?: D1Direction;
    window?: string;
  };
  persistence?: {
    hours?: number;
    firstSeenAt?: Date;
  };
  flows?: {
    inflowUsd?: number;
    outflowUsd?: number;
    netUsd?: number;
  };
  regime?: {
    previous?: string;
    current?: string;
    confidence?: number;
  };
  topEdges?: Array<{
    edgeId: string;
    from: D1EntityRef;
    to: D1EntityRef;
    edgeType: string;
    confidence: D1Confidence;
    weight: number;
    direction: D1Direction;
    density: number;
    why?: string;
  }>;
}

// Metrics for signal card preview
export interface D1Metrics {
  density?: { current: number; previous: number; deltaPct: number | null };
  inflowUsd?: number;
  outflowUsd?: number;
  netFlowRatio?: number;
  edgesCount?: number;
}

// Full Signal Document
export interface D1Signal {
  _id?: string;
  id: string;
  type: D1SignalType;
  scope: D1Scope;
  status: D1Status;
  severity: D1Severity;
  confidence: D1Confidence;
  window: D1Window;
  
  // Content
  title: string;
  subtitle?: string;
  disclaimer?: string;
  
  // Entities involved
  primary?: D1EntityRef;
  secondary?: D1EntityRef;
  entities: D1EntityRef[];
  
  // Direction & metrics
  direction?: D1Direction;
  metrics: D1Metrics;
  
  // Tags for filtering
  tags: string[];
  
  // Evidence for explanation
  evidence: D1Evidence;
  
  // Summary explanation
  summary?: {
    what: string;
    whyNow: string;
    soWhat: string;
  };
  
  // Links
  links: {
    graph?: string;
    primary?: string;
    secondary?: string;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  
  // Run tracking
  runId?: string;
}

// API Response types
export interface D1SignalListResponse {
  meta: {
    window: D1Window;
    status: D1Status | 'all';
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  items: D1Signal[];
}

export interface D1SignalStatsResponse {
  window: D1Window;
  counts: {
    active: number;
    new: number;
    cooling: number;
    archived: number;
    total: number;
  };
  byType: Record<D1SignalType, number>;
  bySeverity: Record<D1Severity, number>;
}

export interface D1SignalFacetsResponse {
  window: D1Window;
  types: D1SignalType[];
  statuses: D1Status[];
  scopes: D1Scope[];
  severity: D1Severity[];
  confidence: D1Confidence[];
}

// Query filters
export interface D1SignalQuery {
  window?: D1Window;
  status?: D1Status | D1Status[];
  type?: D1SignalType | D1SignalType[];
  scope?: D1Scope | D1Scope[];
  severity?: D1Severity | D1Severity[];
  confidence?: D1Confidence | D1Confidence[];
  q?: string;
  actorId?: string;
  entityId?: string;
  sort?: 'time' | 'severity' | 'confidence';
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

// Signal generation run
export interface D1SignalRun {
  runId: string;
  window: D1Window;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  stats: {
    created: number;
    updated: number;
    archived: number;
    errors: number;
  };
  error?: string;
}
