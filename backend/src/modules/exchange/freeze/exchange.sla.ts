/**
 * PHASE 1.4 — Exchange SLA Types
 * ===============================
 * Defines data quality SLA for Exchange observations
 */

export type DataMode = 'LIVE' | 'MIXED' | 'MOCK';

export interface ExchangeSLA {
  ok: boolean;
  dataMode: DataMode;
  completenessScore: number; // 0..1
  stalenessMs: number;
  providersUp: number;
  providersTotal: number;
  missingCritical: string[];
  reasons: string[];
}

export const SLA_THRESHOLDS = {
  minCompleteness: 0.85,
  maxStalenessMs: 2 * 60 * 1000, // 2 minutes
  minProvidersUp: 1, // Live requires at least 1 real provider
  criticalFields: ['price', 'candles'] as const,
};

export type GuardDecision = {
  sla: ExchangeSLA;
  downgradeFactor: number; // 0..1
  strongAllowed: boolean;
};

console.log('[Phase 1.4] Exchange SLA Types loaded');
