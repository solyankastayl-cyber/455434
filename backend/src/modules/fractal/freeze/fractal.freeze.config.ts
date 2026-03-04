/**
 * FRACTAL FREEZE CONFIGURATION
 * 
 * Production freeze controls.
 * When FRACTAL_FROZEN=true:
 * - No parameter changes allowed
 * - No model replacements
 * - No training/calibration
 * - Read-only governance
 */

export interface FreezeConfig {
  frozen: boolean;
  frozenAt: string | null;
  version: string;
  allowedSymbols: string[];
  allowedHorizons: number[];
  allowedOperations: string[];
  blockedOperations: string[];
}

/**
 * Load freeze configuration from environment
 */
export function getFreezeConfig(): FreezeConfig {
  const frozen = process.env.FRACTAL_FROZEN === 'true';
  const version = process.env.FRACTAL_VERSION || 'v2.1.0';

  return {
    frozen,
    frozenAt: frozen ? (process.env.FRACTAL_FROZEN_AT || new Date().toISOString()) : null,
    version,
    allowedSymbols: ['BTC'],
    allowedHorizons: [7, 14, 30],
    
    // Always allowed (read + operational)
    allowedOperations: [
      'GET_SIGNAL',
      'GET_CHART',
      'GET_OVERLAY',
      'GET_EXPLAIN',
      'GET_ADMIN_STATUS',
      'GET_ADMIN_OVERVIEW',
      'WRITE_SNAPSHOT',      // Operational
      'RESOLVE_OUTCOMES',    // Operational
      'REBUILD_EQUITY',      // Operational
      'SEND_TELEGRAM',       // Notification
      'AUDIT_LOG'            // Logging
    ],
    
    // Blocked when frozen
    blockedOperations: [
      'UPDATE_WEIGHTS',
      'UPDATE_PRESETS',
      'UPDATE_CALIBRATION',
      'UPDATE_GUARDRAILS',
      'REPLACE_MODEL',
      'AUTO_PROMOTE',
      'AUTO_TRAIN',
      'HYPEROPT',
      'DRIFT_CORRECT'
    ]
  };
}

/**
 * Check if an operation is allowed
 */
export function isOperationAllowed(operation: string): boolean {
  const config = getFreezeConfig();
  
  if (!config.frozen) {
    return true; // Everything allowed if not frozen
  }
  
  if (config.allowedOperations.includes(operation)) {
    return true;
  }
  
  if (config.blockedOperations.includes(operation)) {
    return false;
  }
  
  // Default: block unknown operations when frozen
  return false;
}

/**
 * Check if symbol is allowed
 */
export function isSymbolAllowed(symbol: string): boolean {
  const config = getFreezeConfig();
  return config.allowedSymbols.includes(symbol.toUpperCase());
}

/**
 * Check if horizon is allowed
 */
export function isHorizonAllowed(horizon: number): boolean {
  const config = getFreezeConfig();
  return config.allowedHorizons.includes(horizon);
}
