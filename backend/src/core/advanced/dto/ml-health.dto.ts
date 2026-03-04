/**
 * Advanced ML Health DTO
 * Answers: "Is ML ready and safe to use?"
 */

export interface ReadinessDTO {
  status: 'READY' | 'NOT_READY';
  blockingReasons: string[];
}

export interface ShadowPerformanceDTO {
  comparisonAvailable: boolean;
  precisionLift?: number;
  fpDelta?: number;
  verdict?: 'OUTPERFORMS' | 'DEGRADED' | 'INCONCLUSIVE';
}

export interface SafetyDTO {
  killSwitch: 'ARMED' | 'TRIGGERED';
  lastRollbackReason?: string;
  ruleOverrides: number;
}

export interface ActionsDTO {
  canRetrain: boolean;
  canRunShadowEval: boolean;
  canDisableML: boolean;
}

export interface AdvancedMLHealthDTO {
  readiness: ReadinessDTO;
  shadowPerformance: ShadowPerformanceDTO;
  safety: SafetyDTO;
  actions: ActionsDTO;
}
