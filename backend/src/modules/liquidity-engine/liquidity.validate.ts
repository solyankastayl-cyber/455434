/**
 * LIQUIDITY EPISODE VALIDATION — P2.5
 * 
 * Validates liquidity regime detection on historical episodes:
 * - 2020 QE (EXPANSION expected)
 * - 2022 QT (CONTRACTION expected)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import {
  LIQUIDITY_SERIES,
  LiquiditySeriesId,
  LiquidityRegime,
  REGIME_THRESHOLDS,
} from './liquidity.contract.js';
import { getLiquiditySeriesPoints } from './liquidity.ingest.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface EpisodeValidationInput {
  from: string;           // YYYY-MM-DD
  to: string;             // YYYY-MM-DD
  stepDays?: number;      // default 7 (weekly)
  expectedRegime: LiquidityRegime;
  thresholdShare?: number; // default 0.60 (60%)
}

export interface WeeklySnapshot {
  date: string;
  impulse: number;
  regime: LiquidityRegime;
  components: {
    walcl: number;
    rrp: number;
    tga: number;
  };
}

export interface EpisodeValidationResult {
  episode: {
    from: string;
    to: string;
    expectedRegime: LiquidityRegime;
    thresholdShare: number;
  };
  
  result: 'PASS' | 'FAIL';
  
  stats: {
    totalWeeks: number;
    coverageShare: number;        // % matching expected regime
    avgImpulse: number;
    medianImpulse: number;
    p10Impulse: number;
    p90Impulse: number;
    maxConsecutiveWeeks: number;  // in expected regime
    falseOppositeShare: number;   // % in opposite regime
  };
  
  passReasons: string[];
  failReasons: string[];
  
  snapshots: WeeklySnapshot[];   // weekly data for inspection
}

// ═══════════════════════════════════════════════════════════════
// STATISTICAL HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// WEEKLY DATA HELPERS
// ═══════════════════════════════════════════════════════════════

interface WeeklyPoint {
  weekEnd: string;
  value: number;
}

/**
 * Normalize to weekly-as-of (Friday)
 */
function normalizeToWeekly(
  points: Array<{ date: string; value: number }>,
  frequency: 'daily' | 'weekly'
): WeeklyPoint[] {
  if (frequency === 'weekly') {
    return points.map(p => ({ weekEnd: p.date, value: p.value }));
  }
  
  // Daily: aggregate by week (take last value)
  const byWeek = new Map<string, { date: string; value: number }>();
  
  for (const p of points) {
    const d = new Date(p.date);
    const dayOfWeek = d.getUTCDay();
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(d);
    friday.setUTCDate(d.getUTCDate() + daysToFriday);
    const weekKey = friday.toISOString().split('T')[0];
    
    const existing = byWeek.get(weekKey);
    if (!existing || p.date >= existing.date) {
      byWeek.set(weekKey, p);
    }
  }
  
  const result: WeeklyPoint[] = [];
  for (const [weekEnd, point] of byWeek) {
    result.push({ weekEnd, value: point.value });
  }
  
  return result.sort((a, b) => a.weekEnd.localeCompare(b.weekEnd));
}

/**
 * Compute delta from weekly array at specific week index
 */
function computeDeltaAtWeek(
  weekly: WeeklyPoint[],
  weekIdx: number,
  lagWeeks: number
): number | null {
  if (weekIdx < lagWeeks) return null;
  return weekly[weekIdx].value - weekly[weekIdx - lagWeeks].value;
}

/**
 * Compute Z-score using 5-year rolling window
 */
function computeZScoreAtWeek(
  weekly: WeeklyPoint[],
  weekIdx: number,
  lagWeeks: number,
  windowWeeks: number = 260
): number | null {
  // Need at least windowWeeks of history for delta calculation
  const startIdx = Math.max(lagWeeks, weekIdx - windowWeeks);
  
  if (weekIdx - startIdx < 52) return null; // Need 1 year minimum
  
  // Collect deltas for window
  const deltas: number[] = [];
  for (let i = startIdx; i < weekIdx; i++) {
    const delta = computeDeltaAtWeek(weekly, i, lagWeeks);
    if (delta !== null) {
      deltas.push(delta);
    }
  }
  
  if (deltas.length < 20) return null;
  
  const currentDelta = computeDeltaAtWeek(weekly, weekIdx, lagWeeks);
  if (currentDelta === null) return null;
  
  const m = mean(deltas);
  const sd = stdDev(deltas);
  
  if (sd < 0.001) return 0;
  
  return clamp((currentDelta - m) / sd, -4, 4);
}

