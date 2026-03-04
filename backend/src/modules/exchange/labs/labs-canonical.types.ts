/**
 * EXCHANGE LABS v3 — CANONICAL TYPES
 * 
 * ЕДИНЫЙ КОНТРАКТ ДЛЯ ВСЕХ LABS
 * 
 * Каждый Lab:
 * - автономный аналитический инструмент
 * - не принимает решений (NO BUY/SELL)
 * - не знает про FOMO AI
 * - возвращает единый формат LabResult
 * 
 * Потребители:
 * - Exchange → Research (читает state + explain)
 * - Intelligence → Meta-Brain (может понижать confidence)
 * - FOMO AI (использует explain как WHY/WHY NOT)
 */

// ═══════════════════════════════════════════════════════════════
// ЕДИНЫЙ КОНТРАКТ LABS (ОБЯЗАТЕЛЬНО ДЛЯ ВСЕХ)
// ═══════════════════════════════════════════════════════════════

export interface LabResult<TState extends string, TSignals extends object> {
  lab: LabName;
  state: TState;
  confidence: number;  // 0.0 – 1.0
  signals: TSignals;
  risks: string[];
  explain: {
    summary: string;
    details: string[];
  };
  meta: {
    symbol: string;
    timeframe: string;
    dataCompleteness: number; // 0.0 – 1.0
    lastUpdate: string;  // ISO
  };
}

// ═══════════════════════════════════════════════════════════════
// LAB NAMES (18 LABS)
// ═══════════════════════════════════════════════════════════════

export type LabName =
  // Group A: Market Structure
  | 'regime'
  | 'volatility'
  | 'liquidity'
  | 'marketStress'
  // Group B: Flow & Participation
  | 'volume'
  | 'flow'
  | 'momentum'
  | 'participation'
  // Group C: Smart Money & Risk
  | 'whale'
  | 'accumulation'
  | 'manipulation'
  | 'liquidation'
  // Group D: Price Behavior
  | 'corridor'
  | 'supportResistance'
  | 'priceAcceptance'
  // Group E: Meta / Quality
  | 'dataQuality'
  | 'signalConflict'
  | 'stability';

export const LAB_GROUPS = {
  A: ['regime', 'volatility', 'liquidity', 'marketStress'],
  B: ['volume', 'flow', 'momentum', 'participation'],
  C: ['whale', 'accumulation', 'manipulation', 'liquidation'],
  D: ['corridor', 'supportResistance', 'priceAcceptance'],
  E: ['dataQuality', 'signalConflict', 'stability'],
} as const;

export const LAB_GROUP_NAMES = {
  A: 'Market Structure',
  B: 'Flow & Participation',
  C: 'Smart Money & Risk',
  D: 'Price Behavior',
  E: 'Meta / Quality',
} as const;

// ═══════════════════════════════════════════════════════════════
// GROUP A: MARKET STRUCTURE
// ═══════════════════════════════════════════════════════════════

// Lab 1: Regime Lab
export type RegimeState = 
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGE'
  | 'TRANSITION'
  | 'CHAOTIC';

export interface RegimeSignals {
  trendStrength: number;
  rangeWidth: number;
  transitionProbability: number;
  dominantDirection: 'up' | 'down' | 'neutral';
}

export type RegimeLabResult = LabResult<RegimeState, RegimeSignals>;

// Lab 2: Volatility Lab
export type VolatilityState =
  | 'LOW_VOL'
  | 'NORMAL_VOL'
  | 'HIGH_VOL'
  | 'EXPANSION'
  | 'COMPRESSION';

export interface VolatilitySignals {
  currentVol: number;
  historicalVol: number;
  volRatio: number;
  atr: number;
  bollingerWidth: number;
}

export type VolatilityLabResult = LabResult<VolatilityState, VolatilitySignals>;

// Lab 3: Liquidity Lab
export type LiquidityState =
  | 'DEEP_LIQUIDITY'
  | 'NORMAL_LIQUIDITY'
  | 'THIN_LIQUIDITY'
  | 'LIQUIDITY_GAPS';

export interface LiquiditySignals {
  bidDepth: number;
  askDepth: number;
  spread: number;
  depthRatio: number;
  gapZones: Array<{ price: number; size: number }>;
}

export type LiquidityLabResult = LabResult<LiquidityState, LiquiditySignals>;

