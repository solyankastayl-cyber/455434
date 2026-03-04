/**
 * BLOCK 76.2.2 — Weekly Digest Cron Scheduler
 * 
 * Automatic weekly digest with protection:
 * - No send if no resolved outcomes
 * - No send if sample < threshold
 * - No send if CRISIS regime (modified text)
 * 
 * Runs every Sunday at 10:00 UTC
 */

import { weeklyDigestService } from './weekly-digest.service.js';
import { attributionAggregatorService } from '../memory/attribution/attribution-aggregator.service.js';
import { getVolatilityRegimeService } from '../volatility/index.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CRON_CONFIG = {
  // Day of week: 0 = Sunday
  dayOfWeek: 0,
  // Hour (UTC)
  hour: 10,
  // Minute
  minute: 0,
  // Minimum samples required
  minSamples: 30,
  // Enable/disable
  enabled: process.env.WEEKLY_DIGEST_CRON !== 'false',
};

// ═══════════════════════════════════════════════════════════════
// PROTECTION CHECKS
// ═══════════════════════════════════════════════════════════════

interface ProtectionResult {
  canSend: boolean;
  reason: string;
  modifyMessage?: boolean;
}

async function checkProtections(symbol: string): Promise<ProtectionResult> {
  try {
    // Check 1: Get attribution data to verify resolved outcomes
    const attribution = await attributionAggregatorService.getAttributionData(
      symbol, '90d', 'balanced', 'ACTIVE'
    );
    
    const sampleCount = attribution.meta.sampleCount;
    
    // Protection: No resolved outcomes
    if (sampleCount === 0) {
      console.log('[WeeklyCron] Protection: No resolved outcomes');
      return {
        canSend: false,
        reason: 'No resolved outcomes in memory'
      };
    }
    
    // Protection: Sample count below threshold
    if (sampleCount < CRON_CONFIG.minSamples) {
      console.log(`[WeeklyCron] Protection: Low samples (${sampleCount} < ${CRON_CONFIG.minSamples})`);
      return {
        canSend: false,
        reason: `Insufficient samples: ${sampleCount} < ${CRON_CONFIG.minSamples} required`
      };
    }
    
    // Check 2: Volatility regime
    const volService = getVolatilityRegimeService();
    const volData = await volService.getLatestRegime(symbol);
    const regime = volData?.regime || 'NORMAL';
    
    // Protection: CRISIS regime - send with modified message
    if (regime === 'CRISIS') {
      console.log('[WeeklyCron] Protection: CRISIS regime - modifying message');
      return {
        canSend: true,
        reason: 'CRISIS regime detected',
        modifyMessage: true
      };
    }
    
    // All protections passed
    return {
      canSend: true,
      reason: 'All protections passed'
    };
    
  } catch (err: any) {
    console.error('[WeeklyCron] Protection check error:', err.message);
    return {
      canSend: false,
      reason: `Protection check error: ${err.message}`
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CRON JOB
// ═══════════════════════════════════════════════════════════════

let cronInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;

/**
 * Check if should run based on schedule
 */
function shouldRunNow(): boolean {
  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentDate = now.toISOString().slice(0, 10);
  
  // Already ran today
  if (lastRunDate === currentDate) {
    return false;
  }
  
  // Check day, hour, minute
  return (
    currentDay === CRON_CONFIG.dayOfWeek &&
    currentHour === CRON_CONFIG.hour &&
    currentMinute >= CRON_CONFIG.minute &&
    currentMinute < CRON_CONFIG.minute + 15 // 15-minute window
  );
}

/**
 * Execute weekly digest with protections
 */
async function executeWeeklyDigest(): Promise<void> {
  console.log('[WeeklyCron] Starting weekly digest execution...');
  
  const protection = await checkProtections('BTC');
  
  if (!protection.canSend) {
    console.log(`[WeeklyCron] Digest blocked: ${protection.reason}`);
    return;
  }
  
  // If CRISIS regime, log warning
  if (protection.modifyMessage) {
    console.log('[WeeklyCron] Running in CRISIS mode - digest will include warning');
  }
  
  // Send digest
  const result = await weeklyDigestService.sendWeeklyDigest('BTC');
  
  if (result.success) {
    lastRunDate = new Date().toISOString().slice(0, 10);
    console.log('[WeeklyCron] Weekly digest sent successfully');
  } else {
    console.log(`[WeeklyCron] Weekly digest failed: ${result.message}`);
  }
}

/**
 * Cron tick handler
 */
function cronTick(): void {
  if (!CRON_CONFIG.enabled) return;
  
  if (shouldRunNow()) {
    console.log('[WeeklyCron] Schedule matched, executing...');
    executeWeeklyDigest().catch(err => {
      console.error('[WeeklyCron] Execution error:', err);
    });
  }
}

/**
 * Start cron scheduler
 */
export function startWeeklyCron(): void {
  if (!CRON_CONFIG.enabled) {
    console.log('[WeeklyCron] Disabled via WEEKLY_DIGEST_CRON env');
    return;
  }
  
  console.log('[WeeklyCron] Starting scheduler...');
  console.log(`[WeeklyCron] Schedule: Sunday ${CRON_CONFIG.hour}:${String(CRON_CONFIG.minute).padStart(2, '0')} UTC`);
  console.log(`[WeeklyCron] Min samples: ${CRON_CONFIG.minSamples}`);
  
  // Check every minute
  cronInterval = setInterval(cronTick, 60 * 1000);
  
  // Also run immediately to check
  cronTick();
}

/**
 * Stop cron scheduler
 */
export function stopWeeklyCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[WeeklyCron] Scheduler stopped');
  }
}

/**
 * Manual trigger for testing
 */
export async function triggerWeeklyDigest(): Promise<{
  success: boolean;
  protection: ProtectionResult;
  result?: { success: boolean; message: string };
}> {
  console.log('[WeeklyCron] Manual trigger...');
  
  const protection = await checkProtections('BTC');
  
  if (!protection.canSend) {
    return { success: false, protection };
  }
  
  const result = await weeklyDigestService.sendWeeklyDigest('BTC');
  
  return {
    success: result.success,
    protection,
    result
  };
}

/**
 * Get cron status
 */
export function getWeeklyCronStatus(): {
  enabled: boolean;
  running: boolean;
  config: typeof CRON_CONFIG;
  lastRun: string | null;
  nextRun: string;
} {
  // Calculate next run
  const now = new Date();
  const nextSunday = new Date(now);
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  nextSunday.setUTCDate(nextSunday.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(CRON_CONFIG.hour, CRON_CONFIG.minute, 0, 0);
  
  if (nextSunday <= now) {
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  }
  
  return {
    enabled: CRON_CONFIG.enabled,
    running: cronInterval !== null,
    config: CRON_CONFIG,
    lastRun: lastRunDate,
    nextRun: nextSunday.toISOString()
  };
}

export default {
  startWeeklyCron,
  stopWeeklyCron,
  triggerWeeklyDigest,
  getWeeklyCronStatus,
  checkProtections,
};
