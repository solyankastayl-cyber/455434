/**
 * Phase 3.0: Execution Simulator - Configuration
 * 
 * Defines simulation parameters including fees, slippage,
 * and execution rules.
 */

// ═══════════════════════════════════════════════════════════════
// SIMULATOR CONFIG
// ═══════════════════════════════════════════════════════════════

export interface SimConfig {
  // Costs (in basis points, 1 bps = 0.01%)
  feeBps: number;              // Trading fees (e.g., 4 = 0.04%)
  slippageBps: number;         // Market impact (e.g., 6 = 0.06%)
  
  // Execution rules
  stopFirst: boolean;          // On same-candle stop+target: stop wins (conservative)
  allowPartialFills: boolean;  // v1: false
  
  // Position limits
  maxOnePosition: boolean;     // v1: true (TOP1 mode)
  maxPositions: number;        // For future portfolio mode
  
  // Order expiry
  defaultEntryTimeoutBars: number;
  defaultTradeTimeoutBars: number;
  
  // Fill model
  useOHLC: boolean;            // true = check against OHLC, false = close only
  gapHandling: 'WORST' | 'BEST' | 'CLOSE';  // How to handle gaps
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG (Conservative v1)
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_SIM_CONFIG: SimConfig = {
  // Typical crypto exchange fees
  feeBps: 4,
  slippageBps: 6,
  
  // Conservative execution
  stopFirst: true,
  allowPartialFills: false,
  
  // Single position mode
  maxOnePosition: true,
  maxPositions: 1,
  
  // Timeouts
  defaultEntryTimeoutBars: 5,
  defaultTradeTimeoutBars: 40,
  
  // Fill model
  useOHLC: true,
  gapHandling: 'WORST',
};

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME-SPECIFIC CONFIGS
// ═══════════════════════════════════════════════════════════════

export const TIMEFRAME_SIM_CONFIGS: Record<string, Partial<SimConfig>> = {
  '1m': {
    slippageBps: 10,           // Higher slippage on lower TF
    defaultEntryTimeoutBars: 10,
    defaultTradeTimeoutBars: 60,
  },
  '5m': {
    slippageBps: 8,
    defaultEntryTimeoutBars: 8,
    defaultTradeTimeoutBars: 50,
  },
  '15m': {
    slippageBps: 7,
    defaultEntryTimeoutBars: 6,
    defaultTradeTimeoutBars: 45,
  },
  '1h': {
    slippageBps: 6,
    defaultEntryTimeoutBars: 5,
    defaultTradeTimeoutBars: 40,
  },
  '4h': {
    slippageBps: 5,
    defaultEntryTimeoutBars: 4,
    defaultTradeTimeoutBars: 35,
  },
  '1d': {
    slippageBps: 4,
    defaultEntryTimeoutBars: 3,
    defaultTradeTimeoutBars: 30,
  },
  '1w': {
    slippageBps: 3,
    defaultEntryTimeoutBars: 2,
    defaultTradeTimeoutBars: 20,
  },
};

/**
 * Get config for specific timeframe
 */
export function getSimConfig(tf: string): SimConfig {
  const override = TIMEFRAME_SIM_CONFIGS[tf.toLowerCase()] || {};
  return { ...DEFAULT_SIM_CONFIG, ...override };
}
