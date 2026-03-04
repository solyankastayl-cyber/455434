/**
 * S10.W Step 3 — Whale Indicator Calculators
 * 
 * Integrates 6 whale indicators into the standard S10 Indicator Registry.
 * 
 * Category: WHALE_POSITIONING
 * 
 * NO SIGNALS, NO PREDICTIONS — only measurements.
 */

import {
  IndicatorCalculator,
  IndicatorDefinition,
  IndicatorValue,
  IndicatorInput,
  INDICATOR_IDS,
} from '../indicator.types.js';
import { WhaleMarketState, WhaleIndicators } from '../../whales/whale.types.js';

// ═══════════════════════════════════════════════════════════════
// WHALE DATA CACHE (Updated by whale ingest job)
// ═══════════════════════════════════════════════════════════════

let cachedWhaleStates: Map<string, WhaleMarketState> = new Map();
let cachedWhaleIndicators: Map<string, WhaleIndicators> = new Map();
let lastCacheUpdate = 0;

/**
 * Update cached whale data (called by whale ingest job)
 */
export function updateWhaleCache(
  symbol: string,
  state: WhaleMarketState,
  indicators: WhaleIndicators
): void {
  cachedWhaleStates.set(symbol, state);
  cachedWhaleIndicators.set(symbol, indicators);
  lastCacheUpdate = Date.now();
}

/**
 * Get cached whale state for a symbol
 */
export function getCachedWhaleState(symbol: string): WhaleMarketState | null {
  return cachedWhaleStates.get(symbol) ?? null;
}

/**
 * Get cached whale indicators for a symbol
 */
export function getCachedWhaleIndicators(symbol: string): WhaleIndicators | null {
  return cachedWhaleIndicators.get(symbol) ?? null;
}

/**
 * Check if whale cache is stale
 */
export function isWhaleCacheStale(maxAgeMs = 60_000): boolean {
  return Date.now() - lastCacheUpdate > maxAgeMs;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const WHALE_DEFINITIONS: Record<string, IndicatorDefinition> = {
  [INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_PRESENCE]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_PRESENCE,
    name: 'Large Position Presence',
    category: 'WHALE_POSITIONING',
    description: 'Presence of oversized positions relative to market baseline',
    formula: 'clamp(maxSinglePositionUsd / (medianPositionUsd × k), 0, 1)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'No significant whale presence',
      neutral: 'Moderate whale activity',
      high: 'Large positions dominating',
    },
    dependencies: [],
    parameters: { k: 5 },
  },
  
  [INDICATOR_IDS.WHALE_POSITIONING.WHALE_SIDE_BIAS]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.WHALE_SIDE_BIAS,
    name: 'Whale Side Bias',
    category: 'WHALE_POSITIONING',
    description: 'Direction skew of large positions (long vs short)',
    formula: '(totalLongUsd - totalShortUsd) / (totalLongUsd + totalShortUsd)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Whales are net SHORT',
      neutral: 'Balanced whale positioning',
      high: 'Whales are net LONG',
    },
    dependencies: [],
    parameters: {},
  },
  
  [INDICATOR_IDS.WHALE_POSITIONING.POSITION_CROWDING_AGAINST_WHALES]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.POSITION_CROWDING_AGAINST_WHALES,
    name: 'Position Crowding Against Whales',
    category: 'WHALE_POSITIONING',
    description: 'How much retail is positioned against whale direction',
    formula: 'sign(WSB) × (retailFlowDelta / totalFlow)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Retail following whales',
      neutral: 'Neutral crowding',
      high: 'Retail pushing against whales',
    },
    dependencies: [INDICATOR_IDS.WHALE_POSITIONING.WHALE_SIDE_BIAS],
    parameters: {},
  },
  
  [INDICATOR_IDS.WHALE_POSITIONING.STOP_HUNT_PROBABILITY]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.STOP_HUNT_PROBABILITY,
    name: 'Stop-Hunt Probability Index',
    category: 'WHALE_POSITIONING',
    description: 'Risk that market will hunt whale stops',
    formula: '0.4 × |PCAW| + 0.3 × volatilitySpike + 0.3 × liquidityVacuum',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Low stop-hunt risk',
      neutral: 'Moderate stop-hunt risk',
      high: 'High stop-hunt risk',
    },
    dependencies: [INDICATOR_IDS.WHALE_POSITIONING.POSITION_CROWDING_AGAINST_WHALES],
    parameters: { w1: 0.4, w2: 0.3, w3: 0.3 },
  },
  
  [INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_SURVIVAL_TIME]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_SURVIVAL_TIME,
    name: 'Large Position Survival Time',
    category: 'WHALE_POSITIONING',
    description: 'How long whale positions survive (stability indicator)',
    formula: 'log(timeAlive / medianWhaleLifetime)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Position likely to be liquidated soon',
      neutral: 'Average survival',
      high: 'Position is stable',
    },
    dependencies: [],
    parameters: { medianLifetimeMs: 14400000 }, // 4 hours
  },
  
  [INDICATOR_IDS.WHALE_POSITIONING.CONTRARIAN_PRESSURE_INDEX]: {
    id: INDICATOR_IDS.WHALE_POSITIONING.CONTRARIAN_PRESSURE_INDEX,
    name: 'Contrarian Pressure Index',
    category: 'WHALE_POSITIONING',
    description: 'Ideal conditions for whale squeeze (synthesis indicator)',
    formula: '|PCAW| × SHPI × (1 - LPST_norm)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Market is calm for whales',
      neutral: 'Moderate pressure',
      high: 'Ideal conditions for whale liquidation',
    },
    dependencies: [
      INDICATOR_IDS.WHALE_POSITIONING.POSITION_CROWDING_AGAINST_WHALES,
      INDICATOR_IDS.WHALE_POSITIONING.STOP_HUNT_PROBABILITY,
      INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_SURVIVAL_TIME,
    ],
    parameters: {},
  },
};

