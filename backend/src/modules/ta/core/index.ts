/**
 * TA Core Exports
 */

export * from './indicators.js';
export * from './pivots.js';
export * from './structure.js';
export * from './levels.js';
export * from './series.js';
export * from './fit.js';

// Detectors are in core/ for now (will move to detectors/ later)
export { TriangleDetector, DEFAULT_TRIANGLE_CONFIG } from './triangle.detector.js';
export { FlagDetector, DEFAULT_FLAG_CONFIG } from './flag.detector.js';
