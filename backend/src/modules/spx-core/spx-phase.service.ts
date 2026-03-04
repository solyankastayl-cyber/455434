/**
 * SPX CORE — Phase Detection
 * 
 * BLOCK B5.2 — Market Phase Classification for SPX
 * 
 * Detects market phases: ACCUMULATION, MARKUP, DISTRIBUTION, MARKDOWN, NEUTRAL
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import type { SpxCandle } from './spx-candles.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SpxPhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'NEUTRAL';

export interface SpxPhaseResult {
  phase: SpxPhase;
  strength: number;      // 0-1 confidence in phase
  momentum: number;      // Rate of change
  priceVsSma50: number;  // % above/below SMA50
  priceVsSma200: number; // % above/below SMA200
  trendStrength: number; // 0-1 trend strength
}

// ═══════════════════════════════════════════════════════════════
// PHASE DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect market phase from SPX candles
 */
export function detectPhase(candles: SpxCandle[]): SpxPhaseResult {
  if (candles.length < 50) {
    return {
      phase: 'NEUTRAL',
      strength: 0.5,
      momentum: 0,
      priceVsSma50: 0,
      priceVsSma200: 0,
      trendStrength: 0,
    };
  }
  
  const closes = candles.map(c => c.c);
  const current = closes[closes.length - 1];
  
  // Calculate SMAs
  const sma50 = computeSMA(closes, 50);
  const sma200 = computeSMA(closes, Math.min(200, closes.length));
  
  // Calculate momentum (20-day rate of change)
  const lookback = Math.min(20, closes.length - 1);
  const startPrice = closes[closes.length - 1 - lookback];
  const momentum = (current - startPrice) / startPrice;
  
  // Price relative to SMAs
  const priceVsSma50 = (current - sma50) / sma50;
  const priceVsSma200 = (current - sma200) / sma200;
  
  // Calculate trend strength
  const trendStrength = calculateTrendStrength(closes);
  
  // Phase classification
  let phase: SpxPhase;
  let strength: number;
  
  if (current > sma50 && current > sma200 && momentum > 0.02) {
    // Strong uptrend
    phase = 'MARKUP';
    strength = Math.min(1, 0.5 + momentum * 5);
  } else if (current < sma50 && current < sma200 && momentum < -0.02) {
    // Strong downtrend
    phase = 'MARKDOWN';
    strength = Math.min(1, 0.5 + Math.abs(momentum) * 5);
  } else if (current > sma200 && priceVsSma50 > -0.02 && momentum < 0.01 && momentum > -0.01) {
    // Topping formation
    phase = 'DISTRIBUTION';
    strength = 0.6;
  } else if (current < sma200 && priceVsSma50 < 0.02 && momentum < 0.01 && momentum > -0.01) {
    // Bottoming formation
    phase = 'ACCUMULATION';
    strength = 0.6;
  } else if (current > sma50 && current < sma200 && momentum > 0) {
    // Recovery
    phase = 'ACCUMULATION';
    strength = 0.5 + momentum * 3;
  } else if (current < sma50 && current > sma200 && momentum < 0) {
    // Early weakness
    phase = 'DISTRIBUTION';
    strength = 0.5 + Math.abs(momentum) * 3;
  } else {
    // Unclear
    phase = 'NEUTRAL';
    strength = 0.5;
  }
  
  return {
    phase,
    strength: Math.min(1, Math.max(0, strength)),
    momentum: Math.round(momentum * 10000) / 100, // As %
    priceVsSma50: Math.round(priceVsSma50 * 10000) / 100,
    priceVsSma200: Math.round(priceVsSma200 * 10000) / 100,
    trendStrength,
  };
}

/**
 * Detect phase from price closes array
 */
export function detectPhaseFromCloses(closes: number[]): SpxPhaseResult {
  const candles: SpxCandle[] = closes.map((c, i) => ({
    t: Date.now() - (closes.length - i) * 86400000,
    o: c,
    h: c,
    l: c,
    c: c,
    date: '',
    cohort: 'LIVE',
  }));
  
  return detectPhase(candles);
}

/**
 * Get phase at specific index in history
 */
export function detectPhaseAtIndex(closes: number[], index: number): SpxPhase {
  if (index < 50) return 'NEUTRAL';
  
  const windowCloses = closes.slice(Math.max(0, index - 200), index + 1);
  const result = detectPhaseFromCloses(windowCloses);
  
  return result.phase;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function computeSMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices.length > 0 ? prices[prices.length - 1] : 0;
  }
  
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

function calculateTrendStrength(closes: number[]): number {
  if (closes.length < 20) return 0;
  
  // Use linear regression slope normalized
  const n = Math.min(50, closes.length);
  const prices = closes.slice(-n);
  
  // Calculate slope
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgPrice = sumY / n;
  
  // Normalize slope to 0-1
  const normalizedSlope = Math.abs(slope / avgPrice) * 100;
  
  return Math.min(1, normalizedSlope);
}

export default {
  detectPhase,
  detectPhaseFromCloses,
  detectPhaseAtIndex,
};
