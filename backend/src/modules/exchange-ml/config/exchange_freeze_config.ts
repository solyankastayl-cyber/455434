/**
 * Exchange Module Freeze Configuration
 * =====================================
 * 
 * v4.8.0 FROZEN CONFIGURATION
 * 
 * This file contains the immutable configuration snapshot for the Exchange module.
 * DO NOT MODIFY these values without creating a new version file.
 * 
 * Purpose:
 * - Protect proven configuration from accidental changes
 * - Document the exact parameters that achieved MaxDD < 25%
 * - Enable safe replication to other modules
 */

// ═══════════════════════════════════════════════════════════════
// FREEZE FLAG
// ═══════════════════════════════════════════════════════════════

export const EXCHANGE_FROZEN = process.env.EXCHANGE_FROZEN === 'true';

// ═══════════════════════════════════════════════════════════════
// IMMUTABLE CONFIG SNAPSHOT v1.0 (2026-02-16)
// ═══════════════════════════════════════════════════════════════

export const EXCHANGE_CONFIG_SNAPSHOT_V1 = Object.freeze({
  version: '1.0.0',
  frozenAt: '2026-02-16',
  validationResult: {
    maxDD: 0.231,  // 23.1% - target was < 25%
    trades: 52,
    concurrencyBlocks: 1552,
    chopBlocks: 156,
  },
  
  // ATR Multipliers for labeling
  atrMultipliers: Object.freeze({
    '1D': 0.8,
    '7D': 1.8,
    '30D': 3.2,
  }),
  
  // Concurrency Guard settings
  concurrency: Object.freeze({
    maxActive: { '1D': 3, '7D': 2, '30D': 1 },
    cooldownDays: { '1D': 0, '7D': 3, '30D': 7 },
  }),
  
  // Quality Filter thresholds
  quality: Object.freeze({
    minConfidence: { '1D': 0.55, '7D': 0.52, '30D': 0.50 },
    minEdgeProb: { '1D': 0.58, '7D': 0.57, '30D': 0.56 },
    minAtrPct: { '1D': 0.010, '7D': 0.012, '30D': 0.014 },
  }),
  
  // Regime gating
  regime: Object.freeze({
    chopHardDisable: true,
    chopSizeMultiplier: 0.25,
  }),
  
  // DD Guard
  ddGuard: Object.freeze({
    enabled: true,
    maxDD: 0.25,
    cooldownDays: 21,
  }),
  
  // Horizon enable flags
  enabledHorizons: Object.freeze({
    '1D': false,
    '7D': false,
    '30D': true,
  }),
  
  // Lifecycle (promotion/rollback)
  lifecycle: Object.freeze({
    promotionCooldownDays: 56,
    rollbackCooldownDays: 14,
    sustainedLiftWindows: 3,
    windowDays: 14,
    minTradesPerWindow: 10,
  }),
});

// ═══════════════════════════════════════════════════════════════
// FREEZE GUARDS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a lifecycle mutation should be blocked.
 */
export function shouldBlockLifecycleMutation(operation: string): boolean {
  if (!EXCHANGE_FROZEN) return false;
  
  const blockedOperations = [
    'retrain',
    'promote',
    'rollback',
    'schema_change',
    'config_update',
  ];
  
  return blockedOperations.some(op => operation.toLowerCase().includes(op));
}

/**
 * Get the current freeze status for admin display.
 */
export function getFreezeStatus(): {
  frozen: boolean;
  version: string;
  validationResult: typeof EXCHANGE_CONFIG_SNAPSHOT_V1.validationResult;
  allowedOperations: string[];
  blockedOperations: string[];
} {
  return {
    frozen: EXCHANGE_FROZEN,
    version: EXCHANGE_CONFIG_SNAPSHOT_V1.version,
    validationResult: EXCHANGE_CONFIG_SNAPSHOT_V1.validationResult,
    allowedOperations: ['inference', 'monitoring', 'read_config', 'read_metrics'],
    blockedOperations: EXCHANGE_FROZEN 
      ? ['retrain', 'promote', 'rollback', 'schema_change', 'config_update']
      : [],
  };
}

console.log(`[Exchange ML] Freeze config loaded: FROZEN=${EXCHANGE_FROZEN}`);
