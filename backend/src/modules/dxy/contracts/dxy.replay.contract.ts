/**
 * DXY REPLAY CONTRACT — A2
 * 
 * Unified PathPoint and ReplayPack structure for DXY Replay Engine.
 * Compatible with BTC/SPX replay format.
 */

// ═══════════════════════════════════════════════════════════════
// PATH POINT — Единый стандарт точки траектории
// ═══════════════════════════════════════════════════════════════

export interface PathPoint {
  t: number;              // 0..(windowLen+focusLen-1)
  date?: string;          // ISO date (optional, nice for UI)
  price: number;          // mapped price in CURRENT window scale
  pctFromStart: number;   // (price / basePrice - 1), decimal
}

// ═══════════════════════════════════════════════════════════════
// REPLAY PACK — Полный объект replay для одного match
// ═══════════════════════════════════════════════════════════════

export interface DxyReplayPack {
  ok: boolean;
  asset: 'DXY';
  focus: string;          // "7d" | "14d" | "30d" | "90d" | "180d" | "365d"
  windowLen: number;
  focusLen: number;
  
  match: {
    rank: number;
    startDate: string;    // match window start (ISO YYYY-MM-DD)
    endDate: string;      // match window end (ISO YYYY-MM-DD)
    decade: string;       // "1970s", "1990s", etc.
    similarity: number;   // 0..1
  };
  
  // Raw normalized series (DECIMAL returns relative)
  windowNormalized: number[];     // len=windowLen, base=first of HIST window
  aftermathNormalized: number[];  // len=focusLen, base=last of HIST window
  
  // Final chart-ready points in CURRENT price space
  window: PathPoint[];            // len=windowLen
  continuation: PathPoint[];      // len=focusLen
  
  // Metadata
  currentWindowStart: string;
  currentWindowEnd: string;
  processingTimeMs?: number;
}

// ═══════════════════════════════════════════════════════════════
// MATCH INFO — For match selection
// ═══════════════════════════════════════════════════════════════

export interface MatchInfo {
  rank: number;
  startIndex: number;     // Index in candles array where HIST window starts
  similarity: number;     // 0..1
  date: string;           // End date of match window (for display)
  decade: string;
}

// ═══════════════════════════════════════════════════════════════
// FOCUS LENGTHS
// ═══════════════════════════════════════════════════════════════

export const FOCUS_TO_DAYS: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

export const DEFAULT_WINDOW_LEN = 120;
