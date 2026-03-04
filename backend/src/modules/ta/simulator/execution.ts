/**
 * Phase 3.0: Execution Simulator - Execution Engine
 * 
 * Core logic for creating orders, filling them, opening positions,
 * and managing position lifecycle (stop/target/timeout).
 */

import { v4 as uuid } from 'uuid';
import {
  SimCandle,
  SimOrder,
  SimPosition,
  SimScenario,
  SimRiskPack,
  OrderSide,
  OrderStatus,
  PositionStatus,
  ExitReason,
} from './domain.js';
import { SimConfig, getSimConfig } from './config.js';
import {
  applySlippage,
  applyExitSlippage,
  computeFee,
  checkStopMarketFill,
  getStopMarketFillPrice,
  checkLimitFill,
  checkStopHit,
  checkTargetHit,
  resolveSameCandleExit,
  calculateMFE,
  calculateMAE,
  calculateRMultiple,
} from './fill.js';

// ═══════════════════════════════════════════════════════════════
// ORDER CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create entry order from scenario
 */
export function createEntryOrder(
  runId: string,
  stepId: string,
  nowTs: number,
  scenario: SimScenario,
  config: SimConfig
): SimOrder {
  const { entryType, entryPrice, entryTimeoutBars } = scenario.risk;
  
  const baseOrder: Partial<SimOrder> = {
    orderId: uuid(),
    runId,
    stepId,
    scenarioId: scenario.scenarioId,
    symbol: scenario.symbol,
    tf: scenario.tf,
    side: scenario.side,
    status: 'OPEN' as OrderStatus,
    createdTs: nowTs,
    expiresAfterBars: entryTimeoutBars || config.defaultEntryTimeoutBars,
    barsOpen: 0,
    meta: {
      entryType,
      reason: `Entry from scenario ${scenario.scenarioId}`,
    },
  };
  
  switch (entryType) {
    case 'MARKET':
      return {
        ...baseOrder,
        type: 'MARKET',
      } as SimOrder;
      
    case 'BREAKOUT_TRIGGER':
      return {
        ...baseOrder,
        type: 'STOP_MARKET',
        triggerPrice: entryPrice,
      } as SimOrder;
      
    case 'LIMIT_PULLBACK':
      return {
        ...baseOrder,
        type: 'LIMIT',
        limitPrice: entryPrice,
      } as SimOrder;
      
    default:
      return {
        ...baseOrder,
        type: 'MARKET',
      } as SimOrder;
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER FILL LOGIC
// ═══════════════════════════════════════════════════════════════

export interface FillResult {
  order: SimOrder;
  filled: boolean;
  fillPrice?: number;
}

/**
 * Try to fill an order on the current candle
 */
export function tryFillOrder(
  order: SimOrder,
  candle: SimCandle,
  config: SimConfig
): FillResult {
  if (order.status !== 'OPEN') {
    return { order, filled: false };
  }
  
  let shouldFill = false;
  let fillPrice = 0;
  
  switch (order.type) {
    case 'MARKET':
      // MARKET orders fill immediately at close
      shouldFill = true;
      fillPrice = candle.close;
      break;
      
    case 'STOP_MARKET':
      if (checkStopMarketFill(candle, order.side, order.triggerPrice!)) {
        shouldFill = true;
        fillPrice = getStopMarketFillPrice(
          candle,
          order.side,
          order.triggerPrice!,
          config.gapHandling
        );
      }
      break;
      
    case 'LIMIT':
      if (checkLimitFill(candle, order.side, order.limitPrice!)) {
        shouldFill = true;
        fillPrice = order.limitPrice!;
      }
      break;
  }
  
  if (!shouldFill) {
    // Increment bars open and check expiry
    const updatedOrder: SimOrder = {
      ...order,
      barsOpen: order.barsOpen + 1,
    };
    
    if (updatedOrder.barsOpen >= order.expiresAfterBars) {
      return {
        order: { ...updatedOrder, status: 'EXPIRED' },
        filled: false,
      };
    }
    
    return { order: updatedOrder, filled: false };
  }
  
  // Apply slippage
  const slippedPrice = applySlippage(fillPrice, order.side, config.slippageBps);
  
  return {
    order: {
      ...order,
      status: 'FILLED',
      filledPrice: slippedPrice,
      filledTs: candle.ts,
    },
    filled: true,
    fillPrice: slippedPrice,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create position from filled order
 */
export function createPosition(
  runId: string,
  scenario: SimScenario,
  filledOrder: SimOrder,
  config: SimConfig
): SimPosition {
  const entryPrice = filledOrder.filledPrice!;
  const entryFee = computeFee(entryPrice, config.feeBps);
  
  // Estimate slippage paid
  const originalPrice = filledOrder.type === 'MARKET'
    ? entryPrice  // No reference
    : (filledOrder.triggerPrice || filledOrder.limitPrice || entryPrice);
  const slippagePaid = Math.abs(entryPrice - originalPrice);
  
  return {
    positionId: uuid(),
    runId,
    scenarioId: scenario.scenarioId,
    symbol: scenario.symbol,
    tf: scenario.tf,
    side: scenario.side,
    
    entryTs: filledOrder.filledTs!,
    entryPrice,
    entryOrderId: filledOrder.orderId,
    
    stopPrice: scenario.risk.stopPrice,
    target1Price: scenario.risk.target1Price,
    target2Price: scenario.risk.target2Price,
    timeoutBars: scenario.risk.tradeTimeoutBars || config.defaultTradeTimeoutBars,
    
    status: 'OPEN',
    barsInTrade: 0,
    
    mfePct: 0,
    maePct: 0,
    
    feesPaid: entryFee,
    slippagePaid,
    
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION UPDATE
// ═══════════════════════════════════════════════════════════════

export interface PositionUpdate {
  position: SimPosition;
  closed: boolean;
  exitReason?: ExitReason;
}

/**
 * Update position state on new candle
 */
export function updatePositionOnCandle(
  position: SimPosition,
  candle: SimCandle,
  config: SimConfig
): PositionUpdate {
  if (position.status !== 'OPEN') {
    return { position, closed: false };
  }
  
  const entryPrice = position.entryPrice;
  
  // Update MFE/MAE
  const candleMFE = calculateMFE(candle, position.side, entryPrice);
  const candleMAE = calculateMAE(candle, position.side, entryPrice);
  
  let mfePct = Math.max(position.mfePct, candleMFE);
  let maePct = Math.max(position.maePct, candleMAE);
  
  // Check exit conditions
  const exitType = resolveSameCandleExit(
    candle,
    position.side,
    position.stopPrice,
    position.target1Price,
    config.stopFirst
  );
  
  // If no primary exit, check target2
  if (!exitType && position.target2Price) {
    if (checkTargetHit(candle, position.side, position.target2Price)) {
      return closePosition(position, candle, 'TARGET2', position.target2Price, mfePct, maePct, config);
    }
  }
  
  if (exitType === 'STOP') {
    return closePosition(position, candle, 'STOP', position.stopPrice, mfePct, maePct, config);
  }
  
  if (exitType === 'TARGET') {
    return closePosition(position, candle, 'TARGET1', position.target1Price!, mfePct, maePct, config);
  }
  
  // Check timeout
  const barsInTrade = position.barsInTrade + 1;
  if (barsInTrade >= position.timeoutBars) {
    return closePosition(position, candle, 'TIMEOUT', candle.close, mfePct, maePct, config);
  }
  
  // Position still open
  return {
    position: {
      ...position,
      barsInTrade,
      mfePct,
      maePct,
      updatedAt: new Date(),
    },
    closed: false,
  };
}

/**
 * Close position with given exit parameters
 */
function closePosition(
  position: SimPosition,
  candle: SimCandle,
  exitReason: ExitReason,
  rawExitPrice: number,
  mfePct: number,
  maePct: number,
  config: SimConfig
): PositionUpdate {
  // Apply exit slippage
  const exitPrice = applyExitSlippage(rawExitPrice, position.side, config.slippageBps);
  
  // Add exit fee
  const exitFee = computeFee(exitPrice, config.feeBps);
  const totalFees = position.feesPaid + exitFee;
  
  // Calculate R-multiple
  const rMultiple = calculateRMultiple(
    position.entryPrice,
    exitPrice,
    position.stopPrice,
    position.side,
    totalFees
  );
  
  return {
    position: {
      ...position,
      status: 'CLOSED',
      exitTs: candle.ts,
      exitPrice,
      exitReason,
      barsInTrade: position.barsInTrade + 1,
      mfePct,
      maePct,
      rMultiple,
      feesPaid: totalFees,
      updatedAt: new Date(),
    },
    closed: true,
    exitReason,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert decision pack scenario to SimScenario
 */
export function decisionToSimScenario(
  decision: any,
  symbol: string,
  tf: string
): SimScenario | null {
  const top = decision?.top?.[0] || decision?.scenarios?.[0];
  if (!top) return null;
  
  const risk = top.riskPack || top.risk;
  if (!risk) return null;
  
  return {
    scenarioId: top.scenarioId || top.id || uuid(),
    symbol,
    tf,
    side: (top.intent?.bias === 'SHORT' || top.direction === 'BEARISH') ? 'SHORT' : 'LONG',
    probability: top.probability || 0.5,
    patternType: top.patternType || top.type,
    risk: {
      entryType: risk.entryType || 'MARKET',
      entryPrice: risk.entry || risk.entryPrice,
      stopPrice: risk.stop || risk.stopPrice,
      target1Price: risk.target || risk.target1 || risk.target1Price,
      target2Price: risk.target2 || risk.target2Price,
      entryTimeoutBars: risk.entryTimeoutBars || 5,
      tradeTimeoutBars: risk.tradeTimeoutBars || risk.timeoutBars || 40,
    },
  };
}