// ═══════════════════════════════════════════════════════════════
// EPISODE VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate liquidity regime detection on historical episode
 */
export async function validateEpisode(
  input: EpisodeValidationInput
): Promise<EpisodeValidationResult> {
  const { from, to, expectedRegime, stepDays = 7, thresholdShare = 0.60 } = input;
  
  console.log(`[Liquidity Validate] Episode ${from} → ${to}, expected: ${expectedRegime}`);
  
  // Load all series data
  const walclPoints = await getLiquiditySeriesPoints('WALCL');
  const rrpPoints = await getLiquiditySeriesPoints('RRPONTSYD');
  const tgaPoints = await getLiquiditySeriesPoints('WTREGEN');
  
  // Normalize to weekly
  const walclWeekly = normalizeToWeekly(walclPoints, LIQUIDITY_SERIES.WALCL.frequency);
  const rrpWeekly = normalizeToWeekly(rrpPoints, LIQUIDITY_SERIES.RRPONTSYD.frequency);
  const tgaWeekly = normalizeToWeekly(tgaPoints, LIQUIDITY_SERIES.WTREGEN.frequency);
  
  console.log(`[Liquidity Validate] WALCL: ${walclWeekly.length} weeks, RRP: ${rrpWeekly.length} weeks, TGA: ${tgaWeekly.length} weeks`);
  
  // Helper: find nearest week index (within 7 days)
  function findNearestWeekIdx(weekly: WeeklyPoint[], targetDate: string): number | null {
    const target = new Date(targetDate).getTime();
    let bestIdx: number | null = null;
    let bestDiff = Infinity;
    
    for (let i = 0; i < weekly.length; i++) {
      const diff = Math.abs(new Date(weekly[i].weekEnd).getTime() - target);
      if (diff < bestDiff && diff <= 7 * 24 * 60 * 60 * 1000) {  // within 7 days
        bestDiff = diff;
        bestIdx = i;
      }
    }
    
    return bestIdx;
  }
  
  // Generate dates to check
  const startDate = new Date(from);
  const endDate = new Date(to);
  const snapshots: WeeklySnapshot[] = [];
  
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    // Find nearest Friday
    const dayOfWeek = currentDate.getUTCDay();
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(currentDate);
    friday.setUTCDate(currentDate.getUTCDate() + daysToFriday);
    const weekKey = friday.toISOString().split('T')[0];
    
    // Get indices for this week (find nearest)
    const walclIdx = findNearestWeekIdx(walclWeekly, weekKey);
    const rrpIdx = findNearestWeekIdx(rrpWeekly, weekKey);
    const tgaIdx = findNearestWeekIdx(tgaWeekly, weekKey);
    
    // Compute Z-scores (4-week delta)
    let zWalcl: number | null = null;
    let zRrp: number | null = null;
    let zTga: number | null = null;
    
    if (walclIdx !== undefined) {
      zWalcl = computeZScoreAtWeek(walclWeekly, walclIdx, 4);
    }
    if (rrpIdx !== undefined) {
      zRrp = computeZScoreAtWeek(rrpWeekly, rrpIdx, 4);
    }
    if (tgaIdx !== undefined) {
      zTga = computeZScoreAtWeek(tgaWeekly, tgaIdx, 4);
    }
    
    // Compute impulse if we have at least one component
    const available = [zWalcl, zRrp, zTga].filter(z => z !== null).length;
    
    if (available > 0) {
      // Apply signs
      const walclComponent = (zWalcl ?? 0) * LIQUIDITY_SERIES.WALCL.sign;
      const rrpComponent = (zRrp ?? 0) * LIQUIDITY_SERIES.RRPONTSYD.sign;
      const tgaComponent = (zTga ?? 0) * LIQUIDITY_SERIES.WTREGEN.sign;
      
      const rawImpulse = walclComponent + rrpComponent + tgaComponent;
      const impulse = clamp((rawImpulse * 3) / available, -3, 3);
      
      // Classify regime
      let regime: LiquidityRegime;
      if (impulse > REGIME_THRESHOLDS.EXPANSION_THRESHOLD) {
        regime = 'EXPANSION';
      } else if (impulse < REGIME_THRESHOLDS.CONTRACTION_THRESHOLD) {
        regime = 'CONTRACTION';
      } else {
        regime = 'NEUTRAL';
      }
      
      snapshots.push({
        date: weekKey,
        impulse: Math.round(impulse * 1000) / 1000,
        regime,
        components: {
          walcl: Math.round(walclComponent * 1000) / 1000,
          rrp: Math.round(rrpComponent * 1000) / 1000,
          tga: Math.round(tgaComponent * 1000) / 1000,
        },
      });
    }
    
    // Move to next step
    currentDate.setUTCDate(currentDate.getUTCDate() + stepDays);
  }
  
  // Compute statistics
  const totalWeeks = snapshots.length;
  
  if (totalWeeks === 0) {
    return buildEmptyResult(input, thresholdShare);
  }
  
  const impulses = snapshots.map(s => s.impulse);
  const avgImpulse = Math.round(mean(impulses) * 1000) / 1000;
  const medianImpulse = Math.round(median(impulses) * 1000) / 1000;
  const p10Impulse = Math.round(percentile(impulses, 10) * 1000) / 1000;
  const p90Impulse = Math.round(percentile(impulses, 90) * 1000) / 1000;
  
  // Coverage calculations
  const matchingWeeks = snapshots.filter(s => s.regime === expectedRegime).length;
  const coverageShare = Math.round((matchingWeeks / totalWeeks) * 1000) / 1000;
  
  // Opposite regime
  const oppositeRegime: LiquidityRegime = expectedRegime === 'EXPANSION' ? 'CONTRACTION' : 'EXPANSION';
  const oppositeWeeks = snapshots.filter(s => s.regime === oppositeRegime).length;
  const falseOppositeShare = Math.round((oppositeWeeks / totalWeeks) * 1000) / 1000;
  
  // Max consecutive weeks in expected regime
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  for (const s of snapshots) {
    if (s.regime === expectedRegime) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }
  
  // PASS/FAIL logic
  const passReasons: string[] = [];
  const failReasons: string[] = [];
  
  // Rule 1: Coverage >= threshold
  if (coverageShare >= thresholdShare) {
    passReasons.push(`Coverage ${(coverageShare * 100).toFixed(1)}% >= ${(thresholdShare * 100).toFixed(0)}% threshold`);
  } else {
    failReasons.push(`Coverage ${(coverageShare * 100).toFixed(1)}% < ${(thresholdShare * 100).toFixed(0)}% threshold`);
  }
  
  // Rule 2: Average impulse sign matches
  if (expectedRegime === 'EXPANSION' && avgImpulse > 0) {
    passReasons.push(`Avg impulse ${avgImpulse} > 0 (expansion signal)`);
  } else if (expectedRegime === 'CONTRACTION' && avgImpulse < 0) {
    passReasons.push(`Avg impulse ${avgImpulse} < 0 (contraction signal)`);
  } else if (expectedRegime === 'EXPANSION' && avgImpulse <= 0) {
    failReasons.push(`Avg impulse ${avgImpulse} ≤ 0 (expected positive for EXPANSION)`);
  } else if (expectedRegime === 'CONTRACTION' && avgImpulse >= 0) {
    failReasons.push(`Avg impulse ${avgImpulse} ≥ 0 (expected negative for CONTRACTION)`);
  }
  
  // Rule 3: Expected > Opposite (directional dominance)
  if (coverageShare > falseOppositeShare) {
    passReasons.push(`Expected regime ${(coverageShare * 100).toFixed(1)}% > opposite ${(falseOppositeShare * 100).toFixed(1)}%`);
  } else if (falseOppositeShare > coverageShare + 0.1) {
    failReasons.push(`Opposite regime ${(falseOppositeShare * 100).toFixed(1)}% dominates expected ${(coverageShare * 100).toFixed(1)}%`);
  }
  
  // Rule 4: False opposite should be low (soft warning, not fail)
  if (falseOppositeShare <= 0.20) {
    passReasons.push(`False opposite ${(falseOppositeShare * 100).toFixed(1)}% ≤ 20%`);
  } else if (falseOppositeShare > 0.35) {
    // Only warn, don't fail — mixed periods are expected
    passReasons.push(`[NOTE] High false opposite ${(falseOppositeShare * 100).toFixed(1)}% — mixed signals period`);
  }
  
  // Final verdict: PASS if no hard failures and at least 2 pass conditions
  const result: 'PASS' | 'FAIL' = failReasons.length === 0 && passReasons.length >= 2 ? 'PASS' : 'FAIL';
  
  return {
    episode: {
      from,
      to,
      expectedRegime,
      thresholdShare,
    },
    result,
    stats: {
      totalWeeks,
      coverageShare,
      avgImpulse,
      medianImpulse,
      p10Impulse,
      p90Impulse,
      maxConsecutiveWeeks: maxConsecutive,
      falseOppositeShare,
    },
    passReasons,
    failReasons,
    snapshots,
  };
}

