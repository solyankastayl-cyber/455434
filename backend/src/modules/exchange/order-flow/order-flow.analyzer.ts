/**
 * S10.2 — Order Flow Analyzer
 * 
 * Analyzes trade flow to determine:
 * - Who is aggressor (buyer/seller)
 * - Trade intensity
 * - Dominance score
 * 
 * NO signals, NO predictions — only diagnostics
 */

import {
  OrderFlowState,
  AggressorSide,
} from './order-flow.types.js';
import { TradeFlowSnapshot } from '../models/exchange.types.js';

// Thresholds (can be tuned later)
const AGGRESSOR_THRESHOLD = 0.15;      // Min ratio to declare a side
const INTENSITY_NORMALIZATION = 1000000; // Volume normalizer for intensity

/**
 * Analyze trade flow and produce OrderFlowState
 */
export function analyzeOrderFlow(
  tradeFlow: TradeFlowSnapshot | null,
  previousState?: OrderFlowState
): OrderFlowState {
  const now = new Date();
  
  // Default state if no data
  if (!tradeFlow) {
    return {
      symbol: 'UNKNOWN',
      aggressorSide: 'NEUTRAL',
      aggressorRatio: 0,
      tradeIntensity: 0,
      dominanceScore: 0,
      buyVolume: 0,
      sellVolume: 0,
      totalTrades: 0,
      timestamp: now,
    };
  }

  const { symbol, buyVolume, sellVolume, aggressorRatio } = tradeFlow;
  const totalVolume = buyVolume + sellVolume;

  // Determine aggressor side
  let aggressorSide: AggressorSide = 'NEUTRAL';
  if (aggressorRatio > AGGRESSOR_THRESHOLD) {
    aggressorSide = 'BUY';
  } else if (aggressorRatio < -AGGRESSOR_THRESHOLD) {
    aggressorSide = 'SELL';
  }

  // Calculate trade intensity (0-100)
  const tradeIntensity = Math.min(
    (totalVolume / INTENSITY_NORMALIZATION) * 100,
    100
  );

  // Calculate dominance score (0-1)
  // Higher when one side is clearly dominant
  const dominanceScore = Math.abs(aggressorRatio);

  return {
    symbol,
    aggressorSide,
    aggressorRatio,
    tradeIntensity,
    dominanceScore,
    buyVolume,
    sellVolume,
    totalTrades: 0, // Would need trade count from provider
    timestamp: now,
  };
}

/**
 * Determine if flow changed significantly
 */
export function flowChanged(
  current: OrderFlowState,
  previous: OrderFlowState | undefined
): boolean {
  if (!previous) return true;
  if (current.aggressorSide !== previous.aggressorSide) return true;
  if (Math.abs(current.dominanceScore - previous.dominanceScore) > 0.2) return true;
  return false;
}

export const ORDER_FLOW_THRESHOLDS = {
  aggressorThreshold: AGGRESSOR_THRESHOLD,
  intensityNormalization: INTENSITY_NORMALIZATION,
};
