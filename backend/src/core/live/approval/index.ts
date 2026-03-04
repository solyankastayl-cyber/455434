/**
 * Approval Gate Module Index
 * 
 * Exports all Approval Gate components.
 */

// Types
export * from './approval.types.js';

// Models
export { LiveFactApprovedModel, type ILiveFactApproved } from './models/live_fact_approved.model.js';
export { LiveApprovalCursorModel, type ILiveApprovalCursor } from './models/live_approval_cursor.model.js';

// Rules
export { evaluateContinuityRule } from './rules/continuity.rule.js';
export { evaluateVolumeSanityRule } from './rules/volume_sanity.rule.js';
export { evaluateDuplicationRule } from './rules/duplication.rule.js';
export { evaluateAnomalySpikeRule } from './rules/anomaly_spike.rule.js';
export { evaluateActorCoverageRule } from './rules/actor_coverage.rule.js';

// Engine
export { evaluateWindow, evaluateWindowBatch } from './services/approval-rules.engine.js';

// Service
export * from './services/approval-gate.service.js';

// Worker
export * from './worker/approval.worker.js';

// Routes
export { approvalRoutes } from './api/approval.routes.js';
