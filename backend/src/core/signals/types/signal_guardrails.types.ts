/**
 * A2 - Signal Guardrails Types
 * 
 * Guardrails = safety rules that can OVERRIDE the signal decision
 * They don't change drivers A-F, only cap the final decision
 * 
 * Rules:
 * - G1: Quality Gate (LOW → NEUTRAL)
 * - G2: Indexer Gate (DEGRADED/PAUSED → NEUTRAL)
 * - G3: Driver Conflict Gate
 * - G4: Data Freshness Gate
 */

export type GuardrailBlockReason =
  | 'LOW_QUALITY'
  | 'INDEXER_DEGRADED'
  | 'INDEXER_PAUSED'
  | 'DRIVER_CONFLICT'
  | 'STALE_DATA';

export type SignalDecision = 'BUY' | 'SELL' | 'NEUTRAL';
export type SignalQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export type IndexerState = 'RUNNING' | 'DEGRADED' | 'PAUSED' | 'ERROR';

export interface DriverInfo {
  state: string;
  strength: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GuardrailInput {
  decision: SignalDecision;
  quality: SignalQuality;
  drivers: Record<string, DriverInfo>;
  indexerState: IndexerState;
  dataAgeSec: number;
}

export interface GuardrailResult {
  /** Final decision after guardrails applied */
  finalDecision: SignalDecision;
  /** Final quality after guardrails applied */
  finalQuality: SignalQuality;
  /** Whether any guardrail blocked the original decision */
  blocked: boolean;
  /** List of reasons that blocked */
  blockedBy: GuardrailBlockReason[];
  /** Original decision before guardrails */
  originalDecision: SignalDecision;
}

/**
 * Guardrail configuration
 */
export interface GuardrailConfig {
  /** Max data age in seconds before STALE_DATA */
  maxDataAgeSec: number;
  /** Minimum driver agreement to avoid conflict (0..1) */
  minDriverAgreement: number;
  /** Whether to enable each guardrail */
  enabled: {
    qualityGate: boolean;
    indexerGate: boolean;
    conflictGate: boolean;
    freshnessGate: boolean;
  };
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxDataAgeSec: 900, // 15 minutes
  minDriverAgreement: 0.4,
  enabled: {
    qualityGate: true,
    indexerGate: true,
    conflictGate: true,
    freshnessGate: true,
  },
};
