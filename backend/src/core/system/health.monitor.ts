/**
 * Health Monitor (Option B - B5)
 * 
 * Periodically checks system health and records state transitions.
 * Emits system_events only on changes.
 */
import { getSystemHealth, SystemStatus } from './health.service.js';
import { recordSystemEvent } from './system_events.model.js';
import { isHeartbeatStale } from './heartbeat.model.js';
import { BootstrapTaskModel } from '../bootstrap/bootstrap_tasks.model.js';

// Monitor state
let lastStatus: SystemStatus | null = null;
let monitorTimer: NodeJS.Timeout | null = null;

const CHECK_INTERVAL = 60_000; // 60 seconds
const FAILED_SPIKE_THRESHOLD = 10; // failures in 10 min

/**
 * Check for health transitions and record events
 */
async function checkHealthTransitions(): Promise<void> {
  try {
    const health = await getSystemHealth();
    const currentStatus = health.status;
    
    // Record state transition events
    if (lastStatus !== null && lastStatus !== currentStatus) {
      if (currentStatus === 'degraded' && lastStatus === 'healthy') {
        await recordSystemEvent(
          'health_degraded',
          'warn',
          `System degraded: ${health.notes.join(', ')}`,
          { previousStatus: lastStatus, notes: health.notes }
        );
      } else if (currentStatus === 'unhealthy') {
        await recordSystemEvent(
          'health_unhealthy',
          'critical',
          `System unhealthy: ${health.notes.join(', ')}`,
          { previousStatus: lastStatus, notes: health.notes }
        );
      } else if (currentStatus === 'healthy' && lastStatus !== 'healthy') {
        await recordSystemEvent(
          'health_recovered',
          'info',
          'System recovered to healthy state',
          { previousStatus: lastStatus }
        );
      }
    }
    
    lastStatus = currentStatus;
  } catch (err) {
    console.error('[HealthMonitor] Check failed:', err);
  }
}

/**
 * Check for bootstrap failure spikes
 */
async function checkFailureSpikes(): Promise<void> {
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentFailures = await BootstrapTaskModel.countDocuments({
      status: 'failed',
      updatedAt: { $gte: tenMinAgo },
    });
    
    if (recentFailures >= FAILED_SPIKE_THRESHOLD) {
      await recordSystemEvent(
        'bootstrap_failed_spike',
        'warn',
        `Bootstrap failure spike: ${recentFailures} failures in last 10 minutes`,
        { failedCount: recentFailures, threshold: FAILED_SPIKE_THRESHOLD }
      );
    }
  } catch (err) {
    console.error('[HealthMonitor] Failure spike check failed:', err);
  }
}

/**
 * Check for stale worker
 */
async function checkWorkerHealth(): Promise<void> {
  try {
    const isStale = await isHeartbeatStale('bootstrap_worker', 60);
    
    if (isStale) {
      await recordSystemEvent(
        'worker_stale',
        'warn',
        'Bootstrap worker heartbeat missing for >60s',
        {}
      );
    }
  } catch (err) {
    console.error('[HealthMonitor] Worker check failed:', err);
  }
}

/**
 * Run all health checks
 */
async function runChecks(): Promise<void> {
  await checkHealthTransitions();
  await checkFailureSpikes();
  await checkWorkerHealth();
}

/**
 * Start the health monitor
 */
export function startHealthMonitor(): void {
  if (monitorTimer) {
    console.log('[HealthMonitor] Already running');
    return;
  }
  
  console.log('[HealthMonitor] Starting (interval: 60s)');
  
  // Initial check after 10s (let system stabilize)
  setTimeout(runChecks, 10_000);
  
  // Regular checks
  monitorTimer = setInterval(runChecks, CHECK_INTERVAL);
}

/**
 * Stop the health monitor
 */
export function stopHealthMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    console.log('[HealthMonitor] Stopped');
  }
}
