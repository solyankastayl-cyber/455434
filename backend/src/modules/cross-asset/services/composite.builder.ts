/**
 * P4: Composite Builder Service
 * 
 * Builds composite forecast from parent snapshots.
 * 
 * Algorithm:
 * 1. Convert parent forecasts to log returns
 * 2. Apply smart weights (vol + conf adjusted)
 * 3. Blend returns
 * 4. Apply daily return cap
 * 5. Convert back to price path (anchor = 100)
 * 6. Calculate bands from parent bands
 */

import type {
  ParentSnapshotData,
  BlendConfig,
  ComputedWeights,
} from '../contracts/composite.contract.js';
import { calculateLogReturns } from './composite.vol.js';

// P5.1: Health-based confidence adjustment
import { getConfidenceWithSamplesGate, type ConfidenceBlock } from '../../health/confidence_adjuster.util.js';
import { HealthStore } from '../../health/model_health.service.js';

export interface CompositePathResult {
  anchorPrice: number;
  forecastPath: number[];
  forecastReturns: number[];
  upperBand: number[];
  lowerBand: number[];
  expectedReturn: number;
  stance: string;
  confidence: number;
  // P5.1: Health-based confidence block
  confidenceSource?: ConfidenceBlock;
}

/**
 * Convert price path to log returns
 */
function priceToReturns(prices: number[]): number[] {
  return calculateLogReturns(prices);
}

/**
 * Convert log returns to price path
 */
function returnsToPrices(returns: number[], anchorPrice: number): number[] {
  const prices: number[] = [anchorPrice];
  for (const r of returns) {
    prices.push(prices[prices.length - 1] * Math.exp(r));
  }
  return prices;
}

/**
 * Clip daily return to cap
 */
function clipReturn(r: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, r));
}

/**
 * Blend multiple return series with weights
 */
function blendReturns(
  btcReturns: number[],
  spxReturns: number[],
  dxyReturns: number[],
  weights: ComputedWeights,
  dailyCap: number
): number[] {
  // Find minimum length
  const minLen = Math.min(btcReturns.length, spxReturns.length, dxyReturns.length);
  
  const blended: number[] = [];
  for (let i = 0; i < minLen; i++) {
    const btcR = btcReturns[i] || 0;
    const spxR = spxReturns[i] || 0;
    const dxyR = dxyReturns[i] || 0;
    
    // Weighted sum
    let r = weights.BTC * btcR + weights.SPX * spxR + weights.DXY * dxyR;
    
    // Clip to daily cap
    r = clipReturn(r, dailyCap);
    
    blended.push(r);
  }
  
  return blended;
}

/**
 * Blend bands (simple weighted average)
 */
function blendBands(
  btcBand: number[],
  spxBand: number[],
  dxyBand: number[],
  weights: ComputedWeights,
  btcAnchor: number,
  spxAnchor: number,
  dxyAnchor: number,
  compositeAnchor: number
): number[] {
  const minLen = Math.min(btcBand.length, spxBand.length, dxyBand.length);
  const result: number[] = [];
  
  for (let i = 0; i < minLen; i++) {
    // Convert to returns from anchor
    const btcPct = btcAnchor > 0 ? (btcBand[i] - btcAnchor) / btcAnchor : 0;
    const spxPct = spxAnchor > 0 ? (spxBand[i] - spxAnchor) / spxAnchor : 0;
    const dxyPct = dxyAnchor > 0 ? (dxyBand[i] - dxyAnchor) / dxyAnchor : 0;
    
    // Blend
    const blendedPct = weights.BTC * btcPct + weights.SPX * spxPct + weights.DXY * dxyPct;
    
    // Convert back to price
    result.push(compositeAnchor * (1 + blendedPct));
  }
  
  return result;
}

/**
 * Determine composite stance from weighted stances
 */
function determineStance(
  btc: ParentSnapshotData,
  spx: ParentSnapshotData,
  dxy: ParentSnapshotData,
  weights: ComputedWeights
): string {
  // Convert stance to score: BULL=1, NEUTRAL=0, BEAR=-1
  const stanceScore = (s?: string): number => {
    if (s === 'BULL' || s === 'BULLISH') return 1;
    if (s === 'BEAR' || s === 'BEARISH') return -1;
    return 0;
  };
  
  const score =
    weights.BTC * stanceScore(btc.stance) +
    weights.SPX * stanceScore(spx.stance) +
    weights.DXY * stanceScore(dxy.stance);
  
  if (score > 0.2) return 'BULLISH';
  if (score < -0.2) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Build composite forecast from parent snapshots
 * P5.1: Now applies health-based confidence adjustment
 */
export async function buildCompositePath(
  btc: ParentSnapshotData,
  spx: ParentSnapshotData,
  dxy: ParentSnapshotData,
  weights: ComputedWeights,
  config: BlendConfig
): Promise<CompositePathResult> {
  const ANCHOR = 100; // Composite index starts at 100
  
  // Convert parent forecasts to returns
  const btcReturns = priceToReturns(btc.forecastPath);
  const spxReturns = priceToReturns(spx.forecastPath);
  const dxyReturns = priceToReturns(dxy.forecastPath);
  
  // Blend returns
  const compositeReturns = blendReturns(
    btcReturns,
    spxReturns,
    dxyReturns,
    weights,
    config.dailyReturnCap
  );
  
  // Convert back to price path
  const compositePath = returnsToPrices(compositeReturns, ANCHOR);
  
  // Calculate expected return (terminal)
  const terminalPrice = compositePath[compositePath.length - 1] || ANCHOR;
  const expectedReturn = (terminalPrice - ANCHOR) / ANCHOR;
  
  // Blend base confidence
  const baseConfidence =
    weights.BTC * btc.confidence +
    weights.SPX * spx.confidence +
    weights.DXY * dxy.confidence;
  
  // P5.1: Apply health-based confidence adjustment for CROSS_ASSET
  const healthState = await HealthStore.getState('CROSS_ASSET');
  const healthGrade = healthState?.grade || 'HEALTHY';
  const healthReasons = healthState?.reasons || [];
  const confidenceBlock = getConfidenceWithSamplesGate(baseConfidence, healthGrade, healthReasons);
  
  // Use adjusted confidence
  const confidence = confidenceBlock.final;
  
  // Determine stance
  const stance = determineStance(btc, spx, dxy, weights);
  
  // Simple bands (±spread around path based on confidence)
  const spread = 1 - confidence; // Lower confidence = wider bands
  const upperBand = compositePath.map((p) => p * (1 + spread * 0.1));
  const lowerBand = compositePath.map((p) => p * (1 - spread * 0.1));
  
  return {
    anchorPrice: ANCHOR,
    forecastPath: compositePath.map((p) => Math.round(p * 100) / 100),
    forecastReturns: compositeReturns.map((r) => Math.round(r * 10000) / 10000),
    upperBand: upperBand.map((p) => Math.round(p * 100) / 100),
    lowerBand: lowerBand.map((p) => Math.round(p * 100) / 100),
    expectedReturn: Math.round(expectedReturn * 10000) / 10000,
    stance,
    confidence: Math.round(confidence * 100) / 100,
    // P5.1: Include confidence source for audit trail
    confidenceSource: confidenceBlock,
  };
}

export default {
  buildCompositePath,
};
