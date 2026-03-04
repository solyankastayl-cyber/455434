/**
 * S10.2 — Order Flow Service
 * 
 * Orchestrates all order flow analysis components.
 * Maintains cache and provides unified API.
 */

import { analyzeOrderFlow, ORDER_FLOW_THRESHOLDS } from './order-flow.analyzer.js';
import { detectAbsorption, ABSORPTION_THRESHOLDS } from './absorption.detector.js';
import { calculateImbalance, IMBALANCE_THRESHOLDS } from './imbalance.calculator.js';
import {
  OrderFlowState,
  AbsorptionState,
  ImbalancePressure,
  OrderFlowSummary,
  OrderFlowDiagnostics,
  AggressorSide,
} from './order-flow.types.js';
import * as exchangeDataService from '../exchange-data.service.js';

// Caches
const flowStateCache: Map<string, OrderFlowState> = new Map();
const absorptionCache: Map<string, AbsorptionState> = new Map();
const pressureCache: Map<string, ImbalancePressure> = new Map();
const priceHistory: Map<string, number[]> = new Map();
const evaluationHistory: Map<string, Array<{ timestamp: Date; aggressorSide: AggressorSide; dominanceScore: number }>> = new Map();

const MAX_HISTORY_LENGTH = 20;

/**
 * Update order flow analysis for a symbol
 */
export function updateOrderFlow(symbol: string): OrderFlowState {
  const tradeFlow = exchangeDataService.getTradeFlow(symbol);
  const previousState = flowStateCache.get(symbol);
  
  const newState = analyzeOrderFlow(tradeFlow, previousState);
  flowStateCache.set(symbol, newState);
  
  // Track evaluation history
  const history = evaluationHistory.get(symbol) || [];
  history.push({
    timestamp: newState.timestamp,
    aggressorSide: newState.aggressorSide,
    dominanceScore: newState.dominanceScore,
  });
  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift();
  }
  evaluationHistory.set(symbol, history);
  
  return newState;
}

/**
 * Update absorption detection for a symbol
 */
export function updateAbsorption(symbol: string): AbsorptionState {
  const tradeFlow = exchangeDataService.getTradeFlow(symbol);
  const markets = exchangeDataService.getMarkets();
  const market = markets.find(m => m.symbol === symbol);
  
  const currentPrice = market?.price || 0;
  const history = priceHistory.get(symbol) || [];
  const previousPrice = history.length > 0 ? history[history.length - 1] : currentPrice;
  
  // Track price history
  history.push(currentPrice);
  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift();
  }
  priceHistory.set(symbol, history);
  
  const absorption = detectAbsorption({
    tradeFlow,
    currentPrice,
    previousPrice,
  });
  
  absorptionCache.set(symbol, absorption);
  return absorption;
}

/**
 * Update imbalance pressure for a symbol
 */
export function updatePressure(symbol: string): ImbalancePressure {
  const orderBook = exchangeDataService.getOrderBook(symbol);
  const pressure = calculateImbalance(orderBook);
  pressureCache.set(symbol, pressure);
  return pressure;
}

/**
 * Get full order flow summary for a symbol
 */
export function getOrderFlowSummary(symbol: string): OrderFlowSummary {
  // Update all components
  const flow = updateOrderFlow(symbol);
  const absorption = updateAbsorption(symbol);
  const pressure = updatePressure(symbol);
  
  // Calculate overall market bias
  let biasScore = 0;
  let biasWeight = 0;
  
  // Flow contributes 40%
  biasScore += flow.aggressorRatio * 0.4;
  biasWeight += 0.4;
  
  // Pressure contributes 35%
  biasScore += pressure.bidAskImbalance * 0.35 * pressure.confidence;
  biasWeight += 0.35;
  
  // Absorption contributes 25% (inverted - absorption of sells = bullish)
  if (absorption.detected) {
    const absorptionSignal = absorption.side === 'SELL' ? 0.25 : -0.25;
    biasScore += absorptionSignal * (absorption.strength === 'HIGH' ? 1 : absorption.strength === 'MEDIUM' ? 0.6 : 0.3);
    biasWeight += 0.25;
  }
  
  const normalizedBias = biasWeight > 0 ? biasScore / biasWeight : 0;
  
  let marketBias: AggressorSide = 'NEUTRAL';
  if (normalizedBias > 0.15) marketBias = 'BUY';
  else if (normalizedBias < -0.15) marketBias = 'SELL';
  
  const biasStrength = Math.min(Math.abs(normalizedBias) * 100 * 2, 100);
  
  return {
    symbol,
    flow,
    absorption,
    pressure,
    marketBias,
    biasStrength,
    timestamp: new Date(),
  };
}

/**
 * Get cached flow state
 */
export function getFlowState(symbol: string): OrderFlowState | null {
  return flowStateCache.get(symbol) || null;
}

/**
 * Get cached absorption state
 */
export function getAbsorptionState(symbol: string): AbsorptionState | null {
  return absorptionCache.get(symbol) || null;
}

/**
 * Get cached pressure state
 */
export function getPressureState(symbol: string): ImbalancePressure | null {
  return pressureCache.get(symbol) || null;
}

/**
 * Get diagnostics for admin panel
 */
export function getDiagnostics(symbol: string): OrderFlowDiagnostics {
  const tradeFlow = exchangeDataService.getTradeFlow(symbol);
  const orderBook = exchangeDataService.getOrderBook(symbol);
  const flow = flowStateCache.get(symbol);
  const absorption = absorptionCache.get(symbol);
  const pressure = pressureCache.get(symbol);
  const history = evaluationHistory.get(symbol) || [];
  
  return {
    symbol,
    rawInputs: {
      tradeFlowTimestamp: tradeFlow?.timestamp || null,
      orderBookTimestamp: orderBook?.timestamp || null,
      buyVolume: tradeFlow?.buyVolume || 0,
      sellVolume: tradeFlow?.sellVolume || 0,
      bidLevels: orderBook?.bids?.length || 0,
      askLevels: orderBook?.asks?.length || 0,
    },
    calculatedStates: {
      aggressorRatio: flow?.aggressorRatio || 0,
      imbalance: pressure?.bidAskImbalance || 0,
      intensity: flow?.tradeIntensity || 0,
      absorptionDetected: absorption?.detected || false,
    },
    thresholds: {
      aggressorThreshold: ORDER_FLOW_THRESHOLDS.aggressorThreshold,
      absorptionVolumeMin: ABSORPTION_THRESHOLDS.minVolumeForAbsorption,
      imbalanceThreshold: IMBALANCE_THRESHOLDS.imbalanceThreshold,
      intensityNormalization: ORDER_FLOW_THRESHOLDS.intensityNormalization,
    },
    evaluationHistory: history,
  };
}

/**
 * Get all tracked symbols with flow data
 */
export function getTrackedSymbols(): string[] {
  return Array.from(flowStateCache.keys());
}

/**
 * Clear all caches
 */
export function clearCaches(): void {
  flowStateCache.clear();
  absorptionCache.clear();
  pressureCache.clear();
  priceHistory.clear();
  evaluationHistory.clear();
}
