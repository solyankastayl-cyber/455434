/**
 * SPX TERMINAL — Core Engine
 * 
 * BLOCK B5 — SPX Fractal Core Clone
 * 
 * This is a simplified clone of BTC Fractal Engine adapted for SPX.
 * Implements: horizons, phase detection, match selection, divergence, consensus.
 * 
 * ISOLATION: This module does NOT import from /modules/btc/ or /modules/fractal/
 */

import { SpxCandleModel } from '../spx/spx.mongo.js';
import type { SpxCandle, SpxCohort } from '../spx/spx.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SpxHorizonConfig {
  key: string;
  days: number;
  weight: number;
  tier: 1 | 2 | 3;
}

export const SPX_HORIZONS: SpxHorizonConfig[] = [
  { key: '7d', days: 7, weight: 0.05, tier: 3 },
  { key: '14d', days: 14, weight: 0.10, tier: 3 },
  { key: '30d', days: 30, weight: 0.20, tier: 2 },
  { key: '90d', days: 90, weight: 0.25, tier: 1 },
  { key: '180d', days: 180, weight: 0.25, tier: 1 },
  { key: '365d', days: 365, weight: 0.15, tier: 1 },
];

export type SpxPhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'NEUTRAL';

export interface SpxMatch {
  id: string;
  startDate: string;
  endDate: string;
  similarity: number;
  phase: SpxPhase;
  outcome: number; // % return after match
  cohort: SpxCohort;
}

export interface SpxHorizonResult {
  horizon: string;
  days: number;
  tier: number;
  weight: number;
  phase: SpxPhase;
  matches: SpxMatch[];
  primaryMatch: SpxMatch | null;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  divergence: number;
}

export interface SpxConsensus {
  direction: 'BUY' | 'SELL' | 'HOLD';
  score: number; // -100 to +100
  confidence: number; // 0-100
  structuralLock: boolean;
  dominantPhase: SpxPhase;
  tierBreakdown: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
}

