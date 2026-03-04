/**
 * Engine V2 Module Index
 */

// Types
export type { CoverageFeatures } from './coverage_features.js';
export type { CoverageScoreResult } from './coverage_score.js';
export type { RiskScoreResult } from './risk_score.js';
export type { SignalImpactResult } from './impact_model.js';
export type { EvidenceDirectionResult, TopSignal } from './evidence_direction.js';
export type { PolicyConfig, PolicyResult } from './decision_policy.js';
export type { ResolvedSubject } from './subject_resolver.js';
export type { EngineWindow } from './signals_fetcher.js';
export type { EngineStatus } from './engine_status.js';
export type { EngineV2Decision } from './engine_v2.service.js';

// Services
export { resolveSubject, resolveActorSlug, resolveTokenAddress } from './subject_resolver.js';
export { fetchSignalsBySubject, fetchAllSignals } from './signals_fetcher.js';
export { buildCoverageFeatures } from './coverage_features.builder.js';
export { computeCoverageScore } from './coverage_score.js';
export { buildRiskNotes } from './risk_notes.js';
export { computeSignalImpact } from './impact_model.js';
export { getSignalDirection } from './direction_model.js';
export { computeEvidenceAndDirection } from './evidence_direction.js';
export { computeDriftFlags } from './drift_flags.js';
export { computeRiskScore } from './risk_score.js';
export { computeEngineStatus } from './engine_status.js';
export { applyDecisionPolicy } from './decision_policy.js';

// Main service
export { decideV2, getEngineHealth } from './engine_v2.service.js';
