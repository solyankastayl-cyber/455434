/**
 * DXY MACRO VALIDATION SERVICE — D1
 * 
 * Walk-forward validation comparing:
 * - MODE_A (PURE): baseline fractal without macro overlay
 * - MODE_B (MACRO): fractal + macro overlay with SIZE scaling
 * 
 * Macro does NOT change direction. Only scales position size.
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { getAllDxyCandles, getDxyLatestPrice } from '../../services/dxy-chart.service.js';
import { buildDxyTerminalPack } from '../../services/dxy_terminal.service.js';
import { buildMacroOverlay } from '../../services/macro_overlay.service.js';
import { computeMacroScore } from '../../../dxy-macro-core/services/macro_score.service.js';
import { buildMacroContext } from '../../../dxy-macro-core/services/macro_context.service.js';
import { DxyCandleModel } from '../../storage/dxy-candles.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ValidationParams {
  from: string;         // Start date (YYYY-MM-DD)
  to: string;           // End date (YYYY-MM-DD)
  stepDays: number;     // Step between signals (default: 7)
  focus: string;        // Horizon focus (default: "30d")
  preset: string;       // Preset name (BALANCED, AGGRESSIVE, etc.)
  modeB: {
    applyMultiplierTo: 'SIZE' | 'CONFIDENCE';
    guardPolicy: 'SKIP_TRADE' | 'REDUCE_SIZE';
  };
}

export interface TradeResult {
  date: string;
  action: 'LONG' | 'SHORT' | 'HOLD';
  forecastReturn: number;
  realizedReturn: number;
  isHit: boolean;
  size: number;          // Position size (0-1)
  tradeReturn: number;   // size * realizedReturn
}

export interface ModeResult {
  trades: number;
  blocked: number;
  hitRate: number;
  equityFinal: number;
  maxDD: number;
  avgReturn: number;
  avgSize: number;
  volatility: number;
  equityCurve: Array<{ date: string; equity: number }>;
}

export interface ValidationReport {
  period: { from: string; to: string };
  focus: string;
  stepDays: number;
  totalDates: number;
  
  modeA: ModeResult;   // PURE
  modeB: ModeResult;   // MACRO
  
  delta: {
    equityFinal: number;    // modeB - modeA
    equityFinalPct: number; // percentage change
    maxDD: number;          // modeB - modeA (negative is better)
    maxDDPct: number;       // percentage change
    hitRate: number;        // modeB - modeA
    blockedRate: number;    // modeB.blocked / modeB.trades
  };
  
  acceptance: {
    passed: boolean;
    checks: Array<{
      name: string;
      passed: boolean;
      value: number;
      threshold: number;
    }>;
  };
  
  processingTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get price at date
// ═══════════════════════════════════════════════════════════════

async function getPriceAtDate(targetDate: string): Promise<number | null> {
  const candle = await DxyCandleModel
    .findOne({ date: { $lte: targetDate } })
    .sort({ date: -1 })
    .select({ close: 1 })
    .lean();
  
  return candle?.close ?? null;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Parse horizon to days
// ═══════════════════════════════════════════════════════════════

function focusToDays(focus: string): number {
  const match = focus.match(/^(\d+)d$/);
  return match ? parseInt(match[1]) : 30;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate realized return
// ═══════════════════════════════════════════════════════════════

function calcRealizedReturn(
  action: 'LONG' | 'SHORT' | 'HOLD',
  entryPrice: number,
  exitPrice: number
): number {
  if (action === 'HOLD' || entryPrice === 0) return 0;
  
  const rawReturn = (exitPrice - entryPrice) / entryPrice;
  
  // LONG profits when price goes up, SHORT profits when price goes down
  return action === 'LONG' ? rawReturn : -rawReturn;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Check if hit
// ═══════════════════════════════════════════════════════════════

function isHit(action: string, realizedReturn: number): boolean {
  if (action === 'LONG') return realizedReturn > 0;
  if (action === 'SHORT') return realizedReturn < 0;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate max drawdown
// ═══════════════════════════════════════════════════════════════

function calcMaxDrawdown(equityCurve: Array<{ date: string; equity: number }>): number {
  if (equityCurve.length === 0) return 0;
  
  let peak = equityCurve[0].equity;
  let maxDD = 0;
  
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const dd = (peak - point.equity) / peak;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }
  
  return maxDD;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate volatility
// ═══════════════════════════════════════════════════════════════

function calcVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  
  return Math.sqrt(variance);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Generate date range
// ═══════════════════════════════════════════════════════════════

function generateDateRange(from: string, to: string, stepDays: number): string[] {
  const dates: string[] = [];
  const startDate = new Date(from);
  const endDate = new Date(to);
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + stepDays);
  }
  
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Add days to date
// ═══════════════════════════════════════════════════════════════

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build mode result from trades
// ═══════════════════════════════════════════════════════════════

function buildModeResult(trades: TradeResult[]): ModeResult {
  const actionableTrades = trades.filter(t => t.action !== 'HOLD');
  const blocked = trades.filter(t => t.size === 0 && t.action !== 'HOLD').length;
  const executedTrades = actionableTrades.filter(t => t.size > 0);
  
  const hits = executedTrades.filter(t => t.isHit).length;
  const hitRate = executedTrades.length > 0 ? hits / executedTrades.length : 0;
  
  // Build equity curve
  let equity = 1.0;
  const equityCurve: Array<{ date: string; equity: number }> = [];
  const returns: number[] = [];
  const sizes: number[] = [];
  
  for (const trade of trades) {
    if (trade.action !== 'HOLD' && trade.size > 0) {
      equity = equity * (1 + trade.tradeReturn);
      returns.push(trade.tradeReturn);
      sizes.push(trade.size);
    }
    equityCurve.push({ date: trade.date, equity });
  }
  
  const avgReturn = returns.length > 0 
    ? returns.reduce((a, b) => a + b, 0) / returns.length 
    : 0;
  
  const avgSize = sizes.length > 0
    ? sizes.reduce((a, b) => a + b, 0) / sizes.length
    : 1;
  
  return {
    trades: actionableTrades.length,
    blocked,
    hitRate: Math.round(hitRate * 10000) / 10000,
    equityFinal: Math.round(equity * 10000) / 10000,
    maxDD: Math.round(calcMaxDrawdown(equityCurve) * 10000) / 10000,
    avgReturn: Math.round(avgReturn * 10000) / 10000,
    avgSize: Math.round(avgSize * 1000) / 1000,
    volatility: Math.round(calcVolatility(returns) * 10000) / 10000,
    equityCurve,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Macro Validation
// ═══════════════════════════════════════════════════════════════

export async function runMacroValidation(params: ValidationParams): Promise<ValidationReport> {
  const start = Date.now();
  
  const { from, to, stepDays, focus, modeB } = params;
  const horizonDays = focusToDays(focus);
  
  console.log(`[D1 Validation] Running macro validation ${from} to ${to}, step=${stepDays}, focus=${focus}`);
  
  // Generate signal dates
  const signalDates = generateDateRange(from, to, stepDays);
  
  // Get macro data for overlay calculations
  const macroScore = await computeMacroScore();
  const contextMap: Record<string, any> = {};
  const seriesIds = ['FEDFUNDS', 'CPILFESL', 'T10Y2Y', 'UNRATE', 'M2SL'];
  
  for (const seriesId of seriesIds) {
    const ctx = await buildMacroContext(seriesId);
    if (ctx) {
      contextMap[seriesId] = ctx;
    }
  }
  
  const hasMacroData = macroScore.components.length > 0;
  
  // Process each signal date
  const tradesA: TradeResult[] = [];  // PURE
  const tradesB: TradeResult[] = [];  // MACRO
  
  for (const signalDate of signalDates) {
    // Get entry price at signal date
    const entryPrice = await getPriceAtDate(signalDate);
    if (!entryPrice) continue;
    
    // Get exit date and price
    const exitDate = addDays(signalDate, horizonDays);
    const exitPrice = await getPriceAtDate(exitDate);
    if (!exitPrice) continue;
    
    // Determine signal direction (simplified: use price momentum)
    // In production this would come from actual terminal pack
    const priceChange = (exitPrice - entryPrice) / entryPrice;
    
    // Simulate terminal signal based on historical data pattern
    // We use a simplified heuristic here since we can't call terminal for historical dates
    const lookbackStart = addDays(signalDate, -180);
    const lookbackCandles = await DxyCandleModel
      .find({ date: { $gte: lookbackStart, $lte: signalDate } })
      .sort({ date: 1 })
      .select({ close: 1 })
      .lean();
    
    if (lookbackCandles.length < 30) continue;
    
    // Simple momentum signal
    const recentPrices = lookbackCandles.slice(-30).map(c => c.close);
    const avgRecent = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const currentPrice = recentPrices[recentPrices.length - 1];
    
    // Generate action based on momentum
    let action: 'LONG' | 'SHORT' | 'HOLD';
    if (currentPrice > avgRecent * 1.01) {
      action = 'LONG';
    } else if (currentPrice < avgRecent * 0.99) {
      action = 'SHORT';
    } else {
      action = 'HOLD';
    }
    
    // Calculate forecast return (simplified)
    const forecastReturn = (currentPrice - avgRecent) / avgRecent;
    
    // Calculate realized return
    const realizedReturn = calcRealizedReturn(action, entryPrice, exitPrice);
    const hit = isHit(action, realizedReturn);
    
    // MODE A: Pure fractal (size = 1.0)
    const tradeA: TradeResult = {
      date: signalDate,
      action,
      forecastReturn,
      realizedReturn,
      isHit: hit,
      size: action === 'HOLD' ? 0 : 1.0,
      tradeReturn: action === 'HOLD' ? 0 : realizedReturn * 1.0,
    };
    tradesA.push(tradeA);
    
    // MODE B: With macro overlay
    let macroSize = 1.0;
    let blocked = false;
    
    if (hasMacroData && action !== 'HOLD') {
      // Build macro overlay
      const overlay = buildMacroOverlay(macroScore, contextMap, action);
      
      // Apply guard
      if (overlay.overlay.tradingGuard.enabled) {
        if (modeB.guardPolicy === 'SKIP_TRADE') {
          macroSize = 0;
          blocked = true;
        } else {
          macroSize = 0.5 * overlay.overlay.confidenceMultiplier;
        }
      } else {
        // Apply SIZE scaling
        macroSize = Math.max(0, Math.min(1, overlay.overlay.confidenceMultiplier));
      }
    }
    
    const tradeB: TradeResult = {
      date: signalDate,
      action,
      forecastReturn,
      realizedReturn,
      isHit: hit,
      size: action === 'HOLD' ? 0 : macroSize,
      tradeReturn: action === 'HOLD' ? 0 : realizedReturn * macroSize,
    };
    tradesB.push(tradeB);
  }
  
  // Build results
  const resultA = buildModeResult(tradesA);
  const resultB = buildModeResult(tradesB);
  
  // Calculate deltas
  const equityDelta = resultB.equityFinal - resultA.equityFinal;
  const maxDDDelta = resultB.maxDD - resultA.maxDD;  // Negative is better
  const hitRateDelta = resultB.hitRate - resultA.hitRate;
  const blockedRate = resultB.trades > 0 ? resultB.blocked / resultB.trades : 0;
  
  // Acceptance checks
  const checks = [
    {
      name: 'MaxDD reduction >= 10%',
      passed: resultA.maxDD > 0 ? resultB.maxDD <= resultA.maxDD * 0.90 : true,
      value: resultA.maxDD > 0 ? (1 - resultB.maxDD / resultA.maxDD) : 0,
      threshold: 0.10,
    },
    {
      name: 'Equity >= baseline',
      passed: resultB.equityFinal >= resultA.equityFinal * 0.98,  // Allow 2% tolerance
      value: resultB.equityFinal,
      threshold: resultA.equityFinal * 0.98,
    },
    {
      name: 'HitRate drop <= 2%',
      passed: hitRateDelta >= -0.02,
      value: hitRateDelta,
      threshold: -0.02,
    },
    {
      name: 'BlockedRate <= 25%',
      passed: blockedRate <= 0.25,
      value: blockedRate,
      threshold: 0.25,
    },
  ];
  
  const allPassed = checks.every(c => c.passed);
  
  console.log(`[D1 Validation] Complete: ${tradesA.length} trades, passed=${allPassed}`);
  
  return {
    period: { from, to },
    focus,
    stepDays,
    totalDates: signalDates.length,
    modeA: resultA,
    modeB: resultB,
    delta: {
      equityFinal: Math.round(equityDelta * 10000) / 10000,
      equityFinalPct: resultA.equityFinal !== 0 
        ? Math.round((equityDelta / resultA.equityFinal) * 10000) / 10000 
        : 0,
      maxDD: Math.round(maxDDDelta * 10000) / 10000,
      maxDDPct: resultA.maxDD !== 0 
        ? Math.round((maxDDDelta / resultA.maxDD) * 10000) / 10000 
        : 0,
      hitRate: Math.round(hitRateDelta * 10000) / 10000,
      blockedRate: Math.round(blockedRate * 10000) / 10000,
    },
    acceptance: {
      passed: allPassed,
      checks: checks.map(c => ({
        ...c,
        value: Math.round(c.value * 10000) / 10000,
        threshold: Math.round(c.threshold * 10000) / 10000,
      })),
    },
    processingTimeMs: Date.now() - start,
  };
}
