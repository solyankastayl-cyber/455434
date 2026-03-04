/**
 * Advanced System Overview DTO
 * Answers: "Can I trust the system right now?"
 */

export type MLMode = 'RULES_ONLY' | 'SHADOW' | 'ACTIVE';
export type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SafetyStatus = 'SAFE' | 'DEGRADED';
export type RollbackStatus = 'ARMED' | 'TRIGGERED';

export interface SystemStateDTO {
  mlMode: MLMode;
  driftLevel: DriftLevel;
  safety: SafetyStatus;
  autoRollback: RollbackStatus;
}

export interface ProductImpactDTO {
  mlAffectsConfidence: boolean;
  avgMlModifier?: number;
  tokensAffected?: number;
  confidenceCapActive: boolean;
}

export interface CriticalEventDTO {
  type: 'AUTO_ROLLBACK' | 'DRIFT_SPIKE' | 'EVAL_FAILED' | 'DATASET_FREEZE';
  message: string;
  at: string;
}

export interface AdvancedSystemOverviewDTO {
  systemState: SystemStateDTO;
  productImpact: ProductImpactDTO;
  recentCriticalEvents: CriticalEventDTO[];
}
