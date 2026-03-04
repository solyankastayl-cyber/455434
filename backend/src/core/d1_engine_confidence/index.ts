/**
 * ETAP 7 — Confidence Module
 * P0: Actor weights, multi-actor confirmation, cap guard
 * P1: Lifecycle, temporal decay, explainability trace
 * P2.B: Cluster confirmation, anti-manipulation rules
 */
export * from './confidence.types.js';
export * from './confidence.calculator.js';
export * from './confidence.reasons.js';
export * from './temporal.decay.js';
export * from './confidence.trace.js';

// P2.B: Cluster confirmation
export * from './cluster_confirmation.types.js';
export * from './cluster_resolver.js';
export * from './cluster_builder.js';
export * from './cluster_confirmation.rules.js';
