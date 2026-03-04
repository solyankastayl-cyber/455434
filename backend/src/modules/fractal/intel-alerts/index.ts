/**
 * BLOCK 83 — Intel Alerts Module Index
 */

export { IntelEventAlertModel } from './intel-alerts.model.js';
export { intelAlertsService } from './intel-alerts.service.js';
export { detectIntelEvents, type DetectedEvent, type IntelDaily } from './intel-alerts.detector.js';
export { registerIntelAlertsRoutes } from './intel-alerts.routes.js';
export * from './intel-alerts.types.js';
