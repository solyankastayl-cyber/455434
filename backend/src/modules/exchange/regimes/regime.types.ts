/**
 * S10.3 — Volume & OI Regime Types (LOCKED)
 * 
 * Regime = stable combination of Volume + OI + Price + Order Flow
 * 
 * NOT a signal, NOT a prediction
 * Just a description of HOW the market is living right now
 * 
 * DO NOT MODIFY once S10.3 is complete.
 */

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME ENUM (LOCKED)
// ═══════════════════════════════════════════════════════════════
export type MarketRegime =
  | 'ACCUMULATION'    // volume ↑, OI ↑, price flat → someone is building position
  | 'DISTRIBUTION'    // volume ↑, OI ↓, price flat → someone is exiting
  | 'LONG_SQUEEZE'    // OI ↓, price ↓, longs liquidated
  | 'SHORT_SQUEEZE'   // OI ↓, price ↑, shorts liquidated
  | 'EXPANSION'       // volume ↑, OI ↑, price trending → healthy trend
  | 'EXHAUSTION'      // volume ↓, OI flat/↓, trend weakening
  | 'NEUTRAL';        // no clear regime

// ═══════════════════════════════════════════════════════════════
// REGIME STATE
// ═══════════════════════════════════════════════════════════════
export interface MarketRegimeState {
  symbol: string;
  regime: MarketRegime;
  confidence: number;           // 0-1
  drivers: string[];            // human-readable reasons
  metrics: RegimeMetrics;       // raw data that led to decision
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// REGIME METRICS (inputs to detection)
// ═══════════════════════════════════════════════════════════════
export interface RegimeMetrics {
  volumeDelta: number;          // % change vs baseline
  oiDelta: number;              // % change in open interest
  priceDelta: number;           // % price change
  priceDirection: 'UP' | 'DOWN' | 'FLAT';
  orderFlowBias: 'BUY' | 'SELL' | 'NEUTRAL';
  absorptionActive: boolean;
  liquidationPressure: number;  // 0-100
}

// ═══════════════════════════════════════════════════════════════
// REGIME HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════
export interface RegimeHistoryEntry {
  regime: MarketRegime;
  confidence: number;
  duration: number;             // ms in this regime
  startedAt: Date;
  endedAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════
// REGIME THRESHOLDS (tunable)
// ═══════════════════════════════════════════════════════════════
export interface RegimeThresholds {
  volumeHighDelta: number;      // % to consider "high volume"
  volumeLowDelta: number;       // % to consider "low volume"
  oiSignificantDelta: number;   // % OI change threshold
  priceFlat: number;            // % range considered "flat"
  priceTrend: number;           // % to consider trending
  confidenceMin: number;        // min confidence to declare regime
}

export const DEFAULT_THRESHOLDS: RegimeThresholds = {
  volumeHighDelta: 20,          // >20% above baseline = high
  volumeLowDelta: -15,          // >15% below baseline = low
  oiSignificantDelta: 3,        // >3% OI change = significant
  priceFlat: 0.5,               // <0.5% = flat
  priceTrend: 2,                // >2% = trending
  confidenceMin: 0.4,           // 40% confidence minimum
};

// ═══════════════════════════════════════════════════════════════
// REGIME DIAGNOSTICS (for admin)
// ═══════════════════════════════════════════════════════════════
export interface RegimeDiagnostics {
  symbol: string;
  currentRegime: MarketRegimeState;
  rawInputs: {
    currentVolume: number;
    baselineVolume: number;
    currentOI: number;
    previousOI: number;
    currentPrice: number;
    previousPrice: number;
  };
  computedDeltas: {
    volumeDelta: number;
    oiDelta: number;
    priceDelta: number;
  };
  thresholds: RegimeThresholds;
  decision: {
    regime: MarketRegime;
    confidence: number;
    reasons: string[];
    alternativeRegimes: Array<{ regime: MarketRegime; confidence: number }>;
  };
  history: RegimeHistoryEntry[];
}
