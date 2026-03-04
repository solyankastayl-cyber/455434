/**
 * SPX POLICY GOVERNANCE
 * 
 * BLOCK B6.15 — Constitution lifecycle management
 * 
 * Workflow: GENERATED → DRY_RUN → PROPOSED → APPLIED → ROLLED_BACK
 * 
 * APPLY gates:
 * - LIVE samples >= 30
 * - No negative drift in last 60 days
 * - No CRITICAL regime instability
 */

import { ConstitutionV2, RegimePolicy } from './regime.constitution.js';

// ===== GOVERNANCE TYPES =====

export type GovernanceStatus = 
  | 'GENERATED'    // Just created, not validated
  | 'DRY_RUN'      // Running in shadow mode
  | 'PROPOSED'     // Ready for review
  | 'APPLIED'      // Active in production
  | 'ROLLED_BACK'; // Reverted to previous

export interface ApplyGateResult {
  canApply: boolean;
  gates: {
    liveSamples: { passed: boolean; current: number; required: number };
    driftCheck: { passed: boolean; last60DaysDrift: number; threshold: number };
    stabilityCheck: { passed: boolean; criticalRegimes: string[] };
  };
  blockers: string[];
}

export interface ConstitutionVersion {
  hash: string;
  version: string;
  createdAt: string;
  engineVersion: string;
  preset: string;
  status: GovernanceStatus;
  
  // Constitution content
  policies: RegimePolicy[];
  summary: {
    totalRegimes: number;
    proven: number;
    moderate: number;
    unproven: number;
    negative: number;
  };
  
  // Metrics snapshot at creation
  metricsSnapshot: {
    totalSamples: number;
    liveSamples: number;
    lastComputedAt: string;
    topRegime: string;
    worstRegime: string;
  };
  
  // Lifecycle timestamps
  dryRunStartedAt?: string;
  proposedAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
  
  // Audit
  auditLog: AuditEntry[];
}

export interface AuditEntry {
  timestamp: string;
  action: GovernanceStatus | 'GATE_CHECK' | 'VALIDATION';
  actor: string;  // 'SYSTEM' or user ID
  details: string;
  metadata?: Record<string, any>;
}

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  preset: string;
  benchmarks: ('RAW_MODEL' | 'CONSTITUTION_FILTERED' | 'BUY_HOLD')[];
}

export interface BacktestResult {
  period: string;
  startDate: string;
  endDate: string;
  tradingDays: number;
  
  // Performance comparison
  performance: {
    rawModel: PerformanceMetrics;
    constitutionFiltered: PerformanceMetrics;
    buyHold: PerformanceMetrics;
  };
  
  // Regime breakdown
  regimePerformance: RegimePerformanceEntry[];
  
  // Constitution impact
  constitutionImpact: {
    maxDDReduction: number;      // % improvement
    sharpeImprovement: number;   // Absolute change
    hitRateChange: number;       // % change
    tradesFiltered: number;      // How many trades blocked
    valueAdded: number;          // Risk-adjusted return improvement
  };
  
  // Verdict
  verdict: 'APPLY_RECOMMENDED' | 'CAUTION' | 'DO_NOT_APPLY';
  reasons: string[];
}

export interface PerformanceMetrics {
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpeRatio: number;
  hitRate: number;
  totalTrades: number;
  winRate: number;
}

export interface RegimePerformanceEntry {
  regimeTag: string;
  tradingDays: number;
  rawReturn: number;
  filteredReturn: number;
  constitutionPolicy: string;
  blocked: boolean;
}

// ===== GOVERNANCE CONFIG =====

export const GOVERNANCE_CONFIG = {
  // APPLY gates
  MIN_LIVE_SAMPLES: 30,
  MAX_DRIFT_THRESHOLD: -0.05,  // -5% drift = block
  
  // DRY_RUN requirements
  MIN_DRY_RUN_DAYS: 7,
  
  // Backtest periods
  BACKTEST_PERIODS: [
    { name: '1950-1970 (Post-War)', start: '1950-01-01', end: '1969-12-31' },
    { name: '1970-1990 (Stagflation)', start: '1970-01-01', end: '1989-12-31' },
    { name: '2000-2010 (Dot-Com + GFC)', start: '2000-01-01', end: '2010-12-31' },
    { name: '2019-2022 (COVID Era)', start: '2019-01-01', end: '2022-12-31' },
  ],
  
  // Backtest thresholds for APPLY recommendation
  MIN_SHARPE_IMPROVEMENT: 0.05,
  MIN_MAXDD_REDUCTION: 0.02,   // At least 2% MaxDD reduction
  MAX_CAGR_DEGRADATION: -0.01, // Don't lose more than 1% CAGR
};

// ===== HELPER FUNCTIONS =====

/**
 * Create audit entry
 */
export function createAuditEntry(
  action: AuditEntry['action'],
  details: string,
  actor: string = 'SYSTEM',
  metadata?: Record<string, any>
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    action,
    actor,
    details,
    metadata,
  };
}

/**
 * Check if constitution can transition to new status
 */
export function canTransition(
  currentStatus: GovernanceStatus,
  targetStatus: GovernanceStatus
): boolean {
  const validTransitions: Record<GovernanceStatus, GovernanceStatus[]> = {
    GENERATED: ['DRY_RUN'],
    DRY_RUN: ['PROPOSED', 'GENERATED'],  // Can go back to GENERATED if issues
    PROPOSED: ['APPLIED', 'DRY_RUN'],    // Can go back to DRY_RUN for more testing
    APPLIED: ['ROLLED_BACK'],
    ROLLED_BACK: ['DRY_RUN'],            // Can retry after rollback
  };
  
  return validTransitions[currentStatus]?.includes(targetStatus) ?? false;
}

/**
 * Validate backtest results for APPLY recommendation
 */
export function evaluateBacktestForApply(results: BacktestResult[]): {
  recommendation: 'APPLY_RECOMMENDED' | 'CAUTION' | 'DO_NOT_APPLY';
  reasons: string[];
} {
  const reasons: string[] = [];
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const result of results) {
    const impact = result.constitutionImpact;
    
    // Check Sharpe improvement
    if (impact.sharpeImprovement >= GOVERNANCE_CONFIG.MIN_SHARPE_IMPROVEMENT) {
      positiveCount++;
      reasons.push(`${result.period}: Sharpe improved by ${(impact.sharpeImprovement * 100).toFixed(1)}%`);
    }
    
    // Check MaxDD reduction
    if (impact.maxDDReduction >= GOVERNANCE_CONFIG.MIN_MAXDD_REDUCTION) {
      positiveCount++;
      reasons.push(`${result.period}: MaxDD reduced by ${(impact.maxDDReduction * 100).toFixed(1)}%`);
    }
    
    // Check CAGR degradation
    const cagrDiff = result.performance.constitutionFiltered.cagr - result.performance.rawModel.cagr;
    if (cagrDiff < GOVERNANCE_CONFIG.MAX_CAGR_DEGRADATION) {
      negativeCount++;
      reasons.push(`${result.period}: WARNING - CAGR degraded by ${(Math.abs(cagrDiff) * 100).toFixed(1)}%`);
    }
  }
  
  // Decision
  if (negativeCount > 0 && negativeCount >= results.length / 2) {
    return { recommendation: 'DO_NOT_APPLY', reasons };
  }
  
  if (positiveCount >= results.length) {
    return { recommendation: 'APPLY_RECOMMENDED', reasons };
  }
  
  return { recommendation: 'CAUTION', reasons };
}

export default {
  GOVERNANCE_CONFIG,
  createAuditEntry,
  canTransition,
  evaluateBacktestForApply,
};
