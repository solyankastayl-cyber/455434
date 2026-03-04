/**
 * PHASE 3 — Adaptive Services Index
 * 
 * BLOCK 61: Adaptive Horizon Weighting
 * BLOCK 62: Adaptive Thresholds
 * BLOCK 63: Adaptive Conflict Policy
 * BLOCK 64: Adaptive Sizing Stack
 */

export * from './adaptive.types.js';
export { AdaptiveHorizonWeightService, getAdaptiveHorizonWeightService } from './adaptive.horizon-weight.service.js';
export { AdaptiveThresholdService, getAdaptiveThresholdService } from './adaptive.threshold.service.js';
export { AdaptiveConflictService, getAdaptiveConflictService } from './adaptive.conflict.service.js';
export { AdaptiveSizingService, getAdaptiveSizingService, type SizingBreakdown, type AdaptiveSizingResult } from './adaptive.sizing.service.js';
