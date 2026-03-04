/**
 * Engine V2: Decision Policy (Gates)
 * 
 * Applies trading gates to determine BUY/SELL/NEUTRAL
 */
import type { EngineStatus } from './engine_status.js';

export interface PolicyConfig {
  minCoverageToTrade: number; // 60
  minEvidenceToTrade: number; // 65
  maxRiskToTrade: number;     // 60
  minDirectionStrength: number; // 20
}

export interface PolicyResult {
  decision: 'BUY' | 'SELL' | 'NEUTRAL';
  confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  gating: {
    enabled: boolean;
    blocked: boolean;
    reasons: string[];
  };
}

export const DEFAULT_CONFIG: PolicyConfig = {
  minCoverageToTrade: 60,
  minEvidenceToTrade: 65,
  maxRiskToTrade: 60,
  minDirectionStrength: 20,
};

/**
 * Apply decision policy gates
 * 
 * Rules:
 * - BUY/SELL requires: Evidence ≥65, Risk <60, Coverage ≥60, No critical drift
 * - Direction ≥+20 → BUY, ≤-20 → SELL, else NEUTRAL
 */
export function applyDecisionPolicy(params: {
  evidence: number;
  direction: number;
  coverage: number;
  risk: number;
  driftFlags: string[];
  status: EngineStatus;
  config?: Partial<PolicyConfig>;
}): PolicyResult {
  const cfg: PolicyConfig = { ...DEFAULT_CONFIG, ...params.config };
  
  const gatingReasons: string[] = [];
  
  // Hard gates
  if (params.coverage < cfg.minCoverageToTrade) {
    gatingReasons.push('low_coverage');
  }
  if (params.risk >= cfg.maxRiskToTrade) {
    gatingReasons.push('high_risk');
  }
  if (params.evidence < cfg.minEvidenceToTrade) {
    gatingReasons.push('low_evidence');
  }
  if (params.status === 'PROTECTION_MODE' || params.status === 'CRITICAL') {
    gatingReasons.push('protection_mode');
  }
  if (params.driftFlags.some(f => f.includes('collapse') || f.includes('extreme'))) {
    gatingReasons.push('critical_drift');
  }
  
  const blocked = gatingReasons.length > 0;
  
  if (blocked) {
    return {
      decision: 'NEUTRAL',
      confidenceBand: 'LOW',
      gating: { enabled: true, blocked: true, reasons: gatingReasons },
    };
  }
  
  // If not blocked, decide by direction
  if (params.direction >= cfg.minDirectionStrength) {
    return {
      decision: 'BUY',
      confidenceBand: params.evidence >= 80 ? 'HIGH' : 'MEDIUM',
      gating: { enabled: true, blocked: false, reasons: [] },
    };
  }
  
  if (params.direction <= -cfg.minDirectionStrength) {
    return {
      decision: 'SELL',
      confidenceBand: params.evidence >= 80 ? 'HIGH' : 'MEDIUM',
      gating: { enabled: true, blocked: false, reasons: [] },
    };
  }
  
  // Weak direction → NEUTRAL even if gates pass
  return {
    decision: 'NEUTRAL',
    confidenceBand: 'LOW',
    gating: { enabled: true, blocked: false, reasons: ['weak_direction'] },
  };
}
