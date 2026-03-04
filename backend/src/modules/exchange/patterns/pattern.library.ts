/**
 * S10.5 — Pattern Library (v1)
 * 
 * 14 formalized exchange patterns across 5 categories.
 * 
 * CATEGORIES:
 * - FLOW (4): Order flow behavior
 * - OI (3): Open interest patterns
 * - LIQUIDATION (3): Liquidation-based patterns
 * - VOLUME (2): Volume patterns
 * - STRUCTURE (2): Market structure patterns
 * 
 * Each pattern is EXPLAIN-ONLY, not a signal.
 */

import { PatternDefinition, PatternCategory, PatternTimeframe } from './pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// FLOW PATTERNS (1-4)
// ═══════════════════════════════════════════════════════════════

const FLOW_PATTERNS: PatternDefinition[] = [
  {
    id: 'FLOW_AGGRESSIVE_BUY_ABSORPTION',
    name: 'Aggressive Buy Absorption',
    category: 'FLOW',
    description: 'Heavy buying pressure being absorbed by passive sellers. Price not rising despite buy aggression.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      minBuyDominance: 0.6,      // 60%+ buy aggression
      maxPriceChange: 0.3,       // Price moves less than 0.3%
      minAbsorptionStrength: 0.5,
    },
  },
  {
    id: 'FLOW_AGGRESSIVE_SELL_ABSORPTION',
    name: 'Aggressive Sell Absorption',
    category: 'FLOW',
    description: 'Heavy selling pressure being absorbed by passive buyers. Price not falling despite sell aggression.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      minSellDominance: 0.6,     // 60%+ sell aggression
      maxPriceChange: 0.3,       // Price moves less than 0.3%
      minAbsorptionStrength: 0.5,
    },
  },
  {
    id: 'FLOW_BUYER_EXHAUSTION',
    name: 'Buyer Exhaustion',
    category: 'FLOW',
    description: 'Buy pressure fading after sustained buying. Volume dropping, aggression weakening.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      maxBuyDominance: 0.45,     // Dominance dropped below 45%
      minPriorBuyDominance: 0.6, // Was above 60% before
      minVolumeDropPct: 20,      // Volume dropped 20%+
    },
  },
  {
    id: 'FLOW_SELLER_EXHAUSTION',
    name: 'Seller Exhaustion',
    category: 'FLOW',
    description: 'Sell pressure fading after sustained selling. Volume dropping, aggression weakening.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      maxSellDominance: 0.45,    // Dominance dropped below 45%
      minPriorSellDominance: 0.6,// Was above 60% before
      minVolumeDropPct: 20,      // Volume dropped 20%+
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// OI PATTERNS (5-7)
// ═══════════════════════════════════════════════════════════════

const OI_PATTERNS: PatternDefinition[] = [
  {
    id: 'OI_EXPANSION_FLAT_PRICE',
    name: 'OI Expansion + Flat Price',
    category: 'OI',
    description: 'Open interest growing significantly while price stays flat. New positions being built without directional move.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      minOiChangePct: 5,         // OI grows 5%+
      maxPriceChangePct: 0.5,    // Price moves less than 0.5%
    },
  },
  {
    id: 'OI_COLLAPSE_AFTER_EXPANSION',
    name: 'OI Collapse After Expansion',
    category: 'OI',
    description: 'Sharp OI drop after period of growth. Positions being closed en masse.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      minOiDropPct: 8,           // OI drops 8%+
      minPriorOiGrowth: 5,       // Had 5%+ growth before
    },
  },
  {
    id: 'OI_DIVERGENCE_PRICE',
    name: 'OI Divergence vs Price',
    category: 'OI',
    description: 'Price moving in one direction while OI moves opposite. Potential trend weakness signal.',
    defaultTimeframe: 'SWING',
    thresholds: {
      minPriceChangePct: 1,      // Price moves 1%+
      oiDirectionOpposite: true, // OI moves opposite to price
      minOiChangePct: 3,         // OI changes 3%+
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// LIQUIDATION PATTERNS (8-10)
// ═══════════════════════════════════════════════════════════════

const LIQUIDATION_PATTERNS: PatternDefinition[] = [
  {
    id: 'LIQ_LONG_SQUEEZE_CONTINUATION',
    name: 'Long Squeeze Continuation',
    category: 'LIQUIDATION',
    description: 'Ongoing long liquidations with price continuing to drop. Cascade effect still active.',
    defaultTimeframe: 'SCALP',
    thresholds: {
      cascadeActive: true,
      cascadeDirection: 'LONG',
      minPhase: 'ACTIVE',        // At least ACTIVE phase
    },
  },
  {
    id: 'LIQ_SHORT_SQUEEZE_EXHAUSTION',
    name: 'Short Squeeze Exhaustion',
    category: 'LIQUIDATION',
    description: 'Short squeeze losing momentum. Cascade entering DECAY phase.',
    defaultTimeframe: 'SCALP',
    thresholds: {
      cascadeActive: true,
      cascadeDirection: 'SHORT',
      phase: 'DECAY',
    },
  },
  {
    id: 'LIQ_CASCADE_EXHAUSTION_ZONE',
    name: 'Cascade Exhaustion Zone',
    category: 'LIQUIDATION',
    description: 'Liquidation cascade ending. Market potentially stabilizing.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      cascadePhase: 'END',
      minPriorIntensity: 'HIGH',
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// VOLUME PATTERNS (11-12)
// ═══════════════════════════════════════════════════════════════

const VOLUME_PATTERNS: PatternDefinition[] = [
  {
    id: 'VOL_SPIKE_NO_FOLLOWTHROUGH',
    name: 'Volume Spike Without Follow-Through',
    category: 'VOLUME',
    description: 'Large volume spike but price returned to origin. Failed move, liquidity grab.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      minVolumeRatio: 2.0,       // 2x average volume
      maxPriceChangePct: 0.5,    // Price back to flat
    },
  },
  {
    id: 'VOL_COMPRESSION',
    name: 'Volume Compression',
    category: 'VOLUME',
    description: 'Volume significantly below average. Market in consolidation, potential breakout ahead.',
    defaultTimeframe: 'SWING',
    thresholds: {
      maxVolumeRatio: 0.5,       // Volume below 50% of average
      minDurationBars: 3,        // At least 3 periods
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// STRUCTURE PATTERNS (13-14)
// ═══════════════════════════════════════════════════════════════

const STRUCTURE_PATTERNS: PatternDefinition[] = [
  {
    id: 'STRUCT_RANGE_TRAP',
    name: 'Range Trap (False Breakout)',
    category: 'STRUCTURE',
    description: 'Price broke range boundary but immediately reversed. Trapped traders on wrong side.',
    defaultTimeframe: 'INTRADAY',
    thresholds: {
      breakoutOccurred: true,
      priceReversedPct: 0.5,     // Price reversed 0.5%+ from breakout
      volumeOnReversal: 1.5,     // 1.5x volume on reversal
    },
  },
  {
    id: 'STRUCT_TREND_ACCEPTANCE',
    name: 'Trend Acceptance (Break + Hold)',
    category: 'STRUCTURE',
    description: 'Price broke level and is holding above/below. Market accepting new range.',
    defaultTimeframe: 'SWING',
    thresholds: {
      breakoutOccurred: true,
      holdingAboveBreak: true,
      minHoldBars: 2,            // Holding for 2+ periods
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// COMBINED LIBRARY
// ═══════════════════════════════════════════════════════════════

export const PATTERN_LIBRARY: PatternDefinition[] = [
  ...FLOW_PATTERNS,
  ...OI_PATTERNS,
  ...LIQUIDATION_PATTERNS,
  ...VOLUME_PATTERNS,
  ...STRUCTURE_PATTERNS,
];

// Category icons for UI
export const CATEGORY_CONFIG: Record<PatternCategory, { icon: string; color: string; label: string }> = {
  FLOW: { icon: '🔄', color: 'blue', label: 'Order Flow' },
  OI: { icon: '📈', color: 'purple', label: 'Open Interest' },
  LIQUIDATION: { icon: '💥', color: 'red', label: 'Liquidation' },
  VOLUME: { icon: '📊', color: 'green', label: 'Volume' },
  STRUCTURE: { icon: '🏗️', color: 'orange', label: 'Structure' },
};

// Get pattern by ID
export function getPatternDefinition(patternId: string): PatternDefinition | undefined {
  return PATTERN_LIBRARY.find(p => p.id === patternId);
}

// Get patterns by category
export function getPatternsByCategory(category: PatternCategory): PatternDefinition[] {
  return PATTERN_LIBRARY.filter(p => p.category === category);
}

console.log(`[S10.5] Pattern Library loaded: ${PATTERN_LIBRARY.length} patterns`);
