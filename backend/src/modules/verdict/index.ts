/**
 * VERDICT MODULE INDEX
 * 
 * Block 1: Added HealthState and VerdictHealthSnapshot exports.
 * Block 3: Added Position Sizing Service exports.
 */

// Types
export type {
  Horizon,
  Action,
  RiskLevel,
  ModelOutput,
  MarketSnapshot,
  VerdictConstraints,
  VerdictContext,
  Verdict,
  VerdictAdjustment,
  RuleResult,
  HealthState,
  VerdictHealthSnapshot,
} from "./contracts/verdict.types.js";

export type { VerdictEngine } from "./contracts/verdict.engine.js";

// Engine
export { VerdictEngineImpl } from "./runtime/verdict.engine.impl.js";

// Hooks
export { NoopMetaBrain } from "./runtime/meta_brain.hook.js";
export type { MetaBrainPort, MetaBrainInput, MetaBrainOutput } from "./runtime/meta_brain.hook.js";

export { NoopCalibration, applyCalibration } from "./runtime/calibration.hook.js";
export type { CalibrationPort } from "./runtime/calibration.hook.js";

export { NoopHealth } from "./runtime/health.hook.js";
export type { HealthPort, HealthResult } from "./runtime/health.hook.js";

// Block 3: Position Sizing Service
export { 
  calculatePositionSize, 
  positionSizingService, 
  PositionSizingService,
  type PositionSizingInput,
  type PositionSizingResult,
} from "./runtime/position-sizing.service.js";

// Adapters
export { IntelligenceMetaBrainAdapter } from "./runtime/intelligence.meta.adapter.js";
export { ShadowHealthAdapter } from "./adapters/shadow-health.adapter.js";

// Models
export { VerdictModel } from "./storage/verdict.model.js";
export { VerdictForecastModel } from "./storage/forecast.model.js";

// Utils
export { genId } from "./runtime/utils.js";

console.log('[Verdict] Module loaded (Blocks 1-3)');
