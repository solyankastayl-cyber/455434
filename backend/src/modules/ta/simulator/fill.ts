/**
 * Phase 3.0: Execution Simulator - Fill Logic
 * 
 * Core mathematics for order execution. NO magic here,
 * just deterministic rules for fills, stops, and targets.
 */

import { SimCandle, OrderSide } from './domain.js';
import { SimConfig } from './config.js';

// ═══════════════════════════════════════════════════════════════
// SLIPPAGE & FEES
// ═══════════════════════════════════════════════════════════════

/**
 * Apply slippage to price
 * LONG pays more, SHORT sells for less
 */
export function applySlippage(price: number, side: OrderSide, bps: number): number {
  const multiplier = bps / 10_000;
  return side === 'LONG' 
    ? price * (1 + multiplier)   // LONG buys higher
    : price * (1 - multiplier);  // SHORT sells lower
}

/**
 * Apply slippage for exit (opposite direction)
 */
export function applyExitSlippage(price: number, side: OrderSide, bps: number): number {
  // Exit LONG = sell, Exit SHORT = buy
  const exitSide = side === 'LONG' ? 'SHORT' : 'LONG';
  return applySlippage(price, exitSide, bps);
}

/**
 * Compute fee from notional value
 */
export function computeFee(notional: number, feeBps: number): number {
  return Math.abs(notional) * (feeBps / 10_000);
}

// ═══════════════════════════════════════════════════════════════
// STOP_MARKET FILL CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check if STOP_MARKET order would fill on this candle
 * LONG: triggers when price rises to trigger level (buy breakout)
 * SHORT: triggers when price falls to trigger level (sell breakout)
 */
export function checkStopMarketFill(
  candle: SimCandle,
  side: OrderSide,
  triggerPrice: number
): boolean {
  if (side === 'LONG') {
    // LONG breakout: high must reach trigger
    return candle.high >= triggerPrice;
  } else {
    // SHORT breakdown: low must reach trigger
    return candle.low <= triggerPrice;
  }
}

/**
 * Get fill price for STOP_MARKET
 * In gaps, use worst-case fill
 */
export function getStopMarketFillPrice(
  candle: SimCandle,
  side: OrderSide,
  triggerPrice: number,
  gapHandling: 'WORST' | 'BEST' | 'CLOSE'
): number {
  if (side === 'LONG') {
    // If gap up (open > trigger), fill at open (worst for buyer)
    if (candle.open > triggerPrice) {
      return gapHandling === 'WORST' ? candle.open : 
             gapHandling === 'BEST' ? triggerPrice : 
             candle.close;
    }
    return triggerPrice;
  } else {
    // If gap down (open < trigger), fill at open (worst for seller)
    if (candle.open < triggerPrice) {
      return gapHandling === 'WORST' ? candle.open :
             gapHandling === 'BEST' ? triggerPrice :
             candle.close;
    }
    return triggerPrice;
  }
}

// ═══════════════════════════════════════════════════════════════
// LIMIT FILL CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check if LIMIT order would fill on this candle
 * LONG limit: fills if price drops to limit (buy dip)
 * SHORT limit: fills if price rises to limit (sell rally)
 */
export function checkLimitFill(
  candle: SimCandle,
  side: OrderSide,
  limitPrice: number
): boolean {
  if (side === 'LONG') {
    // Buy limit fills if low <= limit
    return candle.low <= limitPrice;
  } else {
    // Sell limit fills if high >= limit
    return candle.high >= limitPrice;
  }
}

// ═══════════════════════════════════════════════════════════════
// POSITION EXIT CHECKS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if stop loss is hit
 * LONG stop: triggered if price drops to stop (sell to cut loss)
 * SHORT stop: triggered if price rises to stop (buy to cut loss)
 */
export function checkStopHit(
  candle: SimCandle,
  side: OrderSide,
  stopPrice: number
): boolean {
  if (side === 'LONG') {
    // LONG stop hit if low <= stop
    return candle.low <= stopPrice;
  } else {
    // SHORT stop hit if high >= stop
    return candle.high >= stopPrice;
  }
}

/**
 * Check if target is hit
 * LONG target: triggered if price rises to target (sell for profit)
 * SHORT target: triggered if price drops to target (buy for profit)
 */
export function checkTargetHit(
  candle: SimCandle,
  side: OrderSide,
  targetPrice: number
): boolean {
  if (side === 'LONG') {
    // LONG target hit if high >= target
    return candle.high >= targetPrice;
  } else {
    // SHORT target hit if low <= target
    return candle.low <= targetPrice;
  }
}

// ═══════════════════════════════════════════════════════════════
// SAME-CANDLE EXIT RESOLUTION
// ═══════════════════════════════════════════════════════════════

/**
 * When both stop and target are hit on same candle,
 * determine which happened "first" (v1: conservative = STOP first)
 */
export function resolveSameCandleExit(
  candle: SimCandle,
  side: OrderSide,
  stopPrice: number,
  targetPrice: number | undefined,
  stopFirst: boolean = true
): 'STOP' | 'TARGET' | null {
  const stopHit = checkStopHit(candle, side, stopPrice);
  const targetHit = targetPrice ? checkTargetHit(candle, side, targetPrice) : false;
  
  if (!stopHit && !targetHit) {
    return null;
  }
  
  if (stopHit && targetHit) {
    // Both hit on same candle
    // v1: Use stopFirst rule (conservative approach)
    // Future: could analyze OHLC sequence for more accuracy
    return stopFirst ? 'STOP' : 'TARGET';
  }
  
  return stopHit ? 'STOP' : 'TARGET';
}

// ═══════════════════════════════════════════════════════════════
// MFE / MAE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate Maximum Favorable Excursion (MFE) on this candle
 * Returns percentage from entry
 */
export function calculateMFE(
  candle: SimCandle,
  side: OrderSide,
  entryPrice: number
): number {
  if (side === 'LONG') {
    // Best case for LONG: highest high
    return (candle.high - entryPrice) / entryPrice * 100;
  } else {
    // Best case for SHORT: lowest low
    return (entryPrice - candle.low) / entryPrice * 100;
  }
}

/**
 * Calculate Maximum Adverse Excursion (MAE) on this candle
 * Returns percentage from entry (always positive = how bad it got)
 */
export function calculateMAE(
  candle: SimCandle,
  side: OrderSide,
  entryPrice: number
): number {
  if (side === 'LONG') {
    // Worst case for LONG: lowest low
    return (entryPrice - candle.low) / entryPrice * 100;
  } else {
    // Worst case for SHORT: highest high
    return (candle.high - entryPrice) / entryPrice * 100;
  }
}

// ═══════════════════════════════════════════════════════════════
// R-MULTIPLE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate R-multiple from entry, exit, and stop prices
 * R = actual PnL / initial risk
 */
export function calculateRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopPrice: number,
  side: OrderSide,
  fees: number = 0
): number {
  // Calculate initial risk (1R)
  const risk = side === 'LONG'
    ? entryPrice - stopPrice
    : stopPrice - entryPrice;
  
  if (risk <= 0) {
    console.warn('[Fill] Invalid risk calculation: risk <= 0');
    return 0;
  }
  
  // Calculate actual PnL
  const pnl = side === 'LONG'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;
  
  // Subtract fees from PnL
  const netPnl = pnl - fees;
  
  // R-multiple
  return netPnl / risk;
}