export interface SpxTerminalPayload {
  meta: {
    symbol: 'SPX';
    asof: string;
    status: string;
    version: string;
  };
  price: {
    current: number;
    sma50: number;
    sma200: number;
    change1d: number;
    change7d: number;
    change30d: number;
  };
  phase: {
    current: SpxPhase;
    strength: number;
    duration: number; // days in current phase
  };
  horizons: SpxHorizonResult[];
  consensus: SpxConsensus;
  volatility: {
    regime: 'LOW' | 'NORMAL' | 'HIGH' | 'CRISIS';
    atr14: number;
    historicalPct: number; // percentile vs history
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA ADAPTER
// ═══════════════════════════════════════════════════════════════

export async function getSpxCandles(days: number, endDate?: Date): Promise<SpxCandle[]> {
  const end = endDate || new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  
  return await SpxCandleModel.find({
    ts: { $gte: start.getTime(), $lte: end.getTime() }
  })
  .sort({ ts: 1 })
  .lean();
}

export async function getAllSpxCandles(): Promise<SpxCandle[]> {
  return await SpxCandleModel.find({})
    .sort({ ts: 1 })
    .lean();
}

export async function getLatestSpxPrice(): Promise<{ price: number; date: string; candle: SpxCandle } | null> {
  const latest = await SpxCandleModel.findOne({}).sort({ ts: -1 }).lean();
  if (!latest) return null;
  return {
    price: latest.close,
    date: latest.date,
    candle: latest,
  };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE EXTRACTION
// ═══════════════════════════════════════════════════════════════

function normalizeWindow(candles: SpxCandle[]): number[] {
  if (candles.length < 2) return [];
  
  const closes = candles.map(c => c.close);
  const first = closes[0];
  
  // Normalize to returns from start
  return closes.map(c => (c - first) / first * 100);
}

function computeSMA(candles: SpxCandle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

function computeATR(candles: SpxCandle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }
  
  const recentTRs = trs.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
}

// ═══════════════════════════════════════════════════════════════
// PHASE DETECTION
// ═══════════════════════════════════════════════════════════════

export function detectPhase(candles: SpxCandle[]): { phase: SpxPhase; strength: number } {
  if (candles.length < 50) {
    return { phase: 'NEUTRAL', strength: 0.5 };
  }
  
  const current = candles[candles.length - 1].close;
  const sma50 = computeSMA(candles, 50);
  const sma200 = computeSMA(candles, Math.min(200, candles.length));
  
  // Calculate momentum (rate of change)
  const lookback = Math.min(20, candles.length);
  const startPrice = candles[candles.length - lookback].close;
  const momentum = (current - startPrice) / startPrice;
  
  // Phase detection logic
  let phase: SpxPhase;
  let strength: number;
  
  if (current > sma50 && current > sma200 && momentum > 0.02) {
    phase = 'MARKUP';
    strength = Math.min(1, 0.5 + momentum * 5);
  } else if (current < sma50 && current < sma200 && momentum < -0.02) {
    phase = 'MARKDOWN';
    strength = Math.min(1, 0.5 + Math.abs(momentum) * 5);
  } else if (current > sma200 && momentum < 0.01 && momentum > -0.01) {
    phase = 'DISTRIBUTION';
    strength = 0.6;
  } else if (current < sma200 && momentum < 0.01 && momentum > -0.01) {
    phase = 'ACCUMULATION';
    strength = 0.6;
  } else {
    phase = 'NEUTRAL';
    strength = 0.5;
  }
  
  return { phase, strength };
}

// ═══════════════════════════════════════════════════════════════
// SIMILARITY ENGINE
// ═══════════════════════════════════════════════════════════════

function computeSimilarity(windowA: number[], windowB: number[]): number {
  if (windowA.length !== windowB.length || windowA.length === 0) return 0;
  
  // Pearson correlation
  const n = windowA.length;
  const meanA = windowA.reduce((a, b) => a + b, 0) / n;
  const meanB = windowB.reduce((a, b) => a + b, 0) / n;
  
  let num = 0;
  let denA = 0;
  let denB = 0;
  
  for (let i = 0; i < n; i++) {
    const diffA = windowA[i] - meanA;
    const diffB = windowB[i] - meanB;
    num += diffA * diffB;
    denA += diffA * diffA;
    denB += diffB * diffB;
  }
  
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  
  const correlation = num / den;
  
  // Convert to similarity score (0-100)
  return Math.max(0, Math.min(100, (correlation + 1) * 50));
}

// ═══════════════════════════════════════════════════════════════
// MATCH FINDER
// ═══════════════════════════════════════════════════════════════

async function findMatches(
  currentWindow: number[],
  horizonDays: number,
  allCandles: SpxCandle[],
  maxMatches: number = 20
): Promise<SpxMatch[]> {
  if (currentWindow.length === 0 || allCandles.length < horizonDays * 2) {
    return [];
  }
  
  const matches: SpxMatch[] = [];
  const aftermathDays = horizonDays; // Look forward same days
  
  // Skip last N days (current window + aftermath)
  const searchEnd = allCandles.length - horizonDays - aftermathDays;
  
  for (let i = horizonDays; i < searchEnd; i++) {
    const windowCandles = allCandles.slice(i - horizonDays, i);
    const historicalWindow = normalizeWindow(windowCandles);
    
    if (historicalWindow.length !== currentWindow.length) continue;
    
    const similarity = computeSimilarity(currentWindow, historicalWindow);
    
    if (similarity > 60) { // Threshold
      // Calculate aftermath outcome
      const startPrice = allCandles[i].close;
      const endIdx = Math.min(i + aftermathDays, allCandles.length - 1);
      const endPrice = allCandles[endIdx].close;
      const outcome = ((endPrice - startPrice) / startPrice) * 100;
      
      const phaseResult = detectPhase(windowCandles);
      
      matches.push({
        id: `spx_${allCandles[i].date}_${horizonDays}d`,
        startDate: windowCandles[0].date,
        endDate: windowCandles[windowCandles.length - 1].date,
        similarity,
        phase: phaseResult.phase,
        outcome,
        cohort: allCandles[i].cohort,
      });
    }
  }
  
  // Sort by similarity and take top N
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, maxMatches);
}

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeDivergence(matches: SpxMatch[]): number {
  if (matches.length < 2) return 0;
  
  // Divergence = variance in outcomes
  const outcomes = matches.map(m => m.outcome);
  const mean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
  const variance = outcomes.reduce((sum, o) => sum + (o - mean) ** 2, 0) / outcomes.length;
  
  // Normalize to 0-100 scale
  return Math.min(100, Math.sqrt(variance) * 10);
}

// ═══════════════════════════════════════════════════════════════
// CONSENSUS ENGINE
// ═══════════════════════════════════════════════════════════════

function computeConsensus(horizonResults: SpxHorizonResult[]): SpxConsensus {
  if (horizonResults.length === 0) {
    return {
      direction: 'HOLD',
      score: 0,
      confidence: 0,
      structuralLock: false,
      dominantPhase: 'NEUTRAL',
      tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 },
    };
  }
  
  // Weighted score calculation
  let totalWeight = 0;
  let weightedScore = 0;
  let weightedConfidence = 0;
  
  const tierScores = { tier1: 0, tier2: 0, tier3: 0 };
  const tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
  const phaseCounts: Record<SpxPhase, number> = {
    ACCUMULATION: 0,
    MARKUP: 0,
    DISTRIBUTION: 0,
    MARKDOWN: 0,
    NEUTRAL: 0,
  };
  
  for (const hr of horizonResults) {
    const dirScore = hr.direction === 'BULLISH' ? 1 : hr.direction === 'BEARISH' ? -1 : 0;
    const score = dirScore * hr.confidence;
    
    weightedScore += score * hr.weight;
    weightedConfidence += hr.confidence * hr.weight;
    totalWeight += hr.weight;
    
    // Tier breakdown
    const tierKey = `tier${hr.tier}` as keyof typeof tierScores;
    tierScores[tierKey] += score;
    tierCounts[tierKey] += 1;
    
    // Phase counting
    phaseCounts[hr.phase] += 1;
  }
  
  const finalScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  const finalConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;
  
  // Direction from score
  let direction: 'BUY' | 'SELL' | 'HOLD';
  if (finalScore > 20) direction = 'BUY';
  else if (finalScore < -20) direction = 'SELL';
  else direction = 'HOLD';
  
  // Structural lock if Tier 1 horizons disagree significantly
  const tier1Avg = tierCounts.tier1 > 0 ? tierScores.tier1 / tierCounts.tier1 : 0;
  const structuralLock = Math.abs(tier1Avg) < 0.3 && tierCounts.tier1 >= 2;
  
  // Dominant phase
  const dominantPhase = (Object.entries(phaseCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'NEUTRAL') as SpxPhase;
  
  return {
    direction,
    score: Math.round(finalScore),
    confidence: Math.round(finalConfidence),
    structuralLock,
    dominantPhase,
    tierBreakdown: {
      tier1: tierCounts.tier1 > 0 ? Math.round(tierScores.tier1 / tierCounts.tier1 * 100) : 0,
      tier2: tierCounts.tier2 > 0 ? Math.round(tierScores.tier2 / tierCounts.tier2 * 100) : 0,
      tier3: tierCounts.tier3 > 0 ? Math.round(tierScores.tier3 / tierCounts.tier3 * 100) : 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY REGIME
// ═══════════════════════════════════════════════════════════════

function detectVolatilityRegime(candles: SpxCandle[]): {
  regime: 'LOW' | 'NORMAL' | 'HIGH' | 'CRISIS';
  atr14: number;
  historicalPct: number;
} {
  if (candles.length < 200) {
    const atr = computeATR(candles, Math.min(14, candles.length - 1));
    return { regime: 'NORMAL', atr14: atr, historicalPct: 50 };
  }
  
  const currentATR = computeATR(candles.slice(-30), 14);
  
  // Calculate historical ATRs
  const historicalATRs: number[] = [];
  for (let i = 200; i < candles.length - 30; i += 30) {
    const slice = candles.slice(i - 30, i);
    historicalATRs.push(computeATR(slice, 14));
  }
  
  if (historicalATRs.length === 0) {
    return { regime: 'NORMAL', atr14: currentATR, historicalPct: 50 };
  }
  
  // Percentile
  historicalATRs.sort((a, b) => a - b);
  let pct = 0;
  for (let i = 0; i < historicalATRs.length; i++) {
    if (currentATR <= historicalATRs[i]) {
      pct = (i / historicalATRs.length) * 100;
      break;
    }
    pct = 100;
  }
  
  // Regime classification
  let regime: 'LOW' | 'NORMAL' | 'HIGH' | 'CRISIS';
  if (pct < 25) regime = 'LOW';
  else if (pct < 75) regime = 'NORMAL';
  else if (pct < 95) regime = 'HIGH';
  else regime = 'CRISIS';
  
  return {
    regime,
    atr14: currentATR,
    historicalPct: Math.round(pct),
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN TERMINAL BUILDER
// ═══════════════════════════════════════════════════════════════

export async function buildSpxTerminal(): Promise<SpxTerminalPayload> {
  // Get all candles
  const allCandles = await getAllSpxCandles();
  
  if (allCandles.length < 100) {
    throw new Error('Insufficient SPX data for terminal (need at least 100 candles)');
  }
  
  // Latest price info
  const latest = allCandles[allCandles.length - 1];
  const sma50 = computeSMA(allCandles, 50);
  const sma200 = computeSMA(allCandles, Math.min(200, allCandles.length));
  
  // Price changes
  const price1dAgo = allCandles.length > 1 ? allCandles[allCandles.length - 2].close : latest.close;
  const price7dAgo = allCandles.length > 7 ? allCandles[allCandles.length - 8].close : latest.close;
  const price30dAgo = allCandles.length > 30 ? allCandles[allCandles.length - 31].close : latest.close;
  
  const change1d = ((latest.close - price1dAgo) / price1dAgo) * 100;
  const change7d = ((latest.close - price7dAgo) / price7dAgo) * 100;
  const change30d = ((latest.close - price30dAgo) / price30dAgo) * 100;
  
  // Current phase
  const phaseResult = detectPhase(allCandles.slice(-200));
  
  // Calculate phase duration (how long in current phase)
  let phaseDuration = 0;
  const currentPhase = phaseResult.phase;
  for (let i = allCandles.length - 1; i >= Math.max(0, allCandles.length - 100); i--) {
    const slice = allCandles.slice(Math.max(0, i - 50), i + 1);
    const p = detectPhase(slice);
    if (p.phase === currentPhase) {
      phaseDuration++;
    } else {
      break;
    }
  }
  
  // Process each horizon
  const horizonResults: SpxHorizonResult[] = [];
  
  for (const horizon of SPX_HORIZONS) {
    if (allCandles.length < horizon.days * 2) continue;
    
    // Get current window
    const windowCandles = allCandles.slice(-horizon.days);
    const currentWindow = normalizeWindow(windowCandles);
    
    // Find matches
    const matches = await findMatches(currentWindow, horizon.days, allCandles, 20);
    
    // Primary match
    const primaryMatch = matches.length > 0 ? matches[0] : null;
    
    // Window phase
    const windowPhase = detectPhase(windowCandles);
    
    // Direction from matches
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (matches.length === 0) {
      direction = 'NEUTRAL';
    } else {
      const avgOutcome = matches.reduce((sum, m) => sum + m.outcome, 0) / matches.length;
      direction = avgOutcome > 1 ? 'BULLISH' : avgOutcome < -1 ? 'BEARISH' : 'NEUTRAL';
    }
    
    // Confidence based on match quality
    const confidence = matches.length > 0
      ? Math.min(100, matches.slice(0, 5).reduce((sum, m) => sum + m.similarity, 0) / 5)
      : 0;
    
    // Divergence
    const divergence = computeDivergence(matches);
    
    horizonResults.push({
      horizon: horizon.key,
      days: horizon.days,
      tier: horizon.tier,
      weight: horizon.weight,
      phase: windowPhase.phase,
      matches,
      primaryMatch,
      direction,
      confidence,
      divergence,
    });
  }
  
  // Consensus
  const consensus = computeConsensus(horizonResults);
  
  // Volatility regime
  const volatility = detectVolatilityRegime(allCandles);
  
  return {
    meta: {
      symbol: 'SPX',
      asof: latest.date,
      status: 'BUILDING',
      version: 'SPX_V2.1.0',
    },
    price: {
      current: latest.close,
      sma50,
      sma200,
      change1d: Math.round(change1d * 100) / 100,
      change7d: Math.round(change7d * 100) / 100,
      change30d: Math.round(change30d * 100) / 100,
    },
    phase: {
      current: phaseResult.phase,
      strength: Math.round(phaseResult.strength * 100) / 100,
      duration: phaseDuration,
    },
    horizons: horizonResults,
    consensus,
    volatility,
  };
}