// Lab 4: Market Stress Lab
export type MarketStressState =
  | 'STABLE'
  | 'STRESSED'
  | 'PANIC'
  | 'FORCED_LIQUIDATIONS';

export interface MarketStressSignals {
  stressIndex: number;
  fundingRate: number;
  openInterestChange: number;
  liquidationVolume: number;
}

export type MarketStressLabResult = LabResult<MarketStressState, MarketStressSignals>;

// ═══════════════════════════════════════════════════════════════
// GROUP B: FLOW & PARTICIPATION
// ═══════════════════════════════════════════════════════════════

// Lab 5: Volume Lab (ЭТАЛОН)
export type VolumeState =
  | 'STRONG_CONFIRMATION'
  | 'WEAK_CONFIRMATION'
  | 'NO_CONFIRMATION'
  | 'DISTRIBUTION_RISK'
  | 'ANOMALY';

export interface VolumeSignals {
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  relativeVolume: number;
  buySellImbalance: number;
  anomalies: string[];
}

export type VolumeLabResult = LabResult<VolumeState, VolumeSignals>;

// Lab 6: Flow Lab
export type FlowState =
  | 'BUY_DOMINANT'
  | 'SELL_DOMINANT'
  | 'BALANCED'
  | 'CHAOTIC';

export interface FlowSignals {
  netFlow: number;
  buyVolume: number;
  sellVolume: number;
  flowMomentum: number;
}

export type FlowLabResult = LabResult<FlowState, FlowSignals>;

// Lab 7: Momentum Lab
export type MomentumState =
  | 'ACCELERATING'
  | 'DECELERATING'
  | 'STALLED'
  | 'REVERSAL_RISK';

export interface MomentumSignals {
  rsi: number;
  macdHistogram: number;
  rateOfChange: number;
  momentumDivergence: boolean;
}

export type MomentumLabResult = LabResult<MomentumState, MomentumSignals>;

// Lab 8: Participation Lab
export type ParticipationState =
  | 'BROAD_PARTICIPATION'
  | 'NARROW_PARTICIPATION'
  | 'FAKE_ACTIVITY'
  | 'DRY_MARKET';

export interface ParticipationSignals {
  uniqueTraders: number;
  tradeCount: number;
  avgTradeSize: number;
  retailVsInstitutional: number;
}

export type ParticipationLabResult = LabResult<ParticipationState, ParticipationSignals>;

// ═══════════════════════════════════════════════════════════════
// GROUP C: SMART MONEY & RISK
// ═══════════════════════════════════════════════════════════════

// Lab 9: Whale Lab (ЭТАЛОН)
export type WhaleState =
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'ACTIVE_MANIPULATION'
  | 'PASSIVE_PRESENCE'
  | 'NO_WHALES';

export interface WhaleSignals {
  largeTradeFlow: number;
  orderbookPressure: number;
  liquidationZones: Array<{ price: number; size: number }>;
  whaleActivity: 'high' | 'medium' | 'low';
}

export type WhaleLabResult = LabResult<WhaleState, WhaleSignals>;

// Lab 10: Accumulation/Distribution Lab
export type AccumulationState =
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'NEUTRAL'
  | 'UNCLEAR';

export interface AccumulationSignals {
  adLine: number;
  obvTrend: number;
  mfiValue: number;
  divergence: 'bullish' | 'bearish' | 'none';
}

export type AccumulationLabResult = LabResult<AccumulationState, AccumulationSignals>;

// Lab 11: Manipulation Risk Lab
export type ManipulationState =
  | 'CLEAN'
  | 'STOP_HUNT_RISK'
  | 'FAKE_BREAKOUT'
  | 'SPOOFING_RISK';

export interface ManipulationSignals {
  spoofingScore: number;
  fakeBreakoutRisk: number;
  stopClusterProximity: number;
  unusualActivity: boolean;
}

export type ManipulationLabResult = LabResult<ManipulationState, ManipulationSignals>;

// Lab 12: Liquidation Pressure Lab
export type LiquidationState =
  | 'LONGS_AT_RISK'
  | 'SHORTS_AT_RISK'
  | 'BALANCED'
  | 'CASCADE_RISK';

export interface LiquidationSignals {
  longLiquidationZone: number;
  shortLiquidationZone: number;
  openInterestLongs: number;
  openInterestShorts: number;
  cascadeProbability: number;
}

