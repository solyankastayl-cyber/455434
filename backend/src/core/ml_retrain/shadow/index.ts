/**
 * BATCH 3: Shadow Inference & Evaluation Module
 * 
 * Сравнение ACTIVE vs SHADOW моделей на одинаковых данных.
 * Verdict определяет можно ли делать promotion.
 */

// Model
export { ShadowComparisonModel, type IShadowComparison, type ShadowVerdict, type MlTask } from './ml_shadow_comparison.model.js';

// Config
export { SHADOW_EVAL_RULES_VERSION, SHADOW_EVAL_THRESHOLDS, PRIMARY_NETWORKS, MIN_PASS_NETWORKS } from './shadow_eval.config.js';

// Metrics
export { computeBinaryMetrics, computeDelta, toLabelFromProb, type BinaryMetrics, type BinaryLabel } from './metrics.js';

// Verdict
export { makeVerdict, type VerdictResult } from './shadow_verdict.js';

// Service
export { ShadowRunnerService, type ShadowEvaluateRequest, type LabeledSample } from './shadow_runner.service.js';

// Routes
export { adminMlShadowRoutes } from './admin.ml.shadow.routes.js';
