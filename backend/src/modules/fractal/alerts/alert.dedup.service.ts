/**
 * BLOCK 67 — Alert Dedup Service
 * 
 * Prevents duplicate alerts within cooldown window.
 * Uses fingerprint-based deduplication.
 */

import { AlertLogModel } from './alert.model.js';
import { ALERT_POLICY } from './alert.policy.js';
import type { AlertLevel } from './alert.types.js';

export interface DedupResult {
  ok: boolean;
  reason?: 'COOLDOWN' | 'DEDUP';
  lastSeen?: Date;
  cooldownRemaining?: number;  // minutes
}

/**
 * Check if alert should be emitted (not in cooldown)
 */
export async function shouldEmitAlert(
  fingerprint: string,
  level: AlertLevel
): Promise<DedupResult> {
  const cooldownHours = ALERT_POLICY.cooldown[level];
  const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  
  // Find last alert with same fingerprint that was actually sent
  const lastAlert = await AlertLogModel.findOne({
    fingerprint,
    blockedBy: 'NONE',
    triggeredAt: { $gte: since }
  }).sort({ triggeredAt: -1 }).lean();
  
  if (lastAlert) {
    const cooldownEnd = new Date(lastAlert.triggeredAt.getTime() + cooldownHours * 60 * 60 * 1000);
    const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / (1000 * 60));
    
    return {
      ok: false,
      reason: 'COOLDOWN',
      lastSeen: lastAlert.triggeredAt,
      cooldownRemaining: remaining > 0 ? remaining : 0
    };
  }
  
  return { ok: true };
}

/**
 * Generate fingerprint for alert (for dedup)
 */
export function generateFingerprint(
  symbol: string,
  type: string,
  level: string,
  keyValues: Record<string, any> = {}
): string {
  // Create deterministic fingerprint
  const parts = [symbol, type, level];
  
  // Add key metric values for more precise dedup
  const sortedKeys = Object.keys(keyValues).sort();
  for (const key of sortedKeys) {
    const val = keyValues[key];
    if (val !== undefined && val !== null) {
      // Round numbers to avoid floating point issues
      const strVal = typeof val === 'number' ? val.toFixed(1) : String(val);
      parts.push(`${key}=${strVal}`);
    }
  }
  
  return parts.join('|');
}
