/**
 * CAPITAL SCALING MODULE — v2.3
 * 
 * Risk Budget Targeting Layer
 * Institutional-grade capital allocation scaling
 */

export { capitalScalingRoutes } from './capital_scaling.routes.js';
export { 
  getCapitalScalingService,
  applyCapitalScaling,
  previewCapitalScaling,
  getRealized30dVol,
  CapitalScalingService
} from './capital_scaling.service.js';
export {
  getCapitalConfig,
  updateCapitalConfig,
  resetCapitalConfig,
  CAPITAL_CONFIG
} from './capital_scaling.config.js';
export type {
  CapitalScalingConfig
} from './capital_scaling.config.js';
export type {
  CapitalScalingMode,
  CapitalScalingInput,
  CapitalScalingResult,
  CapitalScalingPack,
  CapitalScalingDrivers,
  AllocationState,
  GuardLevel,
  ScenarioType
} from './capital_scaling.contract.js';
