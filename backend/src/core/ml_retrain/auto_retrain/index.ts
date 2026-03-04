/**
 * ML v2.2: Auto-Retrain Module
 * ML v2.3: Extended with mlVersion support (Feature Pruning + Sample Weighting)
 * 
 * Автоматическое, но контролируемое самообучение ML.
 * 
 * Триггеры:
 * - ACCURACY_DROP: accuracy7d < threshold
 * - DRIFT_HIGH: driftLevel >= HIGH
 * - TIME_ELAPSED: lastRetrainAt older than N hours
 * 
 * Guardrails:
 * - enabled=false по умолчанию
 * - cooldown после любого retrain
 * - maxJobsPerDay лимит
 * - lock на уровне task+network
 * 
 * ML Version:
 * - v2.1: Classic training (default)
 * - v2.3: Feature Pruning + Sample Weighting (optional, admin-controlled)
 * 
 * ВАЖНО: Auto-retrain НИКОГДА не меняет ACTIVE.
 * Только enqueue → SHADOW → eval → promote (при PASS)
 */

// Models
export { 
  MlRetrainPolicyModel, 
  seedDefaultPolicies, 
  DEFAULT_V23_CONFIG,
  type IMlRetrainPolicy,
  type IV23Config,
  type MlVersionType,
  type PruningModeType,
  type WeightingModeType,
} from './ml_retrain_policy.model.js';
export { MlAutoRetrainDecisionModel, type IMlAutoRetrainDecision, type DecisionType, type IDecisionSnapshot } from './ml_auto_retrain_decision.model.js';

// Services
export { AutoRetrainPolicyService, type EvaluationResult } from './auto_retrain_policy.service.js';
export { 
  startAutoRetrainScheduler, 
  stopAutoRetrainScheduler, 
  isSchedulerRunning,
  triggerEvaluation 
} from './auto_retrain_scheduler.service.js';

// Lock helpers
export { acquireLock, releaseLock, isLocked } from './ml_runtime_lock.service.js';

// Routes
export { adminMlAutoRetrainRoutes } from './admin.ml.auto_retrain.routes.js';
