/**
 * SPX PHASE ENGINE — Types
 * 
 * BLOCK B5.4 — SPX-native Phase Classification
 * 
 * SPX phases are "slower" and more macro-oriented than BTC.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

// ═══════════════════════════════════════════════════════════════
// PHASE TYPES (SPX-native, NOT BTC copy)
// ═══════════════════════════════════════════════════════════════

export type SpxPhaseType =
  | 'BULL_EXPANSION'    // Above SMA200, SMA200 rising, momentum positive
  | 'BULL_COOLDOWN'     // Above SMA200, momentum flat/negative, vol rising
  | 'BEAR_DRAWDOWN'     // Below SMA200 OR deep drawdown, momentum negative
  | 'BEAR_RALLY'        // Below SMA200 but short momentum positive (bounce)
  | 'SIDEWAYS_RANGE';   // Around SMA200, low trend strength

// Flags (overlay on main phase, not separate phase)
export type SpxPhaseFlag = 
  | 'VOL_SHOCK'         // Crisis/expansion vol spikes (RV30 z-score > 2)
  | 'DEEP_DRAWDOWN'     // >15% from 52w high
  | 'TREND_BREAK';      // SMA200 slope reversal

export type SpxPhaseGrade = 'A' | 'B' | 'C' | 'D' | 'F';

// ═══════════════════════════════════════════════════════════════
// DAILY LABEL (single day classification)
// ═══════════════════════════════════════════════════════════════

export interface SpxDailyPhaseLabel {
  t: string;                  // YYYY-MM-DD
  ts: number;                 // timestamp ms
  phase: SpxPhaseType;
  flags: SpxPhaseFlag[];
  
  // Signals used for classification
  sma200: number;
  sma200Slope: number;        // 30-day slope
  priceVsSma200Pct: number;   // % distance from SMA200
  mom63d: number;             // 63-day momentum
  mom126d: number;            // 126-day momentum
  rv30ZScore: number;         // Rolling vol z-score
  drawdownFrom52wHigh: number; // % drawdown
}

// ═══════════════════════════════════════════════════════════════
// PHASE SEGMENT (continuous period of same phase)
// ═══════════════════════════════════════════════════════════════

export interface SpxPhaseSegment {
  phaseId: string;            // Unique ID like "BULL_EXPANSION_2024-01-15"
  phase: SpxPhaseType;
  startDate: string;          // YYYY-MM-DD
  endDate: string;            // YYYY-MM-DD
  startTs: number;
  endTs: number;
  duration: number;           // days
  
  // Performance metrics
  returnPct: number;
  maxDrawdownPct: number;
  realizedVol: number;
  
  // Flags that appeared during this segment
  flags: SpxPhaseFlag[];
  flagDays: number;           // Count of days with any flag
  
  // Match info (filled later by FocusPack)
  matchesCount?: number;
  bestMatchId?: string;
}

// ═══════════════════════════════════════════════════════════════
// PHASE STATS (aggregated per phase type)
// ═══════════════════════════════════════════════════════════════

export interface SpxPhaseStats {
  phase: SpxPhaseType;
  
  // Sample counts
  totalSegments: number;
  totalDays: number;
  avgDuration: number;
  
  // Performance
  avgReturn: number;
  medianReturn: number;
  hitRate: number;            // % of segments with positive return
  avgMaxDD: number;
  
  // Quality
  sharpe: number;
  sortino: number;
  
  // Grade (A-F based on overall performance)
  grade: SpxPhaseGrade;
}

// ═══════════════════════════════════════════════════════════════
// PHASE ENGINE OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface SpxPhaseEngineOutput {
  // Current state
  phaseIdAtNow: SpxPhaseSegment;
  currentFlags: SpxPhaseFlag[];
  
  // Historical segments (for chart shading)
  segments: SpxPhaseSegment[];
  
  // Stats per phase type
  statsByPhase: Record<SpxPhaseType, SpxPhaseStats>;
  
  // Overall quality
  overallGrade: SpxPhaseGrade;
  
  // Metadata
  totalDays: number;
  coverageYears: number;
  lastUpdated: string;
}

// ═══════════════════════════════════════════════════════════════
// CANDLE INPUT TYPE
// ═══════════════════════════════════════════════════════════════

export interface SpxCandle {
  t: string;    // YYYY-MM-DD
  ts: number;   // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
}
