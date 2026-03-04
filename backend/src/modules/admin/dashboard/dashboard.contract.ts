/**
 * Admin Dashboard Contract
 * 
 * Unified response structure for all admin dashboard endpoints.
 * This is the ONLY contract UI should use.
 */

export type AdminScope = 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';

export interface DashboardResponse {
  scope: AdminScope;

  version: {
    activeVersion: string | null;
    configHash: string | null;
    createdAt: string | null;
    configSource: 'mongo' | 'static';
  };

  health: {
    grade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
    hitRate: number | null;
    avgAbsError: number | null;
    sampleCount: number;
    modifier: number;
    frozen: boolean;
    consecutiveDegraded: number;
    reasons: string[];
  };

  governance: {
    windowLen: number | null;
    topK: number | null;
    consensusThreshold: number | null;
    minGapDays: number | null;
    configSource: 'mongo' | 'static';
  };

  drift: {
    avgError: number | null;
    avgAbsError: number | null;
    trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  };

  snapshots: {
    total: number;
    resolved: number;
    pending: number;
  };

  confidenceMeta: {
    base: number | null;
    modifier: number;
    final: number | null;
  };

  lastEvents: Array<{
    type: string;
    ts: string;
    details?: Record<string, any>;
  }>;

  meta: {
    computedAt: string;
    latencyMs: number;
  };
}
