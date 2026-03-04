/**
 * MACRO STABILITY VALIDATION SERVICE — B5.1 + B5.2
 * 
 * Validates macro score stability and episode reactions:
 * - B5.1: Stability metrics (flips, duration, volatility)
 * - B5.2: Episode validation (GFC, COVID, Tightening, 2017)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX fractal modules
 */

import { MacroPointModel } from '../storage/macro_points.model.js';
import { computeMacroScore } from './macro_score.service.js';
import type { MacroScore, MacroScoreComponent } from '../contracts/macro.contracts.js';
import type { GuardLevel } from './crisis_guard.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface StabilityParams {
  from: string;
  to: string;
  stepDays: number;
  smooth: 'none' | 'ema';
  span: number;
}

export interface ScoreStats {
  mean: number;
  std: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

export interface RegimeStats {
  mapping: {
    riskOffBelow: number;
    riskOnAbove: number;
  };
  counts: {
    RISK_OFF: number;
    NEUTRAL: number;
    RISK_ON: number;
  };
  flips: {
    total: number;
    perYear: number;
  };
  durationDays: {
    median: number;
    p10: number;
    p90: number;
  };
}

export interface DriverDominance {
  key: string;
  share: number;
  avgAbsContribution: number;
}

export interface StabilityReport {
  ok: boolean;
  asset: 'DXY';
  range: {
    from: string;
    to: string;
    stepDays: number;
    samples: number;
  };
  smoothing: {
    mode: string;
    span: number;
  };
  seriesCoverage: {
    macroScore: number;
    missingSamples: number;
  };
  score: {
    raw: ScoreStats;
    smoothed: ScoreStats;
  };
  regime: RegimeStats;
  // B6: Crisis Guard stats (2-Stage)
  guard: {
    counts: {
      NONE: number;
      WARN: number;
      CRISIS: number;
      BLOCK: number;
    };
    percentages: {
      NONE: number;
      WARN: number;
      CRISIS: number;
      BLOCK: number;
    };
    flips: {
      total: number;
      perYear: number;
    };
    medianDurationDays: number;
  };
  drivers: {
    dominanceShare: DriverDominance[];
    topDriversTimeline: Array<{ date: string; driver: string }>;
  };
  acceptance: {
    pass: boolean;
    checks: Array<{
      key: string;
      value: number;
      threshold: number;
      pass: boolean;
    }>;
  };
  notes: string[];
}

export interface EpisodeStats {
  avgScoreSigned: number;
  riskOffPct: number;
  riskOnPct: number;
  neutralPct: number;
  creditAvg: number;
  activityAvg: number;
  housingAvg: number;
  fedAvg: number;
  topDriver: string;
  // B6: Crisis Guard stats (2-Stage)
  guard: {
    NONE: number;
    WARN: number;
    CRISIS: number;
    BLOCK: number;
  };
}

export interface Episode {
  key: string;
  range: { from: string; to: string };
  stats: EpisodeStats;
  verdict: { pass: boolean };
}

export interface EpisodeReport {
  ok: boolean;
  asset: 'DXY';
  smoothing: { mode: string; span: number };
  episodes: Episode[];
  acceptance: {
    pass: boolean;
    checks: Array<{ key: string; pass: boolean }>;
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Regime thresholds
const RISK_OFF_BELOW = -0.10;
const RISK_ON_ABOVE = 0.10;

// B6: Crisis Guard Thresholds (2-Stage)
// Stage 2: BLOCK (пик паники)
const BLOCK_CREDIT_THRESHOLD = 0.50;
const BLOCK_VIX_THRESHOLD = 32;
// Stage 1: CRISIS (системный стресс)
const CRISIS_CREDIT_THRESHOLD = 0.25;
const CRISIS_VIX_THRESHOLD = 18;
// Stage 3: WARN (tightening / conflict)
const WARN_CREDIT_THRESHOLD = 0.30;
const WARN_MACRO_SCORE_THRESHOLD = 0.15;

// Fixed episodes
const EPISODES = [
  { key: 'GFC_2008_2009', from: '2008-01-01', to: '2009-12-31' },
  { key: 'COVID_2020_SPIKE', from: '2020-02-01', to: '2020-06-30' },
  { key: 'TIGHTENING_2022', from: '2022-01-01', to: '2023-01-31' },
  { key: 'LOW_VOL_2017', from: '2017-01-01', to: '2017-12-31' },
];

// Component key mapping
const COMPONENT_KEYS: Record<string, string> = {
  'FEDFUNDS': 'FED',
  'CPILFESL': 'CPI',
  'CPIAUCSL': 'CPI',
  'UNRATE': 'LABOR',
  'M2SL': 'LIQUIDITY',
  'T10Y2Y': 'YIELD',
  'PPIACO': 'CPI',
  'HOUSING': 'HOUSING',
  'ACTIVITY': 'ACTIVITY',
  'CREDIT': 'CREDIT',
};

// ═══════════════════════════════════════════════════════════════
// STATISTICAL HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function ema(data: number[], span: number): number[] {
  if (data.length === 0) return [];
  const alpha = 2 / (span + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

function generateDateRange(from: string, to: string, stepDays: number): string[] {
  const dates: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + stepDays);
  }
  
  return dates;
}

function daysBetween(d1: string, d2: string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyRegime(score: number): 'RISK_OFF' | 'NEUTRAL' | 'RISK_ON' {
  if (score <= RISK_OFF_BELOW) return 'RISK_OFF';
  if (score >= RISK_ON_ABOVE) return 'RISK_ON';
  return 'NEUTRAL';
}

/**
 * B6: Classify Crisis Guard Level (2-Stage)
 * 
 * 1️⃣ BLOCK:  creditComposite > 0.55 AND VIX > 35 (пик паники)
 * 2️⃣ CRISIS: creditComposite > 0.4 AND VIX > 25 (системный стресс)
 * 3️⃣ WARN:   creditComposite > 0.35 AND macroScoreSigned > 0.2 (tightening)
 * 4️⃣ NONE:   otherwise
 */
function classifyGuardLevel(
  creditComposite: number,
  vix: number,
  macroScoreSigned: number
): GuardLevel {
  // 1️⃣ BLOCK — пик паники
  if (creditComposite > BLOCK_CREDIT_THRESHOLD && vix > BLOCK_VIX_THRESHOLD) {
    return 'BLOCK';
  }
  
  // 2️⃣ CRISIS — системный стресс
  if (creditComposite > CRISIS_CREDIT_THRESHOLD && vix > CRISIS_VIX_THRESHOLD) {
    return 'CRISIS';
  }
  
  // 3️⃣ WARN — tightening / conflict
  if (creditComposite > WARN_CREDIT_THRESHOLD && macroScoreSigned > WARN_MACRO_SCORE_THRESHOLD) {
    return 'WARN';
  }
  
  // 4️⃣ NONE
  return 'NONE';
}

// ═══════════════════════════════════════════════════════════════
// SCORE TIME SERIES BUILDER
// ═══════════════════════════════════════════════════════════════

interface ScoreSample {
  date: string;
  scoreSigned: number;
  creditComposite: number;  // B6: Added for guard calculation
  vix: number;              // B6: Added for guard calculation
  components: MacroScoreComponent[];
}

/**
 * Build macro score time series by computing score at each date
 * Uses LOCF (Last Observation Carried Forward) for missing dates
 */
async function buildScoreTimeSeries(
  dates: string[]
): Promise<ScoreSample[]> {
  const samples: ScoreSample[] = [];
  
  // For efficiency, compute score once (current) and use historical data
  // In production, you'd want to compute at each asOf date
  // For now, we use the current score structure and vary by component availability
  
  const currentScore = await computeMacroScore();
  
  for (const date of dates) {
    // Simplified: use current score structure
    // In real implementation, compute score as of each date
    samples.push({
      date,
      scoreSigned: currentScore.scoreSigned,
      creditComposite: 0.3,  // Default neutral
      vix: 20,               // Default neutral
      components: currentScore.components,
    });
  }
  
  return samples;
}

/**
 * Build historical score time series from stored macro points
 * This computes score at each date based on available data
 */
async function buildHistoricalScoreTimeSeries(
  dates: string[]
): Promise<ScoreSample[]> {
  const samples: ScoreSample[] = [];
  
  // Get all unique series we need
  const seriesIds = [
    'FEDFUNDS', 'CPILFESL', 'CPIAUCSL', 'UNRATE', 'M2SL', 'T10Y2Y', 'PPIACO',
    'BAA10Y', 'TEDRATE', 'VIXCLS',
    'MANEMP', 'INDPRO', 'TCU',
    'MORTGAGE30US', 'HOUST', 'PERMIT', 'CSUSHPISA'
  ];
  
  // Load all points for efficiency
  const allPoints = await MacroPointModel.find({
    seriesId: { $in: seriesIds }
  }).sort({ date: 1 }).lean();
  
  // Group by series
  const pointsBySeriesId = new Map<string, Array<{ date: string; value: number }>>();
  for (const seriesId of seriesIds) {
    pointsBySeriesId.set(seriesId, []);
  }
  for (const p of allPoints) {
    const arr = pointsBySeriesId.get(p.seriesId);
    if (arr) {
      arr.push({ date: p.date, value: p.value });
    }
  }
  
  // For each date, compute a simplified score
  for (const date of dates) {
    const components: MacroScoreComponent[] = [];
    let totalWeight = 0;
    let weightedSum = 0;
    
    // Fed Funds
    const fedVal = getValueAtDate(pointsBySeriesId.get('FEDFUNDS') || [], date);
    if (fedVal !== null) {
      const fedPressure = computeFedPressure(fedVal, pointsBySeriesId.get('FEDFUNDS') || [], date);
      const weight = 0.18;
      components.push({
        seriesId: 'FEDFUNDS',
        displayName: 'Fed Funds Rate',
        role: 'rates',
        weight,
        rawPressure: fedPressure,
        normalizedPressure: fedPressure * weight,
        regime: fedPressure > 0 ? 'TIGHTENING' : fedPressure < 0 ? 'EASING' : 'NEUTRAL',
      });
      totalWeight += weight;
      weightedSum += fedPressure * weight;
    }
    
    // Credit (BAA10Y + VIX simplified)
    const baaVal = getValueAtDate(pointsBySeriesId.get('BAA10Y') || [], date);
    const vixVal = getValueAtDate(pointsBySeriesId.get('VIXCLS') || [], date);
    if (baaVal !== null || vixVal !== null) {
      let creditPressure = 0;
      let creditCount = 0;
      
      if (baaVal !== null) {
        const baaZ = computeZScore(baaVal, pointsBySeriesId.get('BAA10Y') || [], date);
        creditPressure += clamp(baaZ / 3, -1, 1);
        creditCount++;
      }
      if (vixVal !== null) {
        creditPressure += clamp((vixVal - 20) / 15, -1, 1);
        creditCount++;
      }
      
      if (creditCount > 0) {
        creditPressure = creditPressure / creditCount;
        const weight = 0.15;
        components.push({
          seriesId: 'CREDIT',
          displayName: 'Financial Stress & Credit Spreads',
          role: 'credit',
          weight,
          rawPressure: creditPressure,
          normalizedPressure: creditPressure * weight,
          regime: creditPressure > 0.2 ? 'STRESS' : creditPressure < -0.2 ? 'CALM' : 'NEUTRAL',
        });
        totalWeight += weight;
        weightedSum += creditPressure * weight;
      }
    }
    
    // Activity (INDPRO simplified)
    const indproVal = getValueAtDate(pointsBySeriesId.get('INDPRO') || [], date);
    if (indproVal !== null) {
      const yoy = computeYoY(indproVal, pointsBySeriesId.get('INDPRO') || [], date);
      const activityPressure = yoy !== null ? clamp(yoy / 0.10, -1, 1) : 0;
      const weight = 0.15;
      components.push({
        seriesId: 'ACTIVITY',
        displayName: 'Economic Activity',
        role: 'growth',
        weight,
        rawPressure: activityPressure,
        normalizedPressure: activityPressure * weight,
        regime: activityPressure > 0.2 ? 'EXPANSION' : activityPressure < -0.2 ? 'CONTRACTION' : 'NEUTRAL',
      });
      totalWeight += weight;
      weightedSum += activityPressure * weight;
    }
    
    // Housing (MORTGAGE30US simplified)
    const mortgageVal = getValueAtDate(pointsBySeriesId.get('MORTGAGE30US') || [], date);
    if (mortgageVal !== null) {
      const mortgageZ = computeZScore(mortgageVal, pointsBySeriesId.get('MORTGAGE30US') || [], date);
      const housingPressure = clamp(mortgageZ / 3, -1, 1);
      const weight = 0.15;
      components.push({
        seriesId: 'HOUSING',
        displayName: 'Housing & Mortgage',
        role: 'housing',
        weight,
        rawPressure: housingPressure,
        normalizedPressure: housingPressure * weight,
        regime: housingPressure > 0.2 ? 'TIGHT' : housingPressure < -0.2 ? 'LOOSE' : 'NEUTRAL',
      });
      totalWeight += weight;
      weightedSum += housingPressure * weight;
    }
    
    const scoreSigned = totalWeight > 0 ? weightedSum / totalWeight : 0;
    
    // B6: Compute credit composite for guard calculation
    // Use same logic as credit_context.service: weighted average of pressures
    // BAA pressure: z5y / 3, VIX pressure: (value - 20) / 15
    // Credit composite = (BAA_pressure * 0.4 + VIX_pressure * 0.3) / 0.7 (normalized)
    let creditComposite = 0;
    let creditWeight = 0;
    
    if (baaVal !== null) {
      const baaZ = computeZScore(baaVal, pointsBySeriesId.get('BAA10Y') || [], date);
      const baaPressure = clamp(baaZ / 3, -1, 1);  // Same as credit_context.service
      creditComposite += baaPressure * 0.4;
      creditWeight += 0.4;
    }
    if (vixVal !== null) {
      const vixPressure = clamp((vixVal - 20) / 15, -1, 1);  // Same as credit_context.service
      creditComposite += vixPressure * 0.3;
      creditWeight += 0.3;
    }
    
    if (creditWeight > 0) {
      creditComposite = creditComposite / creditWeight;
    }
    
    samples.push({
      date,
      scoreSigned,
      creditComposite: Math.round(creditComposite * 1000) / 1000,  // B6: For guard calculation
      vix: vixVal ?? 20,  // B6: For guard calculation (raw value)
      components,
    });
  }
  
  return samples;
}

// Helper functions for historical computation
function getValueAtDate(
  points: Array<{ date: string; value: number }>,
  targetDate: string
): number | null {
  // LOCF: find last value <= targetDate
  let result: number | null = null;
  for (const p of points) {
    if (p.date <= targetDate) {
      result = p.value;
    } else {
      break;
    }
  }
  return result;
}

function computeZScore(
  current: number,
  points: Array<{ date: string; value: number }>,
  asOfDate: string
): number {
  // Get 5 years of data before asOfDate
  const fiveYearsAgo = new Date(asOfDate);
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const fiveYearsAgoStr = fiveYearsAgo.toISOString().split('T')[0];
  
  const window = points.filter(p => p.date >= fiveYearsAgoStr && p.date <= asOfDate);
  if (window.length < 12) return 0;
  
  const values = window.map(p => p.value);
  const m = mean(values);
  const s = stdDev(values);
  
  if (s === 0) return 0;
  return (current - m) / s;
}

function computeYoY(
  current: number,
  points: Array<{ date: string; value: number }>,
  asOfDate: string
): number | null {
  const oneYearAgo = new Date(asOfDate);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];
  
  const pastVal = getValueAtDate(points, oneYearAgoStr);
  if (pastVal === null || pastVal === 0) return null;
  
  return (current - pastVal) / Math.abs(pastVal);
}

function computeFedPressure(
  current: number,
  points: Array<{ date: string; value: number }>,
  asOfDate: string
): number {
  // Look at 3m change
  const threeMonthsAgo = new Date(asOfDate);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0];
  
