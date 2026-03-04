/**
 * Phase R10.B: MA Patterns Detector
 * Moving Average based patterns
 */

import { PatternResult } from '../utils/pattern_types.js';

export interface MAContext {
  candles: { c: number; o: number; h: number; l: number }[];
  features?: {
    ma?: {
      ma20?: number;
      ma50?: number;
      ma200?: number;
      slope20?: number;
      slope50?: number;
      slope200?: number;
      alignment?: string;
    };
    maPrev?: {
      ma20?: number;
      ma50?: number;
      alignment?: string;
    };
  };
}

function near(p: number, m: number, tol = 0.003): boolean {
  return Math.abs(p - m) / Math.max(1e-9, m) < tol;
}

export function detectMAPatterns(ctx: MAContext): PatternResult[] {
  const { ma20, ma50, ma200, slope20, slope50, alignment } = ctx.features?.ma ?? {};
  const prevMa = ctx.features?.maPrev;
  const candles = ctx.candles;
  
  if (!ma20 || !ma50) return [];
  
  const results: PatternResult[] = [];
  const last = candles[candles.length - 1];
  const len = candles.length;
  
  // MA Trend Stack changes
  if (prevMa?.alignment && alignment) {
    if (prevMa.alignment !== 'BULL' && alignment === 'BULL') {
      results.push({
        type: 'MA_TREND_STACK',
        direction: 'BULL',
        confidence: 0.72,
        startIndex: Math.max(0, len - 30),
        endIndex: len - 1,
        meta: { prevAlignment: prevMa.alignment, newAlignment: alignment },
      });
    }
    if (prevMa.alignment !== 'BEAR' && alignment === 'BEAR') {
      results.push({
        type: 'MA_TREND_STACK',
        direction: 'BEAR',
        confidence: 0.72,
        startIndex: Math.max(0, len - 30),
        endIndex: len - 1,
        meta: { prevAlignment: prevMa.alignment, newAlignment: alignment },
      });
    }
  }
  
  // Golden Cross / Death Cross
  if (prevMa?.ma20 != null && prevMa?.ma50 != null) {
    const prev20 = prevMa.ma20;
    const prev50 = prevMa.ma50;
    
    if (prev20 < prev50 && ma20 > ma50) {
      results.push({
        type: 'MA_GOLDEN_CROSS',
        direction: 'BULL',
        confidence: 0.78,
        startIndex: Math.max(0, len - 5),
        endIndex: len - 1,
        priceLevels: [ma20, ma50],
        meta: { crossType: 'golden' },
      });
    }
    
    if (prev20 > prev50 && ma20 < ma50) {
      results.push({
        type: 'MA_DEATH_CROSS',
        direction: 'BEAR',
        confidence: 0.78,
        startIndex: Math.max(0, len - 5),
        endIndex: len - 1,
        priceLevels: [ma20, ma50],
        meta: { crossType: 'death' },
      });
    }
  }
  
  // Pullbacks to MA
  if (alignment === 'BULL' && slope20 && slope20 > 0) {
    if (near(last.c, ma20) && last.c > last.o) {
      results.push({
        type: 'MA_PULLBACK_20',
        direction: 'BULL',
        confidence: 0.72,
        startIndex: Math.max(0, len - 6),
        endIndex: len - 1,
        priceLevels: [ma20],
        meta: { maType: 20 },
      });
    }
    if (near(last.c, ma50) && last.c > last.o) {
      results.push({
        type: 'MA_PULLBACK_50',
        direction: 'BULL',
        confidence: 0.70,
        startIndex: Math.max(0, len - 10),
        endIndex: len - 1,
        priceLevels: [ma50],
        meta: { maType: 50 },
      });
    }
  }
  
  if (alignment === 'BEAR' && slope20 && slope20 < 0) {
    if (near(last.c, ma20) && last.c < last.o) {
      results.push({
        type: 'MA_PULLBACK_20',
        direction: 'BEAR',
        confidence: 0.72,
        startIndex: Math.max(0, len - 6),
        endIndex: len - 1,
        priceLevels: [ma20],
        meta: { maType: 20 },
      });
    }
    if (near(last.c, ma50) && last.c < last.o) {
      results.push({
        type: 'MA_PULLBACK_50',
        direction: 'BEAR',
        confidence: 0.70,
        startIndex: Math.max(0, len - 10),
        endIndex: len - 1,
        priceLevels: [ma50],
        meta: { maType: 50 },
      });
    }
  }
  
  return results;
}

export function runMADetectors(ctx: MAContext): PatternResult[] {
  return detectMAPatterns(ctx);
}
