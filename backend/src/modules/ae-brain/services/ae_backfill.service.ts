/**
 * C6 — Historical Backfill Service
 * 
 * Builds historical AE state vectors for novelty detection.
 * Uses LOCF (Last Observation Carried Forward) for macro series.
 */

import type { AeStateVector } from '../contracts/ae_state.contract.js';
import { GUARD_LEVEL_MAP } from '../contracts/ae_state.contract.js';
import { clamp, safeNumber } from '../utils/ae_math.js';
import { AeStateVectorModel } from '../storage/ae_state_vector.model.js';

// Import macro services for historical data
import { getMacroSeriesPoints } from '../../dxy-macro-core/ingest/macro.ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Crisis Guard thresholds (B6)
const BLOCK_CREDIT_THRESHOLD = 0.50;
const BLOCK_VIX_THRESHOLD = 32;
const CRISIS_CREDIT_THRESHOLD = 0.25;
const CRISIS_VIX_THRESHOLD = 18;
const WARN_CREDIT_THRESHOLD = 0.30;
const WARN_MACRO_SCORE_THRESHOLD = 0.15;

// Macro series for historical state
const HISTORICAL_SERIES = {
  fed: 'FEDFUNDS',
  vix: 'VIXCLS',
  baa: 'BAA10Y',
  cpi: 'CPIAUCSL',
  unrate: 'UNRATE',
  m2: 'M2SL',
  t10y2y: 'T10Y2Y',
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface BackfillResult {
  ok: boolean;
  totalDates: number;
  inserted: number;
  skipped: number;
  errors: number;
  range: { from: string; to: string };
  duration: number;
  errorDates?: string[];
}

interface HistoricalPoint {
  date: string;
  value: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build date range
// ═══════════════════════════════════════════════════════════════

function buildDateRange(from: string, to: string, stepDays: number): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  const end = new Date(to);
  
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + stepDays);
  }
  
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get value at date (LOCF)
// ═══════════════════════════════════════════════════════════════

