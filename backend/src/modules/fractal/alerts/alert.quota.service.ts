/**
 * BLOCK 67 — Alert Quota Service
 * 
 * Enforces 3 INFO/HIGH alerts per rolling 24h window.
 * CRITICAL alerts always bypass quota.
 */

import { AlertLogModel } from './alert.model.js';
import { ALERT_POLICY } from './alert.policy.js';
import type { AlertLevel, AlertQuota, AlertStats } from './alert.types.js';

/**
 * Get current quota status
 */
export async function getQuotaStatus(): Promise<AlertQuota> {
  const { windowHours, maxPerWindow, levelsAffected } = ALERT_POLICY.quota;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Count sent alerts (blockedBy=NONE) in window
  const used = await AlertLogModel.countDocuments({
    triggeredAt: { $gte: since },
    level: { $in: levelsAffected },
    blockedBy: 'NONE'
  });
  
  return {
    windowHours,
    max: maxPerWindow,
    used,
    remaining: Math.max(0, maxPerWindow - used)
  };
}

/**
 * Check if alert can be sent (quota not exhausted)
 */
export async function canSendAlert(level: AlertLevel): Promise<{
  ok: boolean;
  reason?: 'QUOTA';
  quota: AlertQuota;
}> {
  // CRITICAL always bypasses quota
  if (level === 'CRITICAL' && ALERT_POLICY.quota.criticalBypass) {
    const quota = await getQuotaStatus();
    return { ok: true, quota };
  }
  
  const quota = await getQuotaStatus();
  
  if (quota.remaining <= 0) {
    return { ok: false, reason: 'QUOTA', quota };
  }
  
  return { ok: true, quota };
}

/**
 * Get alert statistics
 */
export async function getAlertStats(): Promise<AlertStats> {
  const now = Date.now();
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  
  const levels: AlertLevel[] = ['INFO', 'HIGH', 'CRITICAL'];
  
  const buildStats = async (since: Date): Promise<Record<AlertLevel, number>> => {
    const result: Record<AlertLevel, number> = { INFO: 0, HIGH: 0, CRITICAL: 0 };
    
    for (const level of levels) {
      result[level] = await AlertLogModel.countDocuments({
        triggeredAt: { $gte: since },
        level,
        blockedBy: 'NONE'
      });
    }
    
    return result;
  };
  
  return {
    last24h: await buildStats(last24h),
    last7d: await buildStats(last7d)
  };
}
