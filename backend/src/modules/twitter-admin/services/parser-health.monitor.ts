/**
 * Parser Health Monitor
 * 
 * Monitors twitter-parser-v2 health endpoint.
 * Auto-detects DOWN/RECOVERED states with debounce.
 * 
 * Features:
 * - Polls every 30 seconds
 * - Requires 2 consecutive failures for DOWN
 * - Sends Telegram alerts via SystemTelegramEvents
 * - Logs to AdminEventLog
 */

import axios from 'axios';
import { SystemTelegramEvents } from '../../telegram/system-telegram.notifier.js';

// Parser health endpoint (twitter-parser-v2)
const PARSER_URL = process.env.PARSER_HEALTH_URL || 'http://localhost:5001/health';
const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const FAIL_THRESHOLD = 2; // 2 consecutive failures = DOWN

let failCount = 0;
let isDown = false;
let downSince: Date | null = null;
let intervalId: NodeJS.Timeout | null = null;

async function checkHealth(): Promise<void> {
  try {
    const res = await axios.get(PARSER_URL, { timeout: 4000 });

    if (res.status === 200) {
      // Parser is UP
      if (isDown) {
        // RECOVERED!
        const downtimeMinutes = downSince 
          ? Math.round((Date.now() - downSince.getTime()) / 60000)
          : 0;
        
        isDown = false;
        failCount = 0;
        downSince = null;

        console.log(`[ParserMonitor] Parser RECOVERED after ${downtimeMinutes} minutes`);

        await SystemTelegramEvents.parserRecovered(downtimeMinutes);
      } else {
        failCount = 0;
      }
    }
  } catch (err: any) {
    failCount++;

    console.warn(`[ParserMonitor] Health check failed (${failCount}/${FAIL_THRESHOLD}):`, err.message);

    if (!isDown && failCount >= FAIL_THRESHOLD) {
      // Parser is DOWN
      isDown = true;
      downSince = new Date();

      const error = err?.response?.data?.message || err?.message || 'Unknown error';

      console.error('[ParserMonitor] Parser DOWN:', error);

      await SystemTelegramEvents.parserDown(error);
    }
  }
}

/**
 * Start the parser health monitor
 */
export function startParserHealthMonitor(): void {
  if (intervalId) {
    console.warn('[ParserMonitor] Already running');
    return;
  }

  console.log(`[ParserMonitor] Starting health monitor (interval: ${CHECK_INTERVAL_MS}ms, url: ${PARSER_URL})`);

  // Run immediately
  checkHealth();

  // Then every interval
  intervalId = setInterval(checkHealth, CHECK_INTERVAL_MS);
}

/**
 * Stop the parser health monitor
 */
export function stopParserHealthMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[ParserMonitor] Stopped');
  }
}

/**
 * Get current parser status (for API)
 */
export function getParserStatus(): { isDown: boolean; failCount: number; downSince: Date | null } {
  return { isDown, failCount, downSince };
}