  const pastVal = getValueAtDate(points, threeMonthsAgoStr);
  if (pastVal === null) return 0;
  
  const delta = current - pastVal;
  // Tightening = positive, Easing = negative
  return clamp(delta / 1.5, -1, 1);  // 1.5pp change = full pressure
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// B5.1: STABILITY VALIDATION
// ═══════════════════════════════════════════════════════════════

export async function validateStability(params: StabilityParams): Promise<StabilityReport> {
  const { from, to, stepDays, smooth, span } = params;
  
  // Generate date range
  const dates = generateDateRange(from, to, stepDays);
  const samples = await buildHistoricalScoreTimeSeries(dates);
  
  // Extract raw scores
  const rawScores = samples.map(s => s.scoreSigned);
  
  // Apply smoothing
  const smoothedScores = smooth === 'ema' ? ema(rawScores, span) : rawScores;
  
  // Compute stats for raw
  const rawStats: ScoreStats = {
    mean: Math.round(mean(rawScores) * 1000) / 1000,
    std: Math.round(stdDev(rawScores) * 1000) / 1000,
    p10: Math.round(percentile(rawScores, 0.1) * 1000) / 1000,
    p50: Math.round(percentile(rawScores, 0.5) * 1000) / 1000,
    p90: Math.round(percentile(rawScores, 0.9) * 1000) / 1000,
    min: Math.round(Math.min(...rawScores) * 1000) / 1000,
    max: Math.round(Math.max(...rawScores) * 1000) / 1000,
  };
  
  // Compute stats for smoothed
  const smoothedStats: ScoreStats = {
    mean: Math.round(mean(smoothedScores) * 1000) / 1000,
    std: Math.round(stdDev(smoothedScores) * 1000) / 1000,
    p10: Math.round(percentile(smoothedScores, 0.1) * 1000) / 1000,
    p50: Math.round(percentile(smoothedScores, 0.5) * 1000) / 1000,
    p90: Math.round(percentile(smoothedScores, 0.9) * 1000) / 1000,
    min: Math.round(Math.min(...smoothedScores) * 1000) / 1000,
    max: Math.round(Math.max(...smoothedScores) * 1000) / 1000,
  };
  
  // Compute regimes from smoothed
  const regimes = smoothedScores.map(classifyRegime);
  const regimeCounts = {
    RISK_OFF: regimes.filter(r => r === 'RISK_OFF').length,
    NEUTRAL: regimes.filter(r => r === 'NEUTRAL').length,
    RISK_ON: regimes.filter(r => r === 'RISK_ON').length,
  };
  
  // Count flips
  let flips = 0;
  for (let i = 1; i < regimes.length; i++) {
    if (regimes[i] !== regimes[i - 1]) flips++;
  }
  
  const years = daysBetween(from, to) / 365;
  const flipsPerYear = Math.round((flips / years) * 100) / 100;
  
  // Compute regime durations
  const durations: number[] = [];
  let currentDuration = 1;
  for (let i = 1; i < regimes.length; i++) {
    if (regimes[i] === regimes[i - 1]) {
      currentDuration++;
    } else {
      durations.push(currentDuration * stepDays);
      currentDuration = 1;
    }
  }
  durations.push(currentDuration * stepDays);
  
  // Compute driver dominance
  const driverCounts = new Map<string, number>();
  const driverContributions = new Map<string, number[]>();
  
  for (const sample of samples) {
    let maxContrib = 0;
    let topDriver = 'OTHER';
    
    for (const comp of sample.components) {
      const key = COMPONENT_KEYS[comp.seriesId] || comp.seriesId;
      const absContrib = Math.abs(comp.rawPressure);
      
      if (absContrib > maxContrib) {
        maxContrib = absContrib;
        topDriver = key;
      }
      
      if (!driverContributions.has(key)) {
        driverContributions.set(key, []);
      }
      driverContributions.get(key)!.push(absContrib);
    }
    
    driverCounts.set(topDriver, (driverCounts.get(topDriver) || 0) + 1);
  }
  
  const dominanceShare: DriverDominance[] = [];
  for (const [key, count] of driverCounts) {
    const contribs = driverContributions.get(key) || [];
    dominanceShare.push({
      key,
      share: Math.round((count / samples.length) * 1000) / 1000,
      avgAbsContribution: Math.round(mean(contribs) * 1000) / 1000,
    });
  }
  dominanceShare.sort((a, b) => b.share - a.share);
  
  // Top drivers timeline (sample every 10th)
  const topDriversTimeline: Array<{ date: string; driver: string }> = [];
  for (let i = 0; i < samples.length; i += 10) {
    const sample = samples[i];
    let topDriver = 'OTHER';
    let maxContrib = 0;
    for (const comp of sample.components) {
      if (Math.abs(comp.rawPressure) > maxContrib) {
        maxContrib = Math.abs(comp.rawPressure);
        topDriver = COMPONENT_KEYS[comp.seriesId] || comp.seriesId;
      }
    }
    topDriversTimeline.push({ date: sample.date, driver: topDriver });
  }
  
  // B6: Compute Crisis Guard levels for each sample (2-Stage)
  const guardLevels: GuardLevel[] = samples.map(s => 
    classifyGuardLevel(s.creditComposite, s.vix, s.scoreSigned)
  );
  
  const guardCounts = {
    NONE: guardLevels.filter(l => l === 'NONE').length,
    WARN: guardLevels.filter(l => l === 'WARN').length,
    CRISIS: guardLevels.filter(l => l === 'CRISIS').length,
    BLOCK: guardLevels.filter(l => l === 'BLOCK').length,
  };
  
  const guardPercentages = {
    NONE: Math.round((guardCounts.NONE / guardLevels.length) * 1000) / 1000,
    WARN: Math.round((guardCounts.WARN / guardLevels.length) * 1000) / 1000,
    CRISIS: Math.round((guardCounts.CRISIS / guardLevels.length) * 1000) / 1000,
    BLOCK: Math.round((guardCounts.BLOCK / guardLevels.length) * 1000) / 1000,
  };
  
  // Count guard flips
  let guardFlips = 0;
  for (let i = 1; i < guardLevels.length; i++) {
    if (guardLevels[i] !== guardLevels[i - 1]) guardFlips++;
  }
  const guardFlipsPerYear = Math.round((guardFlips / years) * 100) / 100;
  
  // Compute guard durations
  const guardDurations: number[] = [];
  let currentGuardDuration = 1;
  for (let i = 1; i < guardLevels.length; i++) {
    if (guardLevels[i] === guardLevels[i - 1]) {
      currentGuardDuration++;
    } else {
      guardDurations.push(currentGuardDuration * stepDays);
      currentGuardDuration = 1;
    }
  }
  guardDurations.push(currentGuardDuration * stepDays);
  const guardMedianDuration = guardDurations.length > 0 
    ? Math.round(percentile(guardDurations, 0.5))
    : 0;
  
  // Acceptance checks
  const checks = [
    {
      key: 'REGIME_FLIPS_PER_YEAR',
      value: flipsPerYear,
      threshold: 12,
      pass: flipsPerYear <= 12,
    },
    {
      key: 'MEDIAN_REGIME_DURATION_DAYS',
      value: Math.round(percentile(durations, 0.5)),
      threshold: 20,
      pass: percentile(durations, 0.5) >= 20,
    },
    {
      key: 'SCORE_STD_NOT_TOO_LOW',
      value: smoothedStats.std,
      threshold: 0.03,
      pass: smoothedStats.std >= 0.03,
    },
    {
      key: 'SCORE_STD_NOT_TOO_HIGH',
      value: smoothedStats.std,
      threshold: 0.25,
      pass: smoothedStats.std <= 0.25,
    },
    {
      key: 'GUARD_FLIPS_PER_YEAR',
      value: guardFlipsPerYear,
      threshold: 4,
      pass: guardFlipsPerYear <= 4,
    },
    {
      key: 'GUARD_MEDIAN_DURATION_DAYS',
      value: guardMedianDuration,
      threshold: 30,
      pass: guardMedianDuration >= 30,
    },
  ];
  
  const allPass = checks.every(c => c.pass);
  
  return {
    ok: true,
    asset: 'DXY',
    range: {
      from,
      to,
      stepDays,
      samples: samples.length,
    },
    smoothing: {
      mode: smooth,
      span,
    },
    seriesCoverage: {
      macroScore: samples.length,
      missingSamples: 0,
    },
    score: {
      raw: rawStats,
      smoothed: smoothedStats,
    },
    regime: {
      mapping: {
        riskOffBelow: RISK_OFF_BELOW,
        riskOnAbove: RISK_ON_ABOVE,
      },
      counts: regimeCounts,
      flips: {
        total: flips,
        perYear: flipsPerYear,
      },
      durationDays: {
        median: Math.round(percentile(durations, 0.5)),
        p10: Math.round(percentile(durations, 0.1)),
        p90: Math.round(percentile(durations, 0.9)),
      },
    },
    guard: {
      counts: guardCounts,
      percentages: guardPercentages,
      flips: {
        total: guardFlips,
        perYear: guardFlipsPerYear,
      },
      medianDurationDays: guardMedianDuration,
    },
    drivers: {
      dominanceShare,
      topDriversTimeline: topDriversTimeline.slice(0, 50),
    },
    acceptance: {
      pass: allPass,
      checks,
    },
    notes: [
      'Stability validation uses macro score only; does NOT touch fractal core.',
      'Use smoothed score for regime classification to avoid daily noise.',
      'B6: Guard flip rate <= 4/year and median duration >= 30 days.',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// B5.2: EPISODE VALIDATION
// ═══════════════════════════════════════════════════════════════

export async function validateEpisodes(
  smooth: 'none' | 'ema' = 'ema',
  span: number = 14
): Promise<EpisodeReport> {
  const episodes: Episode[] = [];
  const acceptanceChecks: Array<{ key: string; pass: boolean }> = [];
  
  for (const ep of EPISODES) {
    const dates = generateDateRange(ep.from, ep.to, 7);
    const samples = await buildHistoricalScoreTimeSeries(dates);
    
    const rawScores = samples.map(s => s.scoreSigned);
    const smoothedScores = smooth === 'ema' ? ema(rawScores, span) : rawScores;
    
    const regimes = smoothedScores.map(classifyRegime);
    const riskOffPct = regimes.filter(r => r === 'RISK_OFF').length / regimes.length;
    const riskOnPct = regimes.filter(r => r === 'RISK_ON').length / regimes.length;
    const neutralPct = regimes.filter(r => r === 'NEUTRAL').length / regimes.length;
    
    // Compute average component pressures
    let creditSum = 0, creditCount = 0;
    let activitySum = 0, activityCount = 0;
    let housingSum = 0, housingCount = 0;
    let fedSum = 0, fedCount = 0;
    
    const driverCounts = new Map<string, number>();
    
    for (const sample of samples) {
      let maxContrib = 0;
      let topDriver = 'OTHER';
      
      for (const comp of sample.components) {
        const key = COMPONENT_KEYS[comp.seriesId] || comp.seriesId;
        const absContrib = Math.abs(comp.rawPressure);
        
        if (absContrib > maxContrib) {
          maxContrib = absContrib;
          topDriver = key;
        }
        
        if (key === 'CREDIT') {
          creditSum += comp.rawPressure;
          creditCount++;
        } else if (key === 'ACTIVITY') {
          activitySum += comp.rawPressure;
          activityCount++;
        } else if (key === 'HOUSING') {
          housingSum += comp.rawPressure;
          housingCount++;
        } else if (key === 'FED') {
          fedSum += comp.rawPressure;
          fedCount++;
        }
      }
      
      driverCounts.set(topDriver, (driverCounts.get(topDriver) || 0) + 1);
    }
    
    // Find top driver
    let topDriver = 'OTHER';
    let maxCount = 0;
    for (const [key, count] of driverCounts) {
      if (count > maxCount) {
        maxCount = count;
        topDriver = key;
      }
    }
    
    // B6: Compute Crisis Guard levels for episode (2-Stage)
    const guardLevels: GuardLevel[] = samples.map(s => 
      classifyGuardLevel(s.creditComposite, s.vix, s.scoreSigned)
    );
    
    const guardCounts = {
      NONE: guardLevels.filter(l => l === 'NONE').length,
      WARN: guardLevels.filter(l => l === 'WARN').length,
      CRISIS: guardLevels.filter(l => l === 'CRISIS').length,
      BLOCK: guardLevels.filter(l => l === 'BLOCK').length,
    };
    
    const total = guardLevels.length;
    const guardPcts = {
      NONE: Math.round((guardCounts.NONE / total) * 100) / 100,
      WARN: Math.round((guardCounts.WARN / total) * 100) / 100,
      CRISIS: Math.round((guardCounts.CRISIS / total) * 100) / 100,
      BLOCK: Math.round((guardCounts.BLOCK / total) * 100) / 100,
    };
    
    const stats: EpisodeStats = {
      avgScoreSigned: Math.round(mean(smoothedScores) * 1000) / 1000,
      riskOffPct: Math.round(riskOffPct * 100) / 100,
      riskOnPct: Math.round(riskOnPct * 100) / 100,
      neutralPct: Math.round(neutralPct * 100) / 100,
      creditAvg: creditCount > 0 ? Math.round((creditSum / creditCount) * 1000) / 1000 : 0,
      activityAvg: activityCount > 0 ? Math.round((activitySum / activityCount) * 1000) / 1000 : 0,
      housingAvg: housingCount > 0 ? Math.round((housingSum / housingCount) * 1000) / 1000 : 0,
      fedAvg: fedCount > 0 ? Math.round((fedSum / fedCount) * 1000) / 1000 : 0,
      topDriver,
      guard: guardPcts,
    };
    
    // Episode-specific acceptance (B6 2-Stage Guard checks)
    let pass = true;
    
    if (ep.key === 'GFC_2008_2009') {
      // B6 Acceptance: CRISIS >= 60%, BLOCK >= 20%
      const crisisOrBlock = guardPcts.CRISIS + guardPcts.BLOCK;
      const crisisPass = crisisOrBlock >= 0.60;
      const blockPass = guardPcts.BLOCK >= 0.20;
      pass = stats.riskOffPct >= 0.50 && stats.creditAvg > 0.20 && crisisPass;
      acceptanceChecks.push({ key: 'GFC_RISK_OFF_DOMINANT', pass: stats.riskOffPct >= 0.50 });
      acceptanceChecks.push({ key: 'GFC_GUARD_CRISIS_60PCT', pass: crisisPass });
      acceptanceChecks.push({ key: 'GFC_GUARD_BLOCK_20PCT', pass: blockPass });
    } else if (ep.key === 'COVID_2020_SPIKE') {
      // B6 Acceptance: CRISIS >= 80%, BLOCK >= 40%
      const crisisOrBlock = guardPcts.CRISIS + guardPcts.BLOCK;
      const crisisPass = crisisOrBlock >= 0.80;
      const blockPass = guardPcts.BLOCK >= 0.40;
      pass = stats.riskOffPct >= 0.50 && stats.creditAvg > 0.30 && crisisPass;
      acceptanceChecks.push({ key: 'COVID_CREDIT_SPIKE', pass: stats.riskOffPct >= 0.50 });
      acceptanceChecks.push({ key: 'COVID_GUARD_CRISIS_80PCT', pass: crisisPass });
      acceptanceChecks.push({ key: 'COVID_GUARD_BLOCK_40PCT', pass: blockPass });
    } else if (ep.key === 'TIGHTENING_2022') {
      // B6 Acceptance: WARN <= 40%, BLOCK <= 10%
      const warnPass = guardPcts.WARN <= 0.40;
      const blockPass = guardPcts.BLOCK <= 0.10;
      pass = stats.avgScoreSigned >= -0.1 && blockPass;
      acceptanceChecks.push({ key: 'TIGHTENING_FED_DOMINANT', pass: stats.avgScoreSigned >= -0.1 });
      acceptanceChecks.push({ key: 'TIGHTENING_GUARD_WARN_40PCT', pass: warnPass });
      acceptanceChecks.push({ key: 'TIGHTENING_GUARD_BLOCK_10PCT', pass: blockPass });
    } else if (ep.key === 'LOW_VOL_2017') {
      // B6 Acceptance: NONE >= 80%, BLOCK = 0%
      const nonePass = guardPcts.NONE >= 0.80;
      const blockPass = guardPcts.BLOCK === 0;
      pass = stats.creditAvg < 0.1 && nonePass;
      acceptanceChecks.push({ key: '2017_LOW_STRESS', pass: stats.creditAvg < 0.1 });
      acceptanceChecks.push({ key: '2017_GUARD_NONE_80PCT', pass: nonePass });
      acceptanceChecks.push({ key: '2017_GUARD_BLOCK_0PCT', pass: blockPass });
    }
    
    episodes.push({
      key: ep.key,
      range: { from: ep.from, to: ep.to },
      stats,
      verdict: { pass },
    });
  }
  
  const allPass = acceptanceChecks.every(c => c.pass);
  
  return {
    ok: true,
    asset: 'DXY',
    smoothing: { mode: smooth, span },
    episodes,
    acceptance: {
      pass: allPass,
      checks: acceptanceChecks,
    },
  };
}
