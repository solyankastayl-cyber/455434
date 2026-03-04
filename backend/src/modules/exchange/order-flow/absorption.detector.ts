/**
 * S10.2 — Absorption Detector
 * 
 * Detects when large volume is being absorbed without price movement.
 * This indicates strong hidden buyers/sellers.
 * 
 * Example: Heavy selling but price doesn't drop = someone absorbing
 */

import {
  AbsorptionState,
  AbsorptionStrength,
  AggressorSide,
} from './order-flow.types.js';
import { TradeFlowSnapshot, ExchangeMarketSnapshot } from '../models/exchange.types.js';

// Thresholds
const MIN_VOLUME_FOR_ABSORPTION = 100000;  // Min volume to consider
const PRICE_MOVE_THRESHOLD = 0.3;          // % price move that counts as "moved"
const HIGH_ABSORPTION_RATIO = 0.7;          // Volume absorbed without move
const MEDIUM_ABSORPTION_RATIO = 0.4;

interface AbsorptionInput {
  tradeFlow: TradeFlowSnapshot | null;
  currentPrice: number;
  previousPrice: number;
}

/**
 * Detect absorption in market
 */
export function detectAbsorption(input: AbsorptionInput): AbsorptionState {
  const { tradeFlow, currentPrice, previousPrice } = input;
  const now = new Date();

  // Default state
  if (!tradeFlow || previousPrice === 0) {
    return {
      symbol: tradeFlow?.symbol || 'UNKNOWN',
      detected: false,
      side: 'NEUTRAL',
      absorbedVolume: 0,
      priceMoved: false,
      strength: 'NONE',
      priceChangePercent: 0,
      timestamp: now,
    };
  }

  const { symbol, buyVolume, sellVolume, aggressorRatio } = tradeFlow;
  const totalVolume = buyVolume + sellVolume;
  const dominantVolume = Math.max(buyVolume, sellVolume);
  const priceChangePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
  const priceMoved = Math.abs(priceChangePercent) > PRICE_MOVE_THRESHOLD;

  // Determine which side is being absorbed
  let absorbedSide: AggressorSide = 'NEUTRAL';
  let absorbedVolume = 0;

  // If heavy selling but price didn't drop much = buy absorption
  if (sellVolume > buyVolume && !priceMoved && dominantVolume >= MIN_VOLUME_FOR_ABSORPTION) {
    absorbedSide = 'SELL'; // Sell pressure is being absorbed
    absorbedVolume = sellVolume;
  }
  // If heavy buying but price didn't rise much = sell absorption
  else if (buyVolume > sellVolume && !priceMoved && dominantVolume >= MIN_VOLUME_FOR_ABSORPTION) {
    absorbedSide = 'BUY'; // Buy pressure is being absorbed
    absorbedVolume = buyVolume;
  }

  // Calculate absorption strength
  let strength: AbsorptionStrength = 'NONE';
  const detected = absorbedSide !== 'NEUTRAL';

  if (detected) {
    const dominanceRatio = dominantVolume / totalVolume;
    if (dominanceRatio >= HIGH_ABSORPTION_RATIO) {
      strength = 'HIGH';
    } else if (dominanceRatio >= MEDIUM_ABSORPTION_RATIO) {
      strength = 'MEDIUM';
    } else {
      strength = 'LOW';
    }
  }

  return {
    symbol,
    detected,
    side: absorbedSide,
    absorbedVolume,
    priceMoved,
    strength,
    priceChangePercent,
    timestamp: now,
  };
}

export const ABSORPTION_THRESHOLDS = {
  minVolumeForAbsorption: MIN_VOLUME_FOR_ABSORPTION,
  priceMoveThreshold: PRICE_MOVE_THRESHOLD,
  highAbsorptionRatio: HIGH_ABSORPTION_RATIO,
  mediumAbsorptionRatio: MEDIUM_ABSORPTION_RATIO,
};
