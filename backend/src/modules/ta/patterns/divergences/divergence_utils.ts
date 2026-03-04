/**
 * Phase R10.C: Divergence Utilities
 */

import { Pivot } from '../utils/pattern_types.js';

/**
 * Get last two swing pivots of a kind
 */
export function lastTwoSwings(
  pivots: Pivot[],
  kind: 'HIGH' | 'LOW'
): { p1: Pivot; p2: Pivot } | null {
  const filtered = pivots.filter(p => p.kind === kind);
  if (filtered.length < 2) return null;
  
  return {
    p1: filtered[filtered.length - 2],
    p2: filtered[filtered.length - 1],
  };
}

/**
 * Check if p2 makes higher high than p1
 */
export function higherHigh(p1: Pivot, p2: Pivot): boolean {
  return p2.price > p1.price;
}

/**
 * Check if p2 makes lower low than p1
 */
export function lowerLow(p1: Pivot, p2: Pivot): boolean {
  return p2.price < p1.price;
}

/**
 * Check for regular bullish divergence
 * Price: lower low, Indicator: higher low
 */
export function isRegularBullDiv(
  priceLow1: number,
  priceLow2: number,
  indLow1: number,
  indLow2: number
): boolean {
  return priceLow2 < priceLow1 && indLow2 > indLow1;
}

/**
 * Check for regular bearish divergence
 * Price: higher high, Indicator: lower high
 */
export function isRegularBearDiv(
  priceHigh1: number,
  priceHigh2: number,
  indHigh1: number,
  indHigh2: number
): boolean {
  return priceHigh2 > priceHigh1 && indHigh2 < indHigh1;
}

/**
 * Check for hidden bullish divergence
 * Price: higher low, Indicator: lower low
 */
export function isHiddenBullDiv(
  priceLow1: number,
  priceLow2: number,
  indLow1: number,
  indLow2: number
): boolean {
  return priceLow2 > priceLow1 && indLow2 < indLow1;
}

/**
 * Check for hidden bearish divergence
 * Price: lower high, Indicator: higher high
 */
export function isHiddenBearDiv(
  priceHigh1: number,
  priceHigh2: number,
  indHigh1: number,
  indHigh2: number
): boolean {
  return priceHigh2 < priceHigh1 && indHigh2 > indHigh1;
}
