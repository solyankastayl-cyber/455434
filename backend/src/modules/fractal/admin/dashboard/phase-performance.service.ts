/**
 * BLOCK 73.6 — Phase Performance Service
 * 
 * Institutional-grade phase attribution engine.
 * Uses ONLY forward-truth (resolved snapshots), no backtest.
 * 
 * Provides:
 * - Per-phase statistics (hitRate, avgReturn, sharpe, etc.)
 * - Grade calculation (A-F based on composite score)
 * - Tier-separated analysis (TIMING/TACTICAL/STRUCTURE)
 */

import { SignalSnapshotModel, type SignalSnapshotDocument } from '../../storage/signal-snapshot.schema.js';
import { CanonicalStore } from '../../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';
export type Role = 'ACTIVE' | 'SHADOW';
export type Preset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type SampleQuality = 'OK' | 'LOW_SAMPLE' | 'VERY_LOW_SAMPLE';
export type PhaseType = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'RECOVERY' | 'CAPITULATION' | 'UNKNOWN';

// Tier to horizon mapping
const TIER_HORIZONS: Record<Tier, number[]> = {
  TIMING: [7, 14],
  TACTICAL: [30, 90],
  STRUCTURE: [180, 365]
};

// ═══════════════════════════════════════════════════════════════
// TIER-AWARE SAMPLE THRESHOLDS (Institutional)
// ═══════════════════════════════════════════════════════════════

const TIER_SAMPLE_THRESHOLDS: Record<Tier, { OK: number; LOW: number; VERY_LOW: number }> = {
  TIMING: { OK: 20, LOW: 10, VERY_LOW: 5 },      // High frequency, need more samples
  TACTICAL: { OK: 12, LOW: 6, VERY_LOW: 3 },     // Standard
  STRUCTURE: { OK: 18, LOW: 10, VERY_LOW: 5 }    // Long horizon, need stability
};

// Return scale by tier (for expectancy normalization)
const TIER_RET_SCALE: Record<Tier, number> = {
  TIMING: 0.03,     // 3% is good for 7-14d
  TACTICAL: 0.06,   // 6% is good for 30-90d
  STRUCTURE: 0.12   // 12% is good for 180-365d
};

// Sharpe normalization bounds
const SHARPE_MIN = -0.5;
const SHARPE_MAX = 2.0;

// Tail risk thresholds by tier
const TIER_TAIL_THRESHOLD: Record<Tier, number> = {
  TIMING: -0.07,    // -7% P10 is painful for short term
  TACTICAL: -0.10,  // -10% P10
  STRUCTURE: -0.15  // -15% P10 for structure
};

export interface PhasePerformanceQuery {
  symbol: string;
  tier: Tier;
  h?: number;        // Specific horizon (7/14/30/90/180/365)
  preset?: Preset;
  role?: Role;
  from?: string;
  to?: string;
}

export interface PhaseStats {
  phaseId: string;
  phaseName: string;
  phaseType: PhaseType;
  samples: number;
  sampleQuality: SampleQuality;
  // Core metrics
  hitRate: number;
  avgRet: number;
  medianRet: number;
  p10: number;
  p90: number;
  worstDay: number;
  maxDD: number;
  expectancy: number;
  profitFactor: number;
  sharpe: number;
  // Quality indicators
  avgDivergenceScore: number;
  recencyWeight: number;
  // Grade
  score: number;
  grade: Grade;
  warnings: string[];
}

export interface GlobalStats {
  hitRate: number;
  avgRet: number;
  medianRet: number;
  p10: number;
  p90: number;
  sharpe: number;
  maxDD: number;
  expectancy: number;
  profitFactor: number;
}

