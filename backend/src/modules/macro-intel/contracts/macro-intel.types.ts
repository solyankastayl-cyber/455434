/**
 * MACRO INTELLIGENCE TYPES
 * 
 * Market Regime Engine - Full Type Definitions
 * 
 * This is the source of truth for:
 * - Macro module
 * - Meta-Brain integration
 * - ML features
 * - UI components
 */

// ═══════════════════════════════════════════════════════════════
// TRENDS & DIRECTIONS
// ═══════════════════════════════════════════════════════════════

export type MacroTrend = 'UP' | 'DOWN' | 'FLAT';
export type TrendValue = -1 | 0 | 1; // DOWN = -1, FLAT = 0, UP = 1

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME ENUMERATION (8 PRIMARY STATES)
// ═══════════════════════════════════════════════════════════════

export enum MarketRegime {
  // BTC Dominance UP scenarios
  BTC_FLIGHT_TO_SAFETY = 'BTC_FLIGHT_TO_SAFETY',     // BTC.D ↑ + BTC ↑
  PANIC_SELL_OFF = 'PANIC_SELL_OFF',                 // BTC.D ↑ + BTC ↓
  BTC_LEADS_ALT_FOLLOW = 'BTC_LEADS_ALT_FOLLOW',     // BTC.D ↑ + ALT ↑
  BTC_MAX_PRESSURE = 'BTC_MAX_PRESSURE',             // BTC.D ↑ + ALT ↓
  
  // BTC Dominance DOWN scenarios
  ALT_ROTATION = 'ALT_ROTATION',                     // BTC.D ↓ + BTC ↑
  FULL_RISK_OFF = 'FULL_RISK_OFF',                   // BTC.D ↓ + BTC ↓
  ALT_SEASON = 'ALT_SEASON',                         // BTC.D ↓ + ALT ↑
  CAPITAL_EXIT = 'CAPITAL_EXIT',                     // BTC.D ↓ + ALT ↓
}

export type MarketRegimeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Regime to ID mapping
export const REGIME_ID_MAP: Record<MarketRegime, MarketRegimeId> = {
  [MarketRegime.BTC_FLIGHT_TO_SAFETY]: 0,
  [MarketRegime.PANIC_SELL_OFF]: 1,
  [MarketRegime.BTC_LEADS_ALT_FOLLOW]: 2,
  [MarketRegime.BTC_MAX_PRESSURE]: 3,
  [MarketRegime.ALT_ROTATION]: 4,
  [MarketRegime.FULL_RISK_OFF]: 5,
  [MarketRegime.ALT_SEASON]: 6,
  [MarketRegime.CAPITAL_EXIT]: 7,
};

// ═══════════════════════════════════════════════════════════════
// RISK LEVELS
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type RiskLevelId = 0 | 1 | 2 | 3;

export const RISK_LEVEL_MAP: Record<RiskLevel, RiskLevelId> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  EXTREME: 3,
};

// ═══════════════════════════════════════════════════════════════
// MARKET BIAS
// ═══════════════════════════════════════════════════════════════

export type MarketBias = 'BTC_ONLY' | 'ALTS' | 'DEFENSIVE' | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// STABLECOIN PRESSURE
// ═══════════════════════════════════════════════════════════════

export type StablecoinPressure = 'RISK_OFF' | 'RISK_ON' | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// MACRO FLAGS
// ═══════════════════════════════════════════════════════════════

export interface MacroFlags {
  MACRO_PANIC: boolean;
  RISK_OFF: boolean;
  ALT_SEASON: boolean;
  FLIGHT_TO_BTC: boolean;
  CAPITAL_EXIT: boolean;
  LIQUIDITY_FLIGHT: boolean;
  EXTREME_FEAR: boolean;
  EXTREME_GREED: boolean;
}

// ═══════════════════════════════════════════════════════════════
// TREND STATE
// ═══════════════════════════════════════════════════════════════

export interface MacroTrends {
  btcDominance: MacroTrend;
  stableDominance: MacroTrend;
  btcPrice: MacroTrend;
  altMarket: MacroTrend;
}

