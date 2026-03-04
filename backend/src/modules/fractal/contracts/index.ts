/**
 * FRACTAL CONTRACTS MODULE
 * 
 * Exports all contract-related types and utilities.
 */

// Contract types
export type {
  FractalSignalContract,
  FractalSignalDTO,
  FractalAction,
  FractalHorizon,
  FractalPreset,
  ReliabilityBadge,
  TailBadge,
  GovernanceMode,
  MarketPhase,
  SMA200Position
} from './fractal.signal.contract.js';

export {
  FRACTAL_CONTRACT_VERSION,
  FRACTAL_CONTRACT_HASH,
  FRACTAL_CONTRACT_FROZEN
} from './fractal.signal.contract.js';

// Validator
export {
  validateFractalSignal,
  createSafeHoldResponse
} from './fractal.signal.validator.js';

export type { ValidationResult } from './fractal.signal.validator.js';
