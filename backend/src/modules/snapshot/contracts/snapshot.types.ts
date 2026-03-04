/**
 * SNAPSHOT MODULE — Types
 * =======================
 * 
 * Immutable decision snapshots for sharing
 */

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT (IMMUTABLE RECORD)
// ═══════════════════════════════════════════════════════════════

export interface DecisionSnapshot {
  // Public ID (short hash for URLs)
  snapshotId: string;
  
  // Core decision data
  symbol: string;
  timestamp: number;
  
  // Decision
  action: 'BUY' | 'SELL' | 'AVOID';
  confidence: number;
  
  // Explainability (safe to expose)
  explainability: {
    verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    appliedRules: string[];
    blockedBy?: string;
    riskFlags: {
      whaleRisk: 'LOW' | 'MEDIUM' | 'HIGH';
      marketStress: 'NORMAL' | 'ELEVATED' | 'EXTREME';
      contradiction: boolean;
      liquidationRisk: boolean;
    };
    drivers: string[];
  };
  
  // Source metadata (no secrets)
  sourceMeta: {
    dataMode: 'LIVE' | 'MIXED' | 'MOCK';
    providersCount: number;
    mlReady: boolean;
    systemVersion: string;
  };
  
  // Creation metadata
  createdAt: number;
  expiresAt?: number;  // Optional TTL
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT CREATION REQUEST
// ═══════════════════════════════════════════════════════════════

export interface CreateSnapshotRequest {
  symbol: string;
  decisionId?: string;  // If creating from existing decision
}

export interface SnapshotResponse {
  ok: boolean;
  snapshot?: DecisionSnapshot;
  shareUrl?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const SYSTEM_VERSION = 'fomo-v1.0.0';
export const SNAPSHOT_TTL_DAYS = 90;  // Snapshots expire after 90 days