export interface MacroTrendValues {
  btcDominanceTrend: TrendValue;
  stableDominanceTrend: TrendValue;
  btcPriceTrend: TrendValue;
  altMarketTrend: TrendValue;
}

// ═══════════════════════════════════════════════════════════════
// RAW MARKET DATA
// ═══════════════════════════════════════════════════════════════

export interface MacroRawData {
  // Fear & Greed
  fearGreedIndex: number;       // 0-100
  fearGreedLabel: string;
  
  // Dominance
  btcDominance: number;         // %
  stableDominance: number;      // % (USDT + USDC)
  altDominance: number;         // % (100 - BTC - Stable)
  
  // 24h Changes
  btcDominanceChange24h: number;
  stableDominanceChange24h: number;
  
  // BTC Price
  btcPrice: number;
  btcPriceChange24h: number;    // %
  
  // Alt Market (proxy)
  altMarketChange24h: number;   // % derived from dominance shifts
  
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// REGIME STATE (COMPUTED)
// ═══════════════════════════════════════════════════════════════

export interface MacroRegimeState {
  regime: MarketRegime;
  regimeId: MarketRegimeId;
  regimeLabel: string;
  
  trends: MacroTrends;
  trendValues: MacroTrendValues;
  
  riskLevel: RiskLevel;
  riskLevelId: RiskLevelId;
  
  marketBias: MarketBias;
  stablecoinPressure: StablecoinPressure;
  
  confidenceMultiplier: number; // 0.0 - 1.0
  
  blocks: {
    strongActions: boolean;
    altExposure: boolean;
    btcExposure: boolean;
  };
  
  flags: MacroFlags;
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT (OUTPUT FOR META-BRAIN & ML)
// ═══════════════════════════════════════════════════════════════

export interface MacroContext {
  // Regime
  regimeId: MarketRegimeId;
  regimeLabel: string;
  regime: MarketRegime;
  
  // Raw values
  fearGreed: number;
  fearGreedNorm: number;        // 0-1
  btcDominance: number;
  stableDominance: number;
  
  // Trend values (for ML)
  btcDominanceTrend: TrendValue;
  stableDominanceTrend: TrendValue;
  btcPriceTrend: TrendValue;
  altMarketTrend: TrendValue;
  
  // Risk & Impact
  riskLevel: RiskLevel;
  riskLevelId: RiskLevelId;
  marketBias: MarketBias;
  
  // Flags
  flags: MacroFlags;
  
  // Impact on decisions
  confidenceMultiplier: number;
  blockStrongActions: boolean;
  
