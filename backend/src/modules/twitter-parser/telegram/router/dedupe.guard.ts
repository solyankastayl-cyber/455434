/**
 * Twitter Parser Module — Dedupe Guard
 * 
 * Prevents duplicate notifications.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY TTL values
 */

import type { TelegramEvent } from '../messages/event.types.js';

// Dedupe storage (in-memory)
const dedupeCache = new Map<string, number>();

// Dedupe TTL by event type (ms) — FROZEN
export const DEDUPE_TTL: Record<TelegramEvent, number> = {
  'NEW_TWEETS': 5 * 60 * 1000,        // 5 min - frequent event
  'SESSION_EXPIRED': 30 * 60 * 1000,  // 30 min - important, don't spam
  'SESSION_RESYNCED': 15 * 60 * 1000, // 15 min
  'SESSION_OK': 15 * 60 * 1000,       // 15 min
  'SESSION_STALE': 30 * 60 * 1000,    // 30 min
  'TARGET_COOLDOWN': 15 * 60 * 1000,  // 15 min
  'HIGH_RISK': 30 * 60 * 1000,        // 30 min
  'PARSE_COMPLETED': 5 * 60 * 1000,   // 5 min - noisy, short TTL
  'PARSE_ABORTED': 10 * 60 * 1000,    // 10 min
  'PARSER_DOWN': 10 * 60 * 1000,      // 10 min - critical
  'PARSER_UP': 5 * 60 * 1000,         // 5 min
  'ABORT_RATE_HIGH': 15 * 60 * 1000,  // 15 min
  'SYSTEM_COOLDOWN': 15 * 60 * 1000,  // 15 min
};

/**
 * Generate dedupe key
 */
export function getDedupeKey(event: TelegramEvent, userId?: string): string {
  return `${event}:${userId || 'system'}`;
}

/**
 * Check if event is duplicate
 */
export function isDuplicate(key: string, event: TelegramEvent): boolean {
  const lastSent = dedupeCache.get(key);
  if (!lastSent) return false;
  
  const ttl = DEDUPE_TTL[event] || 5 * 60 * 1000;
  return Date.now() - lastSent < ttl;
}

/**
 * Mark event as sent
 */
export function markSent(key: string): void {
  dedupeCache.set(key, Date.now());
  
  // Cleanup old entries periodically
  if (dedupeCache.size > 1000) {
    cleanupDedupeCache();
  }
}

/**
 * Cleanup expired dedupe entries
 */
export function cleanupDedupeCache(): void {
  const now = Date.now();
  const maxTTL = Math.max(...Object.values(DEDUPE_TTL));
  
  const entries = Array.from(dedupeCache.entries());
  for (let i = 0; i < entries.length; i++) {
    const [key, timestamp] = entries[i];
    if (now - timestamp > maxTTL) {
      dedupeCache.delete(key);
    }
  }
  
  console.log(`[DedupeGuard] Cache cleanup: ${dedupeCache.size} entries remaining`);
}

/**
 * Clear all dedupe entries (for testing)
 */
export function clearDedupeCache(): void {
  dedupeCache.clear();
}

/**
 * Get cache size (for monitoring)
 */
export function getDedupeCacheSize(): number {
  return dedupeCache.size;
}
