/**
 * Intelligence Layer Types
 * 
 * Unified format for intelligence signals across all G-layer modules
 */

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IntelligenceDomain = 'CYBERCRIME' | 'AML' | 'THREAT';

export interface IntelligenceSignal {
  id: string;                 // stable hash-like ID
  domain: IntelligenceDomain; // CYBERCRIME | AML | THREAT
  type: string;               // RAPID_DRAIN | FUNNEL_SCAM | BRIDGE_ESCAPE | etc
  severity: Severity;
  confidence: number;         // 0..1
  network: string;            // ethereum | arbitrum | etc
  subject: {                  // what is flagged
    kind: 'ADDRESS' | 'ACTOR' | 'EDGE' | 'CLUSTER';
    id: string;               // address/actorId/edgeId/clusterId
  };
  window: {                   // time window analyzed
    fromTs: number;           // unix seconds
    toTs: number;             // unix seconds
    label: '15m' | '1h' | '6h' | '24h' | '7d' | '30d';
  };
  metrics: Record<string, any>;   // detector-specific metrics
  evidence: Array<{
    kind: 'RELATION' | 'TRANSFER' | 'NOTE';
    ref?: string;                 // relationId / transferId
    text?: string;                // human-readable explanation
  }>;
  createdAtTs: number;        // when signal was generated
}

/**
 * Summary of intelligence signals for an entity
 */
export interface IntelligenceSummary {
  maxSeverity: Severity | null;
  maxConfidence: number;
  countsByType: Record<string, number>;
  countsBySeverity: Record<Severity, number>;
  lastComputedTs: number;
}

/**
 * Helper: severity rank for sorting
 */
export function severityRank(s: Severity): number {
  switch (s) {
    case 'CRITICAL': return 4;
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    default: return 0;
  }
}

/**
 * Helper: max severity
 */
export function severityMax(a: Severity, b: Severity): Severity {
  return severityRank(a) > severityRank(b) ? a : b;
}

/**
 * Helper: severity by USD amount (for cybercrime)
 */
export function severityByUsd(amountUsd: number): Severity {
  if (amountUsd >= 25_000_000) return 'CRITICAL';
  if (amountUsd >= 5_000_000) return 'HIGH';
  if (amountUsd >= 1_000_000) return 'MEDIUM';
  return 'LOW';
}

/**
 * Helper: clamp to [0, 1]
 */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Helper: format USD
 */
export function formatUsd(x: number): string {
  return `$${Math.round(x).toLocaleString()}`;
}
