/**
 * BLOCK 67-68 — Alerts Module Index
 * 
 * Exports alert system components.
 */

export * from './alert.types.js';
export { AlertLogModel } from './alert.model.js';
export { ALERT_POLICY } from './alert.policy.js';
export { shouldEmitAlert, generateFingerprint } from './alert.dedup.service.js';
export { getQuotaStatus, canSendAlert, getAlertStats } from './alert.quota.service.js';
export { alertEngineService, runAlertEngine, evaluateAlerts, type AlertEngineContext } from './alert.engine.service.js';
export { sendAlertToTelegram, sendAlertsToTelegram } from './alert.tg.adapter.js';
export { registerAlertRoutes } from './alert.routes.js';
