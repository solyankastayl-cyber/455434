/**
 * ML Quality Gates Index (P0.7)
 */

export {
  checkGates,
  checkGatesAndPersist,
  isAllowed,
  explainDecision,
  DEFAULT_GATE_CONFIG
} from './feature_gates_engine.service.js';

export type { GateConfig, GateCheckResult } from './feature_gates_engine.service.js';
