/**
 * FRACTAL FREEZE MODULE
 * 
 * Exports all freeze-related utilities.
 */

// Config
export {
  getFreezeConfig,
  isOperationAllowed,
  isSymbolAllowed,
  isHorizonAllowed
} from './fractal.freeze.config.js';

export type { FreezeConfig } from './fractal.freeze.config.js';

// Guard
export {
  assertNotFrozen,
  assertSymbolAllowed,
  createFreezeGuardHook,
  freezeGuardMiddleware,
  getFreezeStatus,
  FreezeGuardError
} from './fractal.freeze.guard.js';

// Stamp
export {
  generateFreezeStamp,
  verifyContractHash
} from './fractal.freeze.stamp.js';

export type { FreezeStamp } from './fractal.freeze.stamp.js';
