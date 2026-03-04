/**
 * BLOCK 67 — Alert Policy Configuration
 * 
 * BTC-only institutional policy:
 * - 3 INFO/HIGH per 24h rolling window
 * - CRITICAL always bypasses quota
 * - Cooldown prevents duplicate alerts
 */

import type { AlertLevel } from './alert.types.js';

export const ALERT_POLICY = {
  // Symbol restriction
  symbol: 'BTC' as const,
  
  // Quota: 3 INFO/HIGH per rolling 24h
  quota: {
    windowHours: 24,
    maxPerWindow: 3,
    levelsAffected: ['INFO', 'HIGH'] as AlertLevel[],
    criticalBypass: true
  },
  
  // Cooldown per level (hours)
  cooldown: {
    INFO: 6,
    HIGH: 6,
    CRITICAL: 1  // Short cooldown to prevent spam, but still allows critical
  } as Record<AlertLevel, number>,
  
  // Dedup window (same as cooldown for simplicity)
  dedupWindowHours: {
    INFO: 6,
    HIGH: 6,
    CRITICAL: 1
  } as Record<AlertLevel, number>,
  
  // Batch suppression: max alerts per single run
  batchLimits: {
    maxInfoPerRun: 1,
    maxHighPerRun: 1,
    maxCriticalPerRun: 3  // Allow multiple critical if needed
  },
  
  // Priority order (higher = more important)
  priorityOrder: [
    'CRISIS_ENTER',
    'CRISIS_EXIT',
    'TAIL_SPIKE',
    'HEALTH_DROP',
    'REGIME_SHIFT'
  ] as const,
  
  // Thresholds
  thresholds: {
    tailRisk: {
      high: 45,     // HIGH alert when mcP95_DD > 45%
      critical: 65  // CRITICAL when > 65%
    },
    health: {
      // Health level transitions that trigger alerts
      transitions: {
        'HEALTHY→WATCH': 'INFO',
        'WATCH→ALERT': 'HIGH',
        'ALERT→CRITICAL': 'CRITICAL'
      } as Record<string, AlertLevel>
    }
  }
} as const;

export type AlertPolicyType = typeof ALERT_POLICY;
