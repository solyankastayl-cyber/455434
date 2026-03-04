/**
 * System Module Index (Option B)
 */
export { getSystemHealth, type SystemHealthResponse, type SystemStatus } from './health.service.js';
export { updateHeartbeat, getHeartbeat, isHeartbeatStale } from './heartbeat.model.js';
export { acquireLock, refreshLock, releaseLock, getLockInfo } from './lock.model.js';
export { recordSystemEvent, getSystemEvents, cleanupOldEvents, type SystemEventType } from './system_events.model.js';
export { startHealthMonitor, stopHealthMonitor } from './health.monitor.js';
export { runStartupChecks, setupGracefulShutdown } from './startup.checks.js';
