/**
 * Route ID Generator (P0.5)
 * 
 * Deterministic route ID generation for idempotent processing.
 */

import crypto from 'crypto';

/**
 * Generate deterministic route ID
 * Format: RV2:<sha256_hash_32chars>
 */
export function generateRouteId(
  wallet: string,
  windowStart: Date,
  windowEnd: Date,
  version: number = 1
): string {
  const data = [
    wallet.toLowerCase(),
    windowStart.toISOString(),
    windowEnd.toISOString(),
    version.toString()
  ].join(':');
  
  return `RV2:${crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
}

/**
 * Generate alert ID for idempotency
 */
export function generateAlertId(
  routeId: string,
  alertType: string,
  severity: string
): string {
  const data = [routeId, alertType, severity].join(':');
  return `ALERT:${crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)}`;
}

/**
 * Generate watchlist event ID
 */
export function generateWatchlistEventId(
  routeId: string,
  eventType: string,
  targetId: string
): string {
  const data = [routeId, eventType, targetId].join(':');
  return `WLE:${crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)}`;
}

/**
 * Parse time window from string
 */
export function parseTimeWindow(window: string): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;
  
  switch (window) {
    case '1h':
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '6h':
      start = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      break;
    case '24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    default:
      // Default to 24h
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  
  return { start, end };
}

/**
 * Get window string from dates
 */
export function getWindowString(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const diffHours = diffMs / (60 * 60 * 1000);
  
  if (diffHours <= 1) return '1h';
  if (diffHours <= 6) return '6h';
  if (diffHours <= 24) return '24h';
  return '7d';
}