  // Timestamp
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// MACRO GRID CELL (FOR UI)
// ═══════════════════════════════════════════════════════════════

export interface MacroGridCell {
  regime: MarketRegime;
  regimeId: MarketRegimeId;
  title: string;
  description: string;
  interpretation: string;
  riskLevel: RiskLevel;
  marketBias: MarketBias;
  historicalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  labsSignals: {
    momentumBias: number;     // -1 to +1
    riskBias: number;         // 0 to 1
    liquidityBias: number;    // -1 to +1
  };
}

export type MacroGrid = MacroGridCell[];

// ═══════════════════════════════════════════════════════════════
// ML FEATURES
// ═══════════════════════════════════════════════════════════════

export interface MacroMlFeatures {
  macro_regime_id: MarketRegimeId;
  macro_risk_level: RiskLevelId;
  fear_greed_norm: number;
  btc_dom_trend: TrendValue;
  stable_dom_trend: TrendValue;
  alt_flow_proxy: number;       // 0-1
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface MacroIntelSnapshot {
  timestamp: number;
  
  // Raw data
  raw: MacroRawData;
  
  // Computed regime
  state: MacroRegimeState;
  
  // Context for downstream
  context: MacroContext;
  
  // ML features
  mlFeatures: MacroMlFeatures;
  
  // Data quality
  quality: {
    mode: 'LIVE' | 'CACHED' | 'DEGRADED' | 'NO_DATA';
    missing: string[];
    latencyMs?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME DEFINITIONS (LOCKED)
// ═══════════════════════════════════════════════════════════════

export interface RegimeDefinition {
  regime: MarketRegime;
  title: string;
  description: string;
  interpretation: string;
  condition: {
    btcDomTrend: MacroTrend;
    btcPriceTrend?: MacroTrend;
    altTrend?: MacroTrend;
  };
  riskLevel: RiskLevel;
  marketBias: MarketBias;
  confidenceMultiplier: number;
  blocks: {
    strongActions: boolean;
    altExposure: boolean;
    btcExposure: boolean;
  };
  labsSignals: {
    momentumBias: number;
    riskBias: number;
    liquidityBias: number;
  };
}

export const REGIME_DEFINITIONS: Record<MarketRegime, RegimeDefinition> = {
  [MarketRegime.BTC_FLIGHT_TO_SAFETY]: {
    regime: MarketRegime.BTC_FLIGHT_TO_SAFETY,
    title: 'BTC Flight to Safety',
    description: 'Capital is consolidating in Bitcoin',
    interpretation: 'BTC dominance and price rising together indicates capital concentrating in Bitcoin. Altcoins are under pressure. System reduces confidence on ALT signals.',
    condition: { btcDomTrend: 'UP', btcPriceTrend: 'UP' },
    riskLevel: 'MEDIUM',
    marketBias: 'BTC_ONLY',
    confidenceMultiplier: 0.85,
    blocks: { strongActions: false, altExposure: true, btcExposure: false },
    labsSignals: { momentumBias: 0.4, riskBias: 0.6, liquidityBias: 0.2 },
  },
  
  [MarketRegime.PANIC_SELL_OFF]: {
    regime: MarketRegime.PANIC_SELL_OFF,
    title: 'Market Panic',
    description: 'Risk-off environment — capital moves to safety',
    interpretation: 'BTC dominance rising while price falling indicates panic. Money exits to stablecoins. Buy actions are blocked. High risk environment.',
    condition: { btcDomTrend: 'UP', btcPriceTrend: 'DOWN' },
    riskLevel: 'EXTREME',
    marketBias: 'DEFENSIVE',
    confidenceMultiplier: 0.55,
    blocks: { strongActions: true, altExposure: true, btcExposure: true },
    labsSignals: { momentumBias: -0.7, riskBias: 0.95, liquidityBias: -0.8 },
  },
  
  [MarketRegime.BTC_LEADS_ALT_FOLLOW]: {
    regime: MarketRegime.BTC_LEADS_ALT_FOLLOW,
    title: 'BTC Leads, Alts Follow',
    description: 'Healthy bull market — BTC leads rotation',
    interpretation: 'BTC dominance rising with altcoin gains indicates healthy bull market. Bitcoin leads, alts follow with delay.',
    condition: { btcDomTrend: 'UP', altTrend: 'UP' },
    riskLevel: 'LOW',
    marketBias: 'BTC_ONLY',
    confidenceMultiplier: 0.95,
    blocks: { strongActions: false, altExposure: false, btcExposure: false },
    labsSignals: { momentumBias: 0.6, riskBias: 0.3, liquidityBias: 0.5 },
  },
  
  [MarketRegime.BTC_MAX_PRESSURE]: {
    regime: MarketRegime.BTC_MAX_PRESSURE,
    title: 'Maximum ALT Pressure',
    description: 'BTC dominance rising, altcoins bleeding',
    interpretation: 'Capital flows exclusively to BTC while alts decline. Maximum pressure on altcoin positions. ALT exposure blocked.',
    condition: { btcDomTrend: 'UP', altTrend: 'DOWN' },
    riskLevel: 'HIGH',
    marketBias: 'BTC_ONLY',
    confidenceMultiplier: 0.7,
    blocks: { strongActions: false, altExposure: true, btcExposure: false },
    labsSignals: { momentumBias: -0.3, riskBias: 0.75, liquidityBias: -0.4 },
  },
  
  [MarketRegime.ALT_ROTATION]: {
    regime: MarketRegime.ALT_ROTATION,
    title: 'Alt Rotation',
    description: 'Capital flows into altcoins',
    interpretation: 'BTC dominance falling while BTC price rises indicates capital rotating into altcoins. Potential early alt season. ALT signals get priority.',
    condition: { btcDomTrend: 'DOWN', btcPriceTrend: 'UP' },
    riskLevel: 'MEDIUM',
    marketBias: 'ALTS',
    confidenceMultiplier: 0.85,
    blocks: { strongActions: false, altExposure: false, btcExposure: false },
    labsSignals: { momentumBias: 0.7, riskBias: 0.4, liquidityBias: 0.6 },
  },
  
  [MarketRegime.FULL_RISK_OFF]: {
    regime: MarketRegime.FULL_RISK_OFF,
    title: 'Full Risk-Off',
    description: 'Market confidence declining across the board',
    interpretation: 'BTC dominance and price both falling indicates broad market weakness. Capital exits all crypto. AVOID is preferred action.',
    condition: { btcDomTrend: 'DOWN', btcPriceTrend: 'DOWN' },
    riskLevel: 'HIGH',
    marketBias: 'DEFENSIVE',
    confidenceMultiplier: 0.6,
    blocks: { strongActions: true, altExposure: true, btcExposure: true },
    labsSignals: { momentumBias: -0.6, riskBias: 0.85, liquidityBias: -0.7 },
  },
  
  [MarketRegime.ALT_SEASON]: {
    regime: MarketRegime.ALT_SEASON,
    title: 'Alt Season',
    description: 'Altcoins outperforming Bitcoin',
    interpretation: 'BTC dominance falling while alts rise indicates alt season. Maximum opportunity in altcoin markets. Risk is elevated but opportunity is high.',
    condition: { btcDomTrend: 'DOWN', altTrend: 'UP' },
    riskLevel: 'MEDIUM',
    marketBias: 'ALTS',
    confidenceMultiplier: 0.8,
    blocks: { strongActions: false, altExposure: false, btcExposure: false },
    labsSignals: { momentumBias: 0.8, riskBias: 0.5, liquidityBias: 0.7 },
  },
  
  [MarketRegime.CAPITAL_EXIT]: {
    regime: MarketRegime.CAPITAL_EXIT,
    title: 'Capital Exit',
    description: 'Broad market exodus',
    interpretation: 'BTC dominance and alts both declining indicates capital leaving crypto entirely. Maximum defensive posture required.',
    condition: { btcDomTrend: 'DOWN', altTrend: 'DOWN' },
    riskLevel: 'EXTREME',
    marketBias: 'DEFENSIVE',
    confidenceMultiplier: 0.5,
    blocks: { strongActions: true, altExposure: true, btcExposure: true },
    labsSignals: { momentumBias: -0.8, riskBias: 0.95, liquidityBias: -0.9 },
  },
};

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (LOCKED)
// ═══════════════════════════════════════════════════════════════

export const MACRO_INTEL_THRESHOLDS = {
  // Trend detection thresholds
  TREND_UP_THRESHOLD: 0.3,      // % change to count as UP
  TREND_DOWN_THRESHOLD: -0.3,   // % change to count as DOWN
  
  // Fear & Greed thresholds
  EXTREME_FEAR_THRESHOLD: 20,
  FEAR_THRESHOLD: 35,
  GREED_THRESHOLD: 65,
  EXTREME_GREED_THRESHOLD: 80,
  
  // Stablecoin pressure thresholds
  STABLE_RISK_OFF_THRESHOLD: 0.3,   // Stable.D change > +0.3% = RISK_OFF
  STABLE_RISK_ON_THRESHOLD: -0.3,   // Stable.D change < -0.3% = RISK_ON
  
  // Confidence bounds
  MIN_CONFIDENCE_MULTIPLIER: 0.4,
  MAX_CONFIDENCE_MULTIPLIER: 1.0,
} as const;

console.log('[MacroIntel] Types loaded');
