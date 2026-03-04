/**
 * DXY DEFAULTS CONFIG — A3.8
 * 
 * Horizon-specific defaults for DXY Fractal Engine
 * 
 * Key insights:
 * - 30d = tactical (trading-enabled, short-term directional)
 * - 90d = regime (trading-disabled, macro filter only)
 * 
 * Based on walk-forward validation:
 * - 30d: OOS 2021-2025 shows 56.1% hit rate, equity 1.22 (✅ PRODUCTION)
 * - 90d: OOS 2021-2025 shows regime sensitivity (❌ REGIME ONLY)
 */

export type DxyFocus = "7d" | "14d" | "30d" | "90d" | "180d" | "365d";
export type WeightMode = "W0" | "W1" | "W2" | "W3";
export type DxyMode = "tactical" | "regime";

export interface DxyCoreConfig {
  focus: DxyFocus;
  windowLen: number;
  threshold: number;
  topK: number;
  weightMode: WeightMode;
}

/**
 * Horizon-specific default parameters
 * 
 * 7d/14d/30d (tactical):
 *   - windowLen=180: 6-month lookback for pattern matching (with 50+ years of data)
 *   - threshold=0.01: Tighter match filter
 *   - topK=10: More matches for robust averaging
 *   - weightMode=W2: sim^2 weighting
 * 
 * 90d+ (regime):
 *   - windowLen=365: 1-year lookback for macro patterns
 *   - threshold=0.03: Looser for regime detection
 *   - topK=10: Consistent match count
 *   - weightMode=W2: Consistent weighting
 */
export const DXY_DEFAULTS_BY_FOCUS: Record<DxyFocus, Omit<DxyCoreConfig, "focus">> = {
  "7d":   { windowLen: 180, threshold: 0.01, topK: 10, weightMode: "W2" },
  "14d":  { windowLen: 180, threshold: 0.01, topK: 10, weightMode: "W2" },
  "30d":  { windowLen: 180, threshold: 0.01, topK: 10, weightMode: "W2" },
  "90d":  { windowLen: 365, threshold: 0.03, topK: 10, weightMode: "W2" },
  "180d": { windowLen: 365, threshold: 0.03, topK: 10, weightMode: "W2" },
  "365d": { windowLen: 365, threshold: 0.03, topK: 10, weightMode: "W2" },
};

/**
 * Mode classification by horizon
 * 
 * tactical: Trading-enabled, generates actionable signals
 * regime: Trading-disabled, provides macro context/bias only
 */
export const DXY_MODE_BY_FOCUS: Record<DxyFocus, DxyMode> = {
  "7d": "tactical",
  "14d": "tactical",
  "30d": "tactical",
  "90d": "regime",
  "180d": "regime",
  "365d": "regime",
};

/**
 * Trading enabled flag by horizon
 * 
 * tactical horizons (7d, 14d, 30d) → tradingEnabled = true
 * regime horizons (90d, 180d, 365d) → tradingEnabled = false
 */
export const DXY_TRADING_ENABLED_BY_FOCUS: Record<DxyFocus, boolean> = {
  "7d": true,
  "14d": true,
  "30d": true,
  "90d": false,
  "180d": false,
  "365d": false,
};

/**
 * Resolve full config for a given focus horizon
 */
export function resolveDxyConfig(focus: DxyFocus): DxyCoreConfig {
  const defaults = DXY_DEFAULTS_BY_FOCUS[focus];
  if (!defaults) {
    // Fallback to 30d defaults
    return { focus, ...DXY_DEFAULTS_BY_FOCUS["30d"] };
  }
  return { focus, ...defaults };
}

/**
 * Get mode for horizon
 */
export function getDxyMode(focus: DxyFocus): DxyMode {
  return DXY_MODE_BY_FOCUS[focus] || "tactical";
}

/**
 * Check if trading is enabled for horizon
 */
export function isDxyTradingEnabled(focus: DxyFocus): boolean {
  return DXY_TRADING_ENABLED_BY_FOCUS[focus] ?? true;
}

/**
 * Generate warnings for regime mode
 */
export function getDxyWarnings(focus: DxyFocus): string[] {
  const warnings: string[] = [];
  const mode = getDxyMode(focus);
  
  if (mode === "regime") {
    warnings.push("REGIME_MODE: not intended as standalone trading alpha");
    warnings.push("Use as bias filter for shorter horizons (7d/14d/30d)");
  }
  
  return warnings;
}
