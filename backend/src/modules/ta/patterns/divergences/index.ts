/**
 * Phase R10.C: Divergences Module Index
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import { detectRSIDivergence, RSIDivContext } from './rsi_div.detector.js';
import { detectMACDDivergence, MACDDivContext } from './macd_div.detector.js';

export type DivergenceContext = RSIDivContext & MACDDivContext;

export function runDivergenceDetectors(ctx: DivergenceContext, pivots: Pivot[]): PatternResult[] {
  return [
    ...detectRSIDivergence(ctx, pivots),
    ...detectMACDDivergence(ctx, pivots),
  ];
}

export {
  detectRSIDivergence,
  detectMACDDivergence,
};

export * from './divergence_utils.js';