export type LiquidationLabResult = LabResult<LiquidationState, LiquidationSignals>;

// ═══════════════════════════════════════════════════════════════
// GROUP D: PRICE BEHAVIOR
// ═══════════════════════════════════════════════════════════════

// Lab 13: Range/Corridor Lab
export type CorridorState =
  | 'INSIDE_RANGE'
  | 'RANGE_BREAK_ATTEMPT'
  | 'FALSE_BREAK'
  | 'RANGE_EXPANSION';

export interface CorridorSignals {
  rangeHigh: number;
  rangeLow: number;
  currentPosition: number;  // 0-1 within range
  breakAttempts: number;
  avgTimeInRange: number;
}

export type CorridorLabResult = LabResult<CorridorState, CorridorSignals>;

// Lab 14: Support/Resistance Lab
export type SupportResistanceState =
  | 'STRONG_SUPPORT'
  | 'WEAK_SUPPORT'
  | 'STRONG_RESISTANCE'
  | 'LEVEL_BREAK';

export interface SupportResistanceSignals {
  nearestSupport: number;
  nearestResistance: number;
  supportStrength: number;
  resistanceStrength: number;
  touchCount: number;
}

export type SupportResistanceLabResult = LabResult<SupportResistanceState, SupportResistanceSignals>;

// Lab 15: Price Acceptance Lab
export type PriceAcceptanceState =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'UNSTABLE'
  | 'MIGRATING';

export interface PriceAcceptanceSignals {
  timeAtLevel: number;
  volumeProfile: number;
  rejectionCount: number;
  valueAreaHigh: number;
  valueAreaLow: number;
}

export type PriceAcceptanceLabResult = LabResult<PriceAcceptanceState, PriceAcceptanceSignals>;

// ═══════════════════════════════════════════════════════════════
// GROUP E: META / QUALITY
// ═══════════════════════════════════════════════════════════════

// Lab 16: Data Quality Lab
export type DataQualityState =
  | 'CLEAN'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'UNTRUSTED';

export interface DataQualitySignals {
  dataLatency: number;
  missingFields: string[];
  sourceReliability: number;
  lastValidData: string;
}

export type DataQualityLabResult = LabResult<DataQualityState, DataQualitySignals>;

// Lab 17: Signal Conflict Lab
export type SignalConflictState =
  | 'ALIGNED'
  | 'PARTIAL_CONFLICT'
  | 'STRONG_CONFLICT';

export interface SignalConflictSignals {
  conflictingLabs: string[];
  alignedLabs: string[];
  conflictScore: number;
  dominantSignal: string;
}

export type SignalConflictLabResult = LabResult<SignalConflictState, SignalConflictSignals>;

// Lab 18: Stability Lab
export type StabilityState =
  | 'STABLE'
  | 'FRAGILE'
  | 'UNSTABLE'
  | 'BREAK_RISK';

export interface StabilitySignals {
  stabilityScore: number;
  volatilityTrend: 'increasing' | 'decreasing' | 'stable';
  structuralIntegrity: number;
  breakRiskLevel: number;
}

export type StabilityLabResult = LabResult<StabilityState, StabilitySignals>;

// ═══════════════════════════════════════════════════════════════
// AGGREGATED TYPES
// ═══════════════════════════════════════════════════════════════

export type AnyLabResult = 
  | RegimeLabResult
  | VolatilityLabResult
  | LiquidityLabResult
  | MarketStressLabResult
  | VolumeLabResult
  | FlowLabResult
  | MomentumLabResult
  | ParticipationLabResult
  | WhaleLabResult
  | AccumulationLabResult
  | ManipulationLabResult
  | LiquidationLabResult
  | CorridorLabResult
  | SupportResistanceLabResult
  | PriceAcceptanceLabResult
  | DataQualityLabResult
  | SignalConflictLabResult
  | StabilityLabResult;

// For Research layer aggregation
export interface LabsSnapshot {
  symbol: string;
  timestamp: string;
  labs: Record<LabName, AnyLabResult>;
}

// For Meta-Brain consumption
export interface LabsSummary {
  symbol: string;
  timestamp: string;
  overallHealth: 'healthy' | 'warning' | 'critical';
  activeRisks: string[];
  conflictingSignals: string[];
  dominantState: string;
}

console.log('[LABS.V3] Canonical types loaded - 18 Labs defined');