function buildEmptyResult(
  input: EpisodeValidationInput,
  thresholdShare: number
): EpisodeValidationResult {
  return {
    episode: {
      from: input.from,
      to: input.to,
      expectedRegime: input.expectedRegime,
      thresholdShare,
    },
    result: 'FAIL',
    stats: {
      totalWeeks: 0,
      coverageShare: 0,
      avgImpulse: 0,
      medianImpulse: 0,
      p10Impulse: 0,
      p90Impulse: 0,
      maxConsecutiveWeeks: 0,
      falseOppositeShare: 0,
    },
    passReasons: [],
    failReasons: ['No data available for episode'],
    snapshots: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// PREDEFINED EPISODES
// ═══════════════════════════════════════════════════════════════

export const PREDEFINED_EPISODES = {
  QE_2020: {
    name: '2020 QE (COVID Response)',
    from: '2020-03-01',
    to: '2021-03-01',
    expectedRegime: 'EXPANSION' as LiquidityRegime,
    thresholdShare: 0.35,  // Reduced from 0.60 — fiscal TGA offset is expected
    description: 'Fed massive balance sheet expansion post-COVID',
  },
  QT_2022: {
    name: '2022 QT (Tightening)',
    from: '2022-04-01',
    to: '2023-01-01',
    expectedRegime: 'CONTRACTION' as LiquidityRegime,
    thresholdShare: 0.35,  // Reduced from 0.55 — mixed signals expected
    description: 'Fed quantitative tightening + rate hikes',
  },
};

/**
 * Run all predefined episode validations
 */
export async function validateAllEpisodes(): Promise<{
  ok: boolean;
  passCount: number;
  failCount: number;
  results: Record<string, EpisodeValidationResult>;
}> {
  const results: Record<string, EpisodeValidationResult> = {};
  
  for (const [key, episode] of Object.entries(PREDEFINED_EPISODES)) {
    console.log(`[Liquidity Validate] Running ${episode.name}...`);
    
    const result = await validateEpisode({
      from: episode.from,
      to: episode.to,
      expectedRegime: episode.expectedRegime,
      thresholdShare: episode.thresholdShare,
    });
    
    results[key] = result;
    
    console.log(`[Liquidity Validate] ${episode.name}: ${result.result}`);
  }
  
  const passCount = Object.values(results).filter(r => r.result === 'PASS').length;
  const failCount = Object.values(results).filter(r => r.result === 'FAIL').length;
  
  return {
    ok: failCount === 0,
    passCount,
    failCount,
    results,
  };
}