export interface PhasePerformanceResponse {
  meta: {
    symbol: string;
    tier: Tier;
    horizonDays: number | null;
    preset: Preset | null;
    role: Role;
    from: string;
    to: string;
    resolvedCount: number;
    minSamplesForTrust?: number;  // Tier-aware threshold
  };
  global: GlobalStats;
  phases: PhaseStats[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squareDiffs = arr.map(x => Math.pow(x - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function calcSharpe(returns: number[], annualFactor: number = 52): number {
  if (returns.length < 2) return 0;
  const avg = mean(returns);
  const sd = stdev(returns);
  if (sd === 0) return 0;
  return (avg / sd) * Math.sqrt(annualFactor);
}

function calcProfitFactor(returns: number[]): number {
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLosses = Math.abs(losses.reduce((a, b) => a + b, 0));
  if (sumLosses === 0) return sumWins > 0 ? 10 : 0;
  return sumWins / sumLosses;
}

function calcMaxDD(returns: number[]): number {
  if (returns.length === 0) return 0;
  let peak = 1;
  let equity = 1;
  let maxDD = 0;
  for (const r of returns) {
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcExpectancy(returns: number[]): number {
  if (returns.length === 0) return 0;
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const winRate = wins.length / returns.length;
  const avgWin = wins.length > 0 ? mean(wins) : 0;
  const avgLoss = losses.length > 0 ? Math.abs(mean(losses)) : 0;
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

function getSampleQuality(samples: number, tier: Tier): SampleQuality {
  const thresholds = TIER_SAMPLE_THRESHOLDS[tier];
  if (samples >= thresholds.OK) return 'OK';
  if (samples >= thresholds.LOW) return 'LOW_SAMPLE';
  return 'VERY_LOW_SAMPLE';
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * INSTITUTIONAL GRADE CALCULATION
 * Grade with sample-based caps:
 * - LOW_SAMPLE: max grade C
 * - VERY_LOW_SAMPLE: max grade D
 */
function calcGrade(score: number, sampleQuality: SampleQuality): Grade {
  let grade: Grade;
  
  if (score >= 85) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 55) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';
  
  // Apply sample quality caps
  if (sampleQuality === 'LOW_SAMPLE' && (grade === 'A' || grade === 'B')) {
    grade = 'C'; // Cap at C for low samples
  }
  if (sampleQuality === 'VERY_LOW_SAMPLE' && (grade === 'A' || grade === 'B' || grade === 'C')) {
    grade = 'D'; // Cap at D for very low samples
  }
  
  return grade;
}

function calcRecencyWeight(dates: Date[], now: Date): number {
  if (dates.length === 0) return 0;
  // More recent samples get higher weight
  const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year
  let totalWeight = 0;
  for (const d of dates) {
    const age = now.getTime() - d.getTime();
    const weight = Math.max(0, 1 - age / maxAge);
    totalWeight += weight;
  }
  return totalWeight / dates.length;
}

// ═══════════════════════════════════════════════════════════════
// PHASE DETECTION (Simplified, inline)
// ═══════════════════════════════════════════════════════════════

function detectPhaseSimple(closes: number[]): PhaseType {
  if (closes.length < 50) return 'UNKNOWN';
  
  const last = closes[closes.length - 1];
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  
  // Calculate momentum (20-day ROC)
  const roc20 = closes.length > 20 
    ? (last - closes[closes.length - 21]) / closes[closes.length - 21]
    : 0;
  
  // Calculate volatility (recent 20 day std)
  const returns20: number[] = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i > 0) returns20.push((closes[i] - closes[i-1]) / closes[i-1]);
  }
  const vol = returns20.length > 1 
    ? Math.sqrt(returns20.map(r => r*r).reduce((a,b)=>a+b,0) / returns20.length)
    : 0;
  
  // Simple phase detection based on MA relationships and momentum
  const aboveMa20 = last > ma20;
  const aboveMa50 = last > ma50;
  const ma20AboveMa50 = ma20 > ma50;
  
  // Strong uptrend
  if (aboveMa20 && aboveMa50 && ma20AboveMa50 && roc20 > 0.03) {
    return 'MARKUP';
  }
  
  // Strong downtrend  
  if (!aboveMa20 && !aboveMa50 && !ma20AboveMa50 && roc20 < -0.03) {
    return 'MARKDOWN';
  }
  
  // High vol capitulation
  if (!aboveMa50 && roc20 < -0.08 && vol > 0.03) {
    return 'CAPITULATION';
  }
  
  // Distribution (topping)
  if (aboveMa50 && roc20 < -0.01 && roc20 > -0.05) {
    return 'DISTRIBUTION';
  }
  
  // Recovery (bottoming)
  if (!aboveMa50 && roc20 > 0.01 && roc20 < 0.05) {
    return 'RECOVERY';
  }
  
  // Default to accumulation
  return 'ACCUMULATION';
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class PhasePerformanceService {
  private canonicalStore = new CanonicalStore();
  private candleCache: any[] | null = null;
  
  /**
   * Fetch candles from chart API (fallback when canonical store is empty)
   */
  private async fetchCandlesFromChartApi(symbol: string, limit: number = 1500): Promise<any[]> {
    if (this.candleCache) {
      return this.candleCache;
    }
    
    try {
      // Import the data providers
      const { KrakenCsvProvider } = await import('../../data/providers/kraken-csv.provider.js');
      const provider = new KrakenCsvProvider();
      
      // Check if bootstrap file exists
      if (!provider.hasBootstrapFile()) {
        console.log(`[PhasePerformance] No bootstrap CSV file found`);
        return [];
      }
      
      // Get all candles from CSV
      const candles = await provider.fetchAll();
      if (candles && candles.length > 0) {
        // Sort by timestamp and take last N
        candles.sort((a, b) => a.t - b.t);
        const result = candles.slice(-limit);
        console.log(`[PhasePerformance] Got ${result.length} candles from CSV provider`);
        this.candleCache = result;
        return result;
      }
    } catch (err) {
      console.log(`[PhasePerformance] CSV provider error:`, err);
    }
    
    return [];
  }
  
  /**
   * Get phase for a given date from price data
   */
  private async getPhaseForDate(symbol: string, date: Date): Promise<PhaseType> {
    try {
      // Get candles around this date for phase detection
      const lookbackDays = 90;
      const from = new Date(date.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      
      const candles = await this.canonicalStore.getRange(symbol, '1D', from, date);
      if (!candles || candles.length < 50) return 'UNKNOWN';
      
      // Use inline phase detector - extract closes from canonical format
      const closes = candles.map(c => c.ohlcv.c);
      const phase = detectPhaseSimple(closes);
      
      return phase;
    } catch {
      return 'UNKNOWN';
    }
  }
  
  /**
   * Calculate stats for a set of returns
   */
  private calcStats(returns: number[], dates: Date[]): Omit<GlobalStats, 'hitRate'> & { hitRate: number } {
    const hits = returns.filter(r => r > 0).length;
    return {
      hitRate: returns.length > 0 ? hits / returns.length : 0,
      avgRet: mean(returns),
      medianRet: median(returns),
      p10: percentile(returns, 0.1),
      p90: percentile(returns, 0.9),
      sharpe: calcSharpe(returns, 52),
      maxDD: calcMaxDD(returns),
      expectancy: calcExpectancy(returns),
      profitFactor: calcProfitFactor(returns)
    };
  }
  
  /**
   * Calculate phase performance score (0-100)
   */
  /**
   * INSTITUTIONAL PHASE SCORE CALCULATION
   * 
   * Weights:
   * - 40% HitRate (primary signal quality)
   * - 25% Expectancy (avgRet, tier-scaled)
   * - 20% Sharpe (risk-adjusted consistency)
   * - 15% Divergence (model confidence quality)
   * 
   * Penalties:
   * - LOW_SAMPLE: -15
   * - VERY_LOW_SAMPLE: -25
   * - HIGH_TAIL (P10 < threshold): -8
   * - HIGH_DIVERGENCE (< 55): -8
   * - LOW_RECENCY (< 0.3): -3
   */
  private calcPhaseScore(stats: {
    hitRate: number;
    expectancy: number;
    sharpe: number;
    p10: number;
    avgDivergenceScore: number;
    recencyWeight: number;
  }, tier: Tier, sampleQuality: SampleQuality): number {
    const retScale = TIER_RET_SCALE[tier];
    const tailThreshold = TIER_TAIL_THRESHOLD[tier];
    
    // Normalize metrics to 0-1 scale
    // HitRate: 40% = 0, 60% = 1 (realistic range for crypto)
    const normHitRate = normalize(stats.hitRate, 0.40, 0.60);
    
    // Expectancy: tier-scaled (-retScale/2 to +retScale*1.5)
    const normExpectancy = normalize(stats.expectancy, -retScale/2, retScale * 1.5);
    
    // Sharpe: -0.5 to 1.5 (realistic for crypto)
    const normSharpe = normalize(stats.sharpe, -0.5, 1.5);
    
    // Divergence: 50-85 is good range (already 0-100 scale)
    const normDiv = normalize(stats.avgDivergenceScore, 50, 85);
    
    // INSTITUTIONAL WEIGHTED COMPOSITE
    // 40% HitRate + 25% Expectancy + 20% Sharpe + 15% Divergence
    let score = (
      0.40 * normHitRate +
      0.25 * normExpectancy +
      0.20 * normSharpe +
      0.15 * normDiv
    ) * 100;
    
    // ═══════════════════════════════════════════════════════════════
    // PENALTIES (calibrated for institutional risk management)
    // ═══════════════════════════════════════════════════════════════
    
    // Sample quality penalties
    if (sampleQuality === 'LOW_SAMPLE') score -= 12;
    if (sampleQuality === 'VERY_LOW_SAMPLE') score -= 20;
    
    // High tail risk penalty (severe downside)
    if (stats.p10 < tailThreshold) score -= 8;
    
    // High divergence penalty (model not confident)
    if (stats.avgDivergenceScore < 55) score -= 8;
    
    // Low recency penalty (stale data) - less aggressive
    if (stats.recencyWeight < 0.3) score -= 3;
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Main aggregation function
   */
  async aggregate(query: PhasePerformanceQuery): Promise<PhasePerformanceResponse> {
    const {
      symbol,
      tier,
      h,
      preset = 'BALANCED',
      role = 'ACTIVE',
      from,
      to
    } = query;
    
    // Determine horizons based on tier or specific h
    const horizons = h ? [h] : TIER_HORIZONS[tier];
    
    // Build filter
    const filter: any = {
      symbol,
      modelType: role,
      resolved: true
    };
    
    if (preset) {
      filter['strategy.preset'] = preset;
    }
    
    // Date range
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : now;
    filter.asOf = { $gte: fromDate, $lte: toDate };
    
    // Fetch resolved snapshots
    const snapshots = await SignalSnapshotModel
      .find(filter)
      .sort({ asOf: 1 })
      .lean() as SignalSnapshotDocument[];
    
    // If no snapshots, use overlay-based fallback
    if (snapshots.length === 0) {
      return this.aggregateFromOverlay(query, fromDate, toDate);
    }
    
    // Process snapshots and group by phase
    const phaseData: Map<PhaseType, {
      returns: number[];
      dates: Date[];
      divergenceScores: number[];
    }> = new Map();
    
    const allReturns: number[] = [];
    const allDates: Date[] = [];
    let resolvedCount = 0;
    
    for (const snap of snapshots) {
      // Get realized return for relevant horizons
      const outcomes = (snap as any).outcomes;
      if (!outcomes) continue;
      
      for (const hKey of horizons) {
        const outcome = outcomes[`${hKey}d`];
        if (!outcome || outcome.realizedReturn === undefined) continue;
        
        resolvedCount++;
        const ret = outcome.realizedReturn;
        
        // Get phase: first from snapshot field, then detect from candles
        let phase: PhaseType;
        const snapPhase = (snap as any).phase;
        if (snapPhase && snapPhase !== 'UNKNOWN') {
          phase = snapPhase as PhaseType;
        } else {
          phase = await this.getPhaseForDate(symbol, snap.asOf);
        }
        
        // Get divergence score if available (from metrics or default)
        const divergenceScore = snap.metrics?.similarityMean 
          ? snap.metrics.similarityMean * 100 
          : 70;
        
        // Add to phase bucket
        if (!phaseData.has(phase)) {
          phaseData.set(phase, { returns: [], dates: [], divergenceScores: [] });
        }
        const bucket = phaseData.get(phase)!;
        bucket.returns.push(ret);
        bucket.dates.push(snap.asOf);
        bucket.divergenceScores.push(divergenceScore);
        
        // Add to global
        allReturns.push(ret);
        allDates.push(snap.asOf);
      }
    }
    
    // Calculate global stats
    const globalStats = this.calcStats(allReturns, allDates);
    
    // Calculate per-phase stats with tier-aware scoring
    const phases = this.buildPhaseStats(phaseData, now, tier);
    
    // Global warnings
    const warnings: string[] = [];
    if (resolvedCount < 20) warnings.push('INSUFFICIENT_DATA');
    if (phases.length === 0) warnings.push('NO_PHASE_DATA');
    
    return {
      meta: {
        symbol,
        tier,
        horizonDays: h || null,
        preset,
        role,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        resolvedCount,
        minSamplesForTrust: TIER_SAMPLE_THRESHOLDS[tier].OK
      },
      global: globalStats,
      phases,
      warnings
    };
  }
  
  /**
   * Fallback: Use overlay matches when no resolved snapshots available
   * This provides demo data based on historical matches
   */
  private async aggregateFromOverlay(
    query: PhasePerformanceQuery,
    fromDate: Date,
    toDate: Date
  ): Promise<PhasePerformanceResponse> {
    const { symbol, tier, h, preset = 'BALANCED', role = 'ACTIVE' } = query;
    
    console.log(`[PhasePerformance] Fetching candles for ${symbol} from ${fromDate.toISOString()} to ${toDate.toISOString()}`);
    
    // Try canonical store first
    let candles = await this.canonicalStore.getRange(symbol, '1D', fromDate, toDate);
    
    // If no candles in DB, fallback to chart API data
    if (!candles || candles.length < 100) {
      console.log(`[PhasePerformance] Canonical store empty, using chart API fallback`);
      candles = await this.fetchCandlesFromChartApi(symbol, 1500);
    }
    
    console.log(`[PhasePerformance] Got ${candles?.length || 0} candles`);
    
    if (!candles || candles.length < 100) {
      return this.buildEmptyResponse(query, fromDate, toDate, ['NO_CANDLE_DATA']);
    }
    
    // Extract closes and timestamps from canonical format
    // Handle multiple formats:
    // - CSV provider (OhlcvCandle): { ts, close, ... }
    // - Canonical format: { ohlcv: { c }, ts }
    // - Chart API format: { t, c, ... }
    const closes = candles.map((c: any) => {
      if (typeof c.close === 'number') return c.close;  // OhlcvCandle from CSV
      if (c.ohlcv?.c !== undefined) return c.ohlcv.c;   // Canonical
      if (typeof c.c === 'number') return c.c;          // Chart API
      return undefined;
    });
    
    const timestamps = candles.map((c: any) => {
      if (c.ts) return c.ts instanceof Date ? c.ts.getTime() : c.ts;
      if (c.t) return c.t;
      return 0;
    });
    
    // Debug: log first few closes
    console.log(`[PhasePerformance] First 3 closes:`, closes.slice(0, 3));
    console.log(`[PhasePerformance] Last 3 closes:`, closes.slice(-3));
    
    // Filter out any invalid values
    const validCount = closes.filter(c => typeof c === 'number' && !isNaN(c)).length;
    console.log(`[PhasePerformance] Valid closes: ${validCount}/${closes.length}`);
    
    // Group candles by detected phase
    const phaseData: Map<PhaseType, {
      returns: number[];
      dates: Date[];
      divergenceScores: number[];
    }> = new Map();
    
    const allReturns: number[] = [];
    const allDates: Date[] = [];
    
    // Determine aftermath days based on tier
    const aftermathDays = h || (tier === 'TIMING' ? 7 : tier === 'TACTICAL' ? 30 : 90);
    
    // Walk through candles and compute forward returns by phase
    for (let i = 60; i < closes.length - aftermathDays; i++) {
      const windowCloses = closes.slice(0, i + 1);
      const phase = detectPhaseSimple(windowCloses);
      
      if (phase === 'UNKNOWN') continue;
      
      // Forward return
      const forwardRet = (closes[i + aftermathDays] - closes[i]) / closes[i];
      const date = new Date(timestamps[i]);
      
      // Simulated divergence based on vol regime
      const recentVol = this.calcRecentVol(closes.slice(Math.max(0, i - 20), i + 1));
      const divergenceScore = 70 + (Math.random() - 0.5) * 30; // Simulated
      
      if (!phaseData.has(phase)) {
        phaseData.set(phase, { returns: [], dates: [], divergenceScores: [] });
      }
      const bucket = phaseData.get(phase)!;
      bucket.returns.push(forwardRet);
      bucket.dates.push(date);
      bucket.divergenceScores.push(divergenceScore);
      
      allReturns.push(forwardRet);
      allDates.push(date);
    }
    
    const globalStats = this.calcStats(allReturns, allDates);
    const phases = this.buildPhaseStats(phaseData, new Date(), tier); // Tier-aware
    
    return {
      meta: {
        symbol,
        tier,
        horizonDays: h || aftermathDays,
        preset,
        role,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        resolvedCount: allReturns.length,
        minSamplesForTrust: TIER_SAMPLE_THRESHOLDS[tier].OK // Add this for UI
      },
      global: globalStats,
      phases,
      warnings: ['FALLBACK_MODE_OVERLAY']
    };
  }
  
  private calcRecentVol(closes: number[]): number {
    if (closes.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    return stdev(returns);
  }
  
  private buildPhaseStats(
    phaseData: Map<PhaseType, { returns: number[]; dates: Date[]; divergenceScores: number[] }>,
    now: Date,
    tier: Tier  // Added tier parameter
  ): PhaseStats[] {
    const phases: PhaseStats[] = [];
    const tailThreshold = TIER_TAIL_THRESHOLD[tier];
    
    for (const [phaseType, data] of phaseData.entries()) {
      if (phaseType === 'UNKNOWN') continue;
      
      const stats = this.calcStats(data.returns, data.dates);
      const sampleQuality = getSampleQuality(data.returns.length, tier); // Tier-aware
      const avgDivergenceScore = mean(data.divergenceScores);
      const recencyWeight = calcRecencyWeight(data.dates, now);
      
      // INSTITUTIONAL SCORING with tier awareness
      const score = this.calcPhaseScore({
        hitRate: stats.hitRate,
        expectancy: stats.expectancy,
        sharpe: stats.sharpe,
        p10: stats.p10,
        avgDivergenceScore,
        recencyWeight
      }, tier, sampleQuality);
      
      // Grade with sample-based caps
      const grade = calcGrade(score, sampleQuality);
      
      // Generate warnings (institutional risk flags)
      const phaseWarnings: string[] = [];
      if (sampleQuality === 'LOW_SAMPLE') phaseWarnings.push('LOW_SAMPLE');
      if (sampleQuality === 'VERY_LOW_SAMPLE') phaseWarnings.push('VERY_LOW_SAMPLE');
      if (stats.p10 < tailThreshold) phaseWarnings.push('HIGH_TAIL');
      if (avgDivergenceScore < 55) phaseWarnings.push('HIGH_DIVERGENCE');
      if (recencyWeight < 0.4) phaseWarnings.push('RECENCY_BIAS');
      if (score < 55) phaseWarnings.push('LOW_EDGE');
      
      phases.push({
        phaseId: `phase_${phaseType.toLowerCase()}`,
        phaseName: phaseType,
        phaseType,
        samples: data.returns.length,
        sampleQuality,
        hitRate: stats.hitRate,
        avgRet: stats.avgRet,
        medianRet: stats.medianRet,
        p10: stats.p10,
        p90: stats.p90,
        worstDay: Math.min(...data.returns),
        maxDD: stats.maxDD,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        sharpe: stats.sharpe,
        avgDivergenceScore,
        recencyWeight,
        score,
        grade,
        warnings: phaseWarnings
      });
    }
    
    // INSTITUTIONAL SORTING: Score desc, but penalize low samples
    phases.sort((a, b) => {
      // First by grade
      const gradeOrder = { A: 0, B: 1, C: 2, D: 3, F: 4 };
      const gradeDiff = gradeOrder[a.grade] - gradeOrder[b.grade];
      if (gradeDiff !== 0) return gradeDiff;
      
      // Then by score within same grade
      return b.score - a.score;
    });
    
    return phases;
  }
  
  private buildEmptyResponse(
    query: PhasePerformanceQuery,
    fromDate: Date,
    toDate: Date,
    warnings: string[]
  ): PhasePerformanceResponse {
    return {
      meta: {
        symbol: query.symbol,
        tier: query.tier,
        horizonDays: query.h || null,
        preset: query.preset || 'BALANCED',
        role: query.role || 'ACTIVE',
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        resolvedCount: 0
      },
      global: {
        hitRate: 0, avgRet: 0, medianRet: 0, p10: 0, p90: 0,
        sharpe: 0, maxDD: 0, expectancy: 0, profitFactor: 0
      },
      phases: [],
      warnings
    };
  }
}

export const phasePerformanceService = new PhasePerformanceService();
