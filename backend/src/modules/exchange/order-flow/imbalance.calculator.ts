/**
 * S10.2 — Imbalance Calculator
 * 
 * Analyzes order book to determine:
 * - Bid/Ask imbalance
 * - Pressure direction
 * - Confidence level
 */

import {
  ImbalancePressure,
  PressureDirection,
} from './order-flow.types.js';
import { OrderBookSnapshot } from '../models/exchange.types.js';

// Thresholds
const IMBALANCE_THRESHOLD = 0.2;         // Min imbalance to declare pressure
const HIGH_CONFIDENCE_THRESHOLD = 0.5;   // Imbalance for high confidence
const SPREAD_WEIGHT = 0.1;               // Weight of spread in confidence

/**
 * Calculate order book imbalance and pressure
 */
export function calculateImbalance(
  orderBook: OrderBookSnapshot | null
): ImbalancePressure {
  const now = new Date();

  // Default state
  if (!orderBook || (orderBook.bids.length === 0 && orderBook.asks.length === 0)) {
    return {
      symbol: orderBook?.symbol || 'UNKNOWN',
      bidAskImbalance: 0,
      pressure: 'NEUTRAL',
      confidence: 0,
      bidVolume: 0,
      askVolume: 0,
      spread: 0,
      timestamp: now,
    };
  }

  const { symbol, bids, asks, spread, imbalance } = orderBook;

  // Calculate volumes
  const bidVolume = bids.reduce((sum, level) => sum + level.price * level.quantity, 0);
  const askVolume = asks.reduce((sum, level) => sum + level.price * level.quantity, 0);

  // Use pre-calculated imbalance from order book snapshot, or calculate
  const bidAskImbalance = imbalance !== undefined ? imbalance : 
    (bidVolume + askVolume > 0) 
      ? (bidVolume - askVolume) / (bidVolume + askVolume)
      : 0;

  // Determine pressure direction
  let pressure: PressureDirection = 'NEUTRAL';
  if (bidAskImbalance > IMBALANCE_THRESHOLD) {
    pressure = 'BUY';  // More bids = buy pressure
  } else if (bidAskImbalance < -IMBALANCE_THRESHOLD) {
    pressure = 'SELL'; // More asks = sell pressure
  }

  // Calculate confidence (0-1)
  // Higher imbalance + tighter spread = higher confidence
  const imbalanceConfidence = Math.min(Math.abs(bidAskImbalance) / HIGH_CONFIDENCE_THRESHOLD, 1);
  const spreadPenalty = Math.min(spread * SPREAD_WEIGHT, 0.3); // Wide spread = less confidence
  const confidence = Math.max(imbalanceConfidence - spreadPenalty, 0);

  return {
    symbol,
    bidAskImbalance,
    pressure,
    confidence,
    bidVolume,
    askVolume,
    spread,
    timestamp: now,
  };
}

export const IMBALANCE_THRESHOLDS = {
  imbalanceThreshold: IMBALANCE_THRESHOLD,
  highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
  spreadWeight: SPREAD_WEIGHT,
};
