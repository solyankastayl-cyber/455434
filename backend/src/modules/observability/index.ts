/**
 * PHASE 2 — Observability Module
 * ===============================
 * Transparency & Diagnostics Layer
 */

export * from './contracts/observability.types.js';
export { TimelineEventModel } from './storage/timeline.event.model.js';
export { timelineService } from './services/timeline.service.js';
export { systemStatusService } from './services/system.status.service.js';
export { dataQualityService } from './services/dataquality.service.js';
export { truthAnalyticsService } from './services/truth.analytics.service.js';
export { registerObservabilityRoutes } from './routes/observability.routes.js';

console.log('[Phase 2] Observability Module loaded');
