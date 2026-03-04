/**
 * BLOCK 78 + 80.2 + 80.3 + 81 — Drift Intelligence Module Index
 */

export * from './drift.types.js';
export * from './drift.metrics.js';
export * from './drift.severity.js';
export { driftService } from './drift.service.js';
export { driftRoutes } from './drift.routes.js';

// BLOCK 80.2 — Drift Alerts
export { DriftAlertModel } from './drift-alert.model.js';
export { driftAlertService } from './drift-alert.service.js';
export { driftAlertRoutes } from './drift-alert.routes.js';

// BLOCK 80.3 — Consensus Timeline
export { ConsensusHistoryModel } from './consensus-history.model.js';
export { consensusTimelineService } from './consensus-timeline.service.js';
export { consensusTimelineRoutes } from './consensus-timeline.routes.js';

// BLOCK 81 — Drift Intelligence (LIVE vs V2014/V2020)
export * from './drift-intelligence.types.js';
export { driftIntelligenceService } from './drift-intelligence.service.js';
export { driftIntelligenceRoutes } from './drift-intelligence.routes.js';
export { DriftIntelHistoryModel } from './drift-intel-history.model.js';