// ═══════════════════════════════════════════════════════════════
// CALCULATOR FACTORY
// ═══════════════════════════════════════════════════════════════

function createWhaleCalculator(
  indicatorId: string,
  getValue: (indicators: WhaleIndicators) => number
): IndicatorCalculator {
  const definition = WHALE_DEFINITIONS[indicatorId];
  
  return {
    definition,
    calculate(input: IndicatorInput): IndicatorValue {
      // Try to get cached whale indicators
      const whaleIndicators = getCachedWhaleIndicators(input.symbol);
      
      // If no whale data, return neutral value
      if (!whaleIndicators) {
        const neutralValue = (definition.range.min + definition.range.max) / 2;
        return {
          id: indicatorId,
          category: 'WHALE_POSITIONING',
          value: neutralValue,
          normalized: true,
          interpretation: 'No whale data available',
          timestamp: Date.now(),
        };
      }
      
      const value = getValue(whaleIndicators);
      
      // Generate interpretation
      let interpretation: string;
      if (definition.range.min === -1 && definition.range.max === 1) {
        // Bipolar indicator
        if (value < -0.3) {
          interpretation = definition.interpretations.low;
        } else if (value > 0.3) {
          interpretation = definition.interpretations.high;
        } else {
          interpretation = definition.interpretations.neutral;
        }
      } else {
        // Unipolar indicator (0-1)
        if (value < 0.33) {
          interpretation = definition.interpretations.low;
        } else if (value > 0.66) {
          interpretation = definition.interpretations.high;
        } else {
          interpretation = definition.interpretations.neutral;
        }
      }
      
      return {
        id: indicatorId,
        category: 'WHALE_POSITIONING',
        value,
        normalized: true,
        interpretation,
        timestamp: Date.now(),
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// WHALE CALCULATORS (all 6)
// ═══════════════════════════════════════════════════════════════

export const whaleCalculators: IndicatorCalculator[] = [
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_PRESENCE,
    (ind) => ind.large_position_presence
  ),
  
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.WHALE_SIDE_BIAS,
    (ind) => ind.whale_side_bias
  ),
  
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.POSITION_CROWDING_AGAINST_WHALES,
    (ind) => ind.position_crowding_against_whales
  ),
  
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.STOP_HUNT_PROBABILITY,
    (ind) => ind.stop_hunt_probability
  ),
  
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.LARGE_POSITION_SURVIVAL_TIME,
    (ind) => ind.large_position_survival_time
  ),
  
  createWhaleCalculator(
    INDICATOR_IDS.WHALE_POSITIONING.CONTRARIAN_PRESSURE_INDEX,
    (ind) => ind.contrarian_pressure_index
  ),
];

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { WHALE_DEFINITIONS };

console.log('[S10.W] Whale Indicator Calculators loaded');
