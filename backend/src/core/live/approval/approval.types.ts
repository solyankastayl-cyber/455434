/**
 * Approval Gate Types
 * 
 * Type definitions for the Approval Gate system.
 * NO interpretations, NO BUY/SELL, NO ML features.
 */

export type ApprovalStatus = 'APPROVED' | 'QUARANTINED' | 'REJECTED';

export interface ApprovalMetrics {
  eventCount: number;
  volumeIn: string;
  volumeOut: string;
  netFlow: string;
  uniqueSenders: number;
  uniqueReceivers: number;
  firstBlock: number;
  lastBlock: number;
}

export interface ApprovalResult {
  status: ApprovalStatus;
  score: number;          // 0-100
  failedRules: string[];
  penalties: RulePenalty[];
}

export interface RulePenalty {
  rule: string;
  penalty: number;
  reason: string;
}

export interface RuleContext {
  currentWindow: WindowData;
  previousWindow?: WindowData;
  tokenSupply?: string;
}

export interface WindowData {
  token: string;
  window: '1h' | '6h' | '24h';
  windowStart: Date;
  windowEnd: Date;
  eventCount: number;
  inflowCount: number;
  outflowCount: number;
  inflowAmount: string;
  outflowAmount: string;
  netFlowAmount: string;
  uniqueSenders: number;
  uniqueReceivers: number;
  firstBlock: number;
  lastBlock: number;
}

// ==================== THRESHOLDS ====================

export const APPROVAL_THRESHOLDS = {
  APPROVED_MIN_SCORE: 80,
  QUARANTINED_MIN_SCORE: 50,
  // Below 50 = REJECTED
};

// ==================== RULE NAMES ====================

export const RULE_NAMES = {
  CONTINUITY: 'continuity',
  VOLUME_SANITY: 'volume_sanity',
  DUPLICATION: 'duplication',
  ANOMALY_SPIKE: 'anomaly_spike',
  ACTOR_COVERAGE: 'actor_coverage',
} as const;

export type RuleName = typeof RULE_NAMES[keyof typeof RULE_NAMES];
