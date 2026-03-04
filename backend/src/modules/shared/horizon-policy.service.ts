/**
 * HORIZON POLICY SERVICE
 * 
 * Single source of truth for horizon → windowLen mapping
 * Used by: BTC, SPX, DXY, CROSS_ASSET
 * 
 * Architecture:
 *   Horizon → resolveWindowLen() → FractalEngine.match() → PrimaryMatch → Forecast
 * 
 * Policy:
 *   - windowLen is proportional to horizon (up to cap)
 *   - aftermathDays = horizon days
 *   - topK remains configurable per asset
 */

export type Horizon = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';
export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';

/**
 * Resolve windowLen from horizon
 * 
 * Logic:
 *   - 7d/14d/30d (TIMING): windowLen = 45 (short-term patterns)
 *   - 90d (TACTICAL): windowLen = 60 (medium-term patterns)
 *   - 180d (STRUCTURE): windowLen = 120 (4 months of shape)
 *   - 365d (STRUCTURE): windowLen = 180 (6 months of shape)
 * 
 * Mathematical formula: min(floor(days * 0.5), 180)
 * But we use discrete values for stability.
 */
export function resolveWindowLen(horizon: Horizon): number {
  const days = parseInt(horizon.replace('d', ''), 10);
  
  if (days <= 30) return 45;   // TIMING tier
  if (days <= 90) return 60;   // TACTICAL tier (2 months)
  if (days <= 180) return 120; // STRUCTURE tier (4 months)
  return 180;                   // STRUCTURE tier (6 months)
}

/**
 * Resolve tier from horizon
 */
export function resolveTier(horizon: Horizon): Tier {
  const days = parseInt(horizon.replace('d', ''), 10);
  
  if (days <= 30) return 'TIMING';
  if (days <= 90) return 'TACTICAL';
  return 'STRUCTURE';
}

/**
 * Resolve aftermathDays from horizon
 * aftermathDays = horizon (how far into future to project)
 */
export function resolveAftermathDays(horizon: Horizon): number {
  return parseInt(horizon.replace('d', ''), 10);
}

/**
 * Full horizon config resolution
 */
export interface HorizonConfig {
  windowLen: number;
  aftermathDays: number;
  tier: Tier;
  topK: number;
}

/**
 * Resolve full horizon config
 * 
 * @param horizon - The horizon string (e.g., '90d')
 * @param topKOverride - Optional topK override (default varies by tier)
 */
export function resolveHorizonConfig(horizon: Horizon, topKOverride?: number): HorizonConfig {
  const tier = resolveTier(horizon);
  
  // Default topK by tier
  const defaultTopK = tier === 'TIMING' ? 25 : tier === 'TACTICAL' ? 20 : 15;
  
  return {
    windowLen: resolveWindowLen(horizon),
    aftermathDays: resolveAftermathDays(horizon),
    tier,
    topK: topKOverride ?? defaultTopK,
  };
}

/**
 * Validate horizon string
 */
export function isValidHorizon(value: string): value is Horizon {
  return ['7d', '14d', '30d', '90d', '180d', '365d'].includes(value);
}

/**
 * Parse horizon string safely
 */
export function parseHorizon(value: string): Horizon {
  if (isValidHorizon(value)) return value;
  
  // Fallback mapping
  const days = parseInt(value.replace(/[^0-9]/g, ''), 10) || 30;
  if (days <= 7) return '7d';
  if (days <= 14) return '14d';
  if (days <= 30) return '30d';
  if (days <= 90) return '90d';
  if (days <= 180) return '180d';
  return '365d';
}

// Export as namespace for compatibility
export const HorizonPolicy = {
  resolveWindowLen,
  resolveTier,
  resolveAftermathDays,
  resolveHorizonConfig,
  isValidHorizon,
  parseHorizon,
};

export default HorizonPolicy;