function getValueAtDate(points: HistoricalPoint[], targetDate: string, fallback: number): number {
  if (points.length === 0) return fallback;
  
  // LOCF: find last value <= targetDate
  let result = fallback;
  for (const p of points) {
    if (p.date <= targetDate) {
      result = p.value;
    } else {
      break;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Check for NaN
// ═══════════════════════════════════════════════════════════════

function containsNaN(v: AeStateVector['vector']): boolean {
  return Object.values(v).some(x =>
    typeof x === 'number' && (isNaN(x) || !isFinite(x))
  );
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Classify guard level
// ═══════════════════════════════════════════════════════════════

function classifyGuardLevel(
  creditComposite: number,
  vix: number,
  macroScoreSigned: number
): number {
  // BLOCK
  if (creditComposite > BLOCK_CREDIT_THRESHOLD && vix > BLOCK_VIX_THRESHOLD) {
    return GUARD_LEVEL_MAP['BLOCK'];
  }
  // CRISIS
  if (creditComposite > CRISIS_CREDIT_THRESHOLD && vix > CRISIS_VIX_THRESHOLD) {
    return GUARD_LEVEL_MAP['CRISIS'];
  }
  // WARN
  if (creditComposite > WARN_CREDIT_THRESHOLD && macroScoreSigned > WARN_MACRO_SCORE_THRESHOLD) {
    return GUARD_LEVEL_MAP['WARN'];
  }
  // NONE
  return GUARD_LEVEL_MAP['NONE'];
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute historical macro score (simplified)
// ═══════════════════════════════════════════════════════════════

function computeHistoricalMacroScore(
  fed: number,
  vix: number,
  baa: number,
  cpi: number,
  unrate: number,
  m2yoy: number,
  t10y2y: number
): { macroSigned: number; confidence: number } {
  // Simplified macro score based on key indicators
  // Fed: higher = tighter = positive pressure
  // VIX: higher = stress = positive pressure (risk-off)
  // BAA spread: higher = credit stress = positive pressure
  // CPI yoy: higher = inflation = positive pressure
  // UNRATE: higher = weak labor = negative pressure (easing signal)
  // M2 yoy: higher = liquidity = negative pressure
  // T10Y2Y: negative = inverted curve = positive pressure
  
  let score = 0;
  let weight = 0;
  
  // Fed funds rate (normalized: 0% = neutral, 5% = tight)
  const fedNorm = (fed - 2.5) / 5;  // -0.5 to 0.5
  score += fedNorm * 0.25;
  weight += 0.25;
  
  // VIX (normalized: 15 = neutral, 35+ = panic)
  const vixNorm = (vix - 20) / 30;  // typically -0.3 to 0.5+
  score += clamp(vixNorm, -0.5, 1) * 0.15;
  weight += 0.15;
  
  // BAA spread (normalized: 2% = neutral, 5%+ = stress)
  const baaNorm = (baa - 2.5) / 4;
  score += clamp(baaNorm, -0.5, 1) * 0.15;
  weight += 0.15;
  
  // CPI (normalized: 2% = target, 5%+ = high)
  const cpiNorm = (cpi - 2) / 4;
  score += clamp(cpiNorm, -0.5, 1) * 0.15;
  weight += 0.15;
  
  // UNRATE (inverted: lower = strong, higher = weak → easing signal)
  const unrateNorm = (unrate - 5) / 5;  // 0% → -1, 10% → +1
  score -= unrateNorm * 0.15;  // Higher unrate = more dovish
  weight += 0.15;
  
  // M2 YoY (inverted: higher growth = more liquidity = negative)
  const m2Norm = (m2yoy - 5) / 15;  // 5% target, 20%+ extreme
  score -= clamp(m2Norm, -0.5, 1) * 0.10;
  weight += 0.10;
  
  // T10Y2Y (negative = inverted = recession signal = hawkish consequence)
  const curveNorm = -t10y2y / 2;  // Inverted by 2% = +1
  score += clamp(curveNorm, -0.5, 1) * 0.05;
  weight += 0.05;
  
  const macroSigned = weight > 0 ? clamp(score / weight, -1, 1) : 0;
  
  // Confidence based on VIX (low VIX = higher confidence)
  const confidence = vix < 20 ? 0.7 : vix < 30 ? 0.5 : 0.3;
  
  return { macroSigned, confidence };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute credit composite (simplified)
// ═══════════════════════════════════════════════════════════════

function computeCreditComposite(baa: number, vix: number): number {
  // Simplified credit composite based on BAA spread and VIX
  // BAA: 2% neutral, 6%+ = crisis
  // VIX: 15 neutral, 40+ = crisis
  
  const baaNorm = clamp((baa - 2) / 4, 0, 1);  // 0 at 2%, 1 at 6%
  const vixNorm = clamp((vix - 15) / 35, 0, 1);  // 0 at 15, 1 at 50
  
  return baaNorm * 0.5 + vixNorm * 0.5;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Build historical state for date
// ═══════════════════════════════════════════════════════════════

async function buildHistoricalState(
  asOf: string,
  seriesData: Map<string, HistoricalPoint[]>
): Promise<AeStateVector | null> {
  // Get values at date
  const fed = getValueAtDate(seriesData.get(HISTORICAL_SERIES.fed) || [], asOf, 2.0);
  const vix = getValueAtDate(seriesData.get(HISTORICAL_SERIES.vix) || [], asOf, 20);
  const baa = getValueAtDate(seriesData.get(HISTORICAL_SERIES.baa) || [], asOf, 2.5);
  const cpi = getValueAtDate(seriesData.get(HISTORICAL_SERIES.cpi) || [], asOf, 2.0);
  const unrate = getValueAtDate(seriesData.get(HISTORICAL_SERIES.unrate) || [], asOf, 5.0);
  const m2 = getValueAtDate(seriesData.get(HISTORICAL_SERIES.m2) || [], asOf, 5.0);
  const t10y2y = getValueAtDate(seriesData.get(HISTORICAL_SERIES.t10y2y) || [], asOf, 0.5);
  
  // Compute macro score
  const { macroSigned, confidence } = computeHistoricalMacroScore(
    fed, vix, baa, cpi, unrate, m2, t10y2y
  );
  
  // Compute credit composite
  const creditComposite = computeCreditComposite(baa, vix);
  
  // Compute guard level
  const guardLevel = classifyGuardLevel(creditComposite, vix, macroSigned);
  
  // DXY signal approximation (simplified: inverse of macro for risk-on/off)
  // When macro is positive (tightening), USD tends to strengthen
  const dxySignalSigned = clamp(macroSigned * 0.7, -1, 1);
  const dxyConfidence = confidence;
  
  // Regime bias (based on macro direction)
  const regimeBias90d = macroSigned * 0.5;
  
  const vector = {
    macroSigned: Math.round(macroSigned * 1000) / 1000,
    macroConfidence: confidence,
    guardLevel,
    dxySignalSigned: Math.round(dxySignalSigned * 1000) / 1000,
    dxyConfidence,
    regimeBias90d: Math.round(regimeBias90d * 1000) / 1000,
  };
  
  // Check for NaN
  if (containsNaN(vector)) {
    return null;
  }
  
  return {
    asOf,
    vector,
    health: { ok: true, missing: [] },
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Backfill
// ═══════════════════════════════════════════════════════════════

export async function runAeBackfill(
  from: string,
  to: string,
  stepDays: number = 7
): Promise<BackfillResult> {
  const startTime = Date.now();
  console.log(`[AE Backfill] Starting: ${from} → ${to}, step=${stepDays}d`);
  
  // Build date range
  const dates = buildDateRange(from, to, stepDays);
  console.log(`[AE Backfill] Total dates: ${dates.length}`);
  
  // Load all historical series data once
  console.log('[AE Backfill] Loading historical macro series...');
  const seriesData = new Map<string, HistoricalPoint[]>();
  
  for (const [key, seriesId] of Object.entries(HISTORICAL_SERIES)) {
    try {
      const points = await getMacroSeriesPoints(seriesId);
      seriesData.set(seriesId, points.map(p => ({ date: p.date, value: p.value })));
      console.log(`[AE Backfill]   ${seriesId}: ${points.length} points`);
    } catch (e) {
      console.warn(`[AE Backfill]   ${seriesId}: failed - ${(e as Error).message}`);
      seriesData.set(seriesId, []);
    }
  }
  
  // Process each date
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const errorDates: string[] = [];
  
  for (let i = 0; i < dates.length; i++) {
    const asOf = dates[i];
    
    // Progress log every 100 dates
    if (i % 100 === 0) {
      console.log(`[AE Backfill] Progress: ${i}/${dates.length} (${inserted} inserted, ${skipped} skipped)`);
    }
    
    try {
      // Check if already exists
      const exists = await AeStateVectorModel.findOne({ asOf });
      if (exists) {
        skipped++;
        continue;
      }
      
      // Build historical state
      const state = await buildHistoricalState(asOf, seriesData);
      
      if (!state) {
        errors++;
        errorDates.push(asOf);
        continue;
      }
      
      // Save to database
      await AeStateVectorModel.create({
        asOf: state.asOf,
        vector: state.vector,
        health: state.health,
      });
      
      inserted++;
      
    } catch (e) {
      errors++;
      errorDates.push(asOf);
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`[AE Backfill] Complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors in ${duration}ms`);
  
  return {
    ok: errors === 0 || errors < dates.length * 0.05,  // Allow <5% errors
    totalDates: dates.length,
    inserted,
    skipped,
    errors,
    range: { from, to },
    duration,
    errorDates: errorDates.length > 0 ? errorDates.slice(0, 10) : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get backfill stats
// ═══════════════════════════════════════════════════════════════

export async function getBackfillStats(): Promise<{
  total: number;
  range: { from: string; to: string } | null;
  distribution: {
    macroSigned: { min: number; max: number; avg: number };
    guardLevel: { none: number; warn: number; crisis: number; block: number };
  } | null;
}> {
  const total = await AeStateVectorModel.countDocuments();
  
  if (total === 0) {
    return { total: 0, range: null, distribution: null };
  }
  
  const oldest = await AeStateVectorModel.findOne().sort({ asOf: 1 }).lean();
  const newest = await AeStateVectorModel.findOne().sort({ asOf: -1 }).lean();
  
  // Get distribution stats
  const all = await AeStateVectorModel.find({}, { vector: 1 }).lean();
  
  const macroValues = all.map(d => d.vector.macroSigned);
  const guardLevels = all.map(d => d.vector.guardLevel);
  
  const macroMin = Math.min(...macroValues);
  const macroMax = Math.max(...macroValues);
  const macroAvg = macroValues.reduce((a, b) => a + b, 0) / macroValues.length;
  
  const guardCounts = {
    none: guardLevels.filter(g => g === 0).length,
    warn: guardLevels.filter(g => g > 0 && g < 0.5).length,
    crisis: guardLevels.filter(g => g >= 0.5 && g < 0.9).length,
    block: guardLevels.filter(g => g >= 0.9).length,
  };
  
  return {
    total,
    range: oldest && newest ? { from: oldest.asOf, to: newest.asOf } : null,
    distribution: {
      macroSigned: {
        min: Math.round(macroMin * 1000) / 1000,
        max: Math.round(macroMax * 1000) / 1000,
        avg: Math.round(macroAvg * 1000) / 1000,
      },
      guardLevel: guardCounts,
    },
  };
}
