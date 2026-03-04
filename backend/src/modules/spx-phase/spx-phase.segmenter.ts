/**
 * SPX PHASE ENGINE — Segmenter
 * 
 * BLOCK B5.4 — Convert daily labels into continuous phase segments
 * 
 * Groups consecutive days with same phase into segments with stats.
 */

import type { 
  SpxDailyPhaseLabel, 
  SpxPhaseSegment, 
  SpxPhaseFlag,
  SpxCandle
} from './spx-phase.types.js';

// ═══════════════════════════════════════════════════════════════
// SEGMENT PHASES
// ═══════════════════════════════════════════════════════════════

export function segmentPhases(
  labels: SpxDailyPhaseLabel[], 
  candles: SpxCandle[]
): SpxPhaseSegment[] {
  if (labels.length === 0) return [];

  // Create date->candle lookup
  const candleByDate = new Map<string, SpxCandle>();
  for (const c of candles) {
    candleByDate.set(c.t, c);
  }

  const segments: SpxPhaseSegment[] = [];
  let current: {
    phase: SpxDailyPhaseLabel['phase'];
    startDate: string;
    startTs: number;
    endDate: string;
    endTs: number;
    flags: Set<SpxPhaseFlag>;
    flagDays: number;
    labels: SpxDailyPhaseLabel[];
  } | null = null;

  for (const label of labels) {
    if (!current) {
      // Start first segment
      current = {
        phase: label.phase,
        startDate: label.t,
        startTs: label.ts,
        endDate: label.t,
        endTs: label.ts,
        flags: new Set(label.flags),
        flagDays: label.flags.length > 0 ? 1 : 0,
        labels: [label],
      };
      continue;
    }

    if (label.phase === current.phase) {
      // Continue current segment
      current.endDate = label.t;
      current.endTs = label.ts;
      current.labels.push(label);
      for (const f of label.flags) current.flags.add(f);
      if (label.flags.length > 0) current.flagDays++;
    } else {
      // Close current segment and start new one
      const segment = buildSegment(current, candleByDate);
      segments.push(segment);

      current = {
        phase: label.phase,
        startDate: label.t,
        startTs: label.ts,
        endDate: label.t,
        endTs: label.ts,
        flags: new Set(label.flags),
        flagDays: label.flags.length > 0 ? 1 : 0,
        labels: [label],
      };
    }
  }

  // Close last segment
  if (current) {
    const segment = buildSegment(current, candleByDate);
    segments.push(segment);
  }

  return segments;
}

// ═══════════════════════════════════════════════════════════════
// BUILD SEGMENT WITH METRICS
// ═══════════════════════════════════════════════════════════════

function buildSegment(
  raw: {
    phase: SpxDailyPhaseLabel['phase'];
    startDate: string;
    startTs: number;
    endDate: string;
    endTs: number;
    flags: Set<SpxPhaseFlag>;
    flagDays: number;
    labels: SpxDailyPhaseLabel[];
  },
  candleByDate: Map<string, SpxCandle>
): SpxPhaseSegment {
  const duration = raw.labels.length;
  
  // Get candles for this period
  const periodCandles: SpxCandle[] = [];
  for (const label of raw.labels) {
    const candle = candleByDate.get(label.t);
    if (candle) periodCandles.push(candle);
  }

  // Calculate return
  let returnPct = 0;
  if (periodCandles.length >= 2) {
    const startClose = periodCandles[0].c;
    const endClose = periodCandles[periodCandles.length - 1].c;
    returnPct = startClose > 0 ? ((endClose - startClose) / startClose) * 100 : 0;
  }

  // Calculate max drawdown
  let maxDrawdownPct = 0;
  if (periodCandles.length >= 2) {
    let peak = periodCandles[0].c;
    for (const c of periodCandles) {
      if (c.c > peak) peak = c.c;
      const dd = peak > 0 ? ((c.c - peak) / peak) * 100 : 0;
      if (dd < maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  // Calculate realized volatility
  let realizedVol = 0;
  if (periodCandles.length >= 5) {
    const returns: number[] = [];
    for (let i = 1; i < periodCandles.length; i++) {
      const prev = periodCandles[i - 1].c;
      if (prev > 0) {
        returns.push((periodCandles[i].c - prev) / prev);
      }
    }
    if (returns.length > 1) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      realizedVol = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized %
    }
  }

  const phaseId = `${raw.phase}_${raw.startDate}`;

  return {
    phaseId,
    phase: raw.phase,
    startDate: raw.startDate,
    endDate: raw.endDate,
    startTs: raw.startTs,
    endTs: raw.endTs,
    duration,
    returnPct: Math.round(returnPct * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    realizedVol: Math.round(realizedVol * 100) / 100,
    flags: Array.from(raw.flags),
    flagDays: raw.flagDays,
  };
}

export default segmentPhases;
