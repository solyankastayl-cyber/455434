/**
 * Outcome Engine — Pure function for evaluating pattern outcomes
 * 
 * Phase 5: Outcome Engine
 * 
 * This is a stateless, pure function that takes:
 * - Trade plan (entry, stop, target, direction, timeout)
 * - Candles after the entry signal
 * 
 * And returns:
 * - Result (WIN/LOSS/TIMEOUT)
 * - MFE/MAE
 * - Exit details
 */

import { 
  OutcomeEvalInput, 
  OutcomeEvalResult, 
  OutcomeResult,
  TradePlan 
} from './outcome.types.js';

// ═══════════════════════════════════════════════════════════════
// Main Evaluation Function
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate outcome for a trade plan against candle data
 * 
 * Rules:
 * - LONG: win if high >= target, loss if low <= stop
 * - SHORT: win if low <= target, loss if high >= stop
 * - If both hit in same bar: use tieBreak (default: LOSS_FIRST)
 * - TIMEOUT if neither hit within timeoutBars
 */
export function evaluateOutcome(input: OutcomeEvalInput): OutcomeEvalResult {
  const { tradePlan, candles, entryTs, tieBreak = 'LOSS_FIRST' } = input;
  const { direction, entry, stop, target, timeoutBars } = tradePlan;

  // Validate trade plan
  if (!isValidTradePlan(tradePlan)) {
    return createSkippedResult('Invalid trade plan');
  }

  // Filter candles after entry
  const postEntryCandles = candles.filter(c => c.ts > entryTs);
  
  if (postEntryCandles.length === 0) {
    return createPendingResult(0);
  }

  // Limit to timeout bars
  const candlesToEvaluate = postEntryCandles.slice(0, timeoutBars);
  
  // Track MFE/MAE
  let mfe = 0;  // Most favorable move
  let mae = 0;  // Most adverse move

  // Iterate through candles
  for (let i = 0; i < candlesToEvaluate.length; i++) {
    const candle = candlesToEvaluate[i];
    const bar = i + 1;

    // Update MFE/MAE
    const { currentMfe, currentMae } = calculateExcursion(direction, entry, candle);
    mfe = Math.max(mfe, currentMfe);
    mae = Math.min(mae, currentMae);

    // Check for target/stop hit
    const hitResult = checkHit(direction, entry, stop, target, candle, tieBreak);

    if (hitResult.hit) {
      const exitPrice = hitResult.exitPrice!;
      const { returnAbs, returnPct } = calculateReturn(direction, entry, exitPrice);

      return {
        result: hitResult.result!,
        exitTs: candle.ts,
        exitPrice,
        exitBar: bar,
        exitReason: hitResult.result === 'WIN' ? 'TARGET_HIT' : 'STOP_HIT',
        mfe,
        mfePct: (mfe / entry) * 100,
        mae,
        maePct: (mae / entry) * 100,
        returnAbs,
        returnPct,
        barsEvaluated: bar,
      };
    }
  }

  // Timeout: neither target nor stop hit
  if (candlesToEvaluate.length >= timeoutBars) {
    const lastCandle = candlesToEvaluate[candlesToEvaluate.length - 1];
    const exitPrice = lastCandle.close;
    const { returnAbs, returnPct } = calculateReturn(direction, entry, exitPrice);

    return {
      result: 'TIMEOUT',
      exitTs: lastCandle.ts,
      exitPrice,
      exitBar: candlesToEvaluate.length,
      exitReason: 'TIMEOUT',
      mfe,
      mfePct: (mfe / entry) * 100,
      mae,
      maePct: (mae / entry) * 100,
      returnAbs,
      returnPct,
      barsEvaluated: candlesToEvaluate.length,
    };
  }

  // Still pending (not enough bars yet)
  return {
    result: 'PENDING',
    mfe,
    mfePct: (mfe / entry) * 100,
    mae,
    maePct: (mae / entry) * 100,
    barsEvaluated: candlesToEvaluate.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

function isValidTradePlan(plan: TradePlan): boolean {
  const { direction, entry, stop, target, timeoutBars } = plan;
  
  if (!entry || entry <= 0) return false;
  if (!stop || stop <= 0) return false;
  if (!target || target <= 0) return false;
  if (!timeoutBars || timeoutBars <= 0) return false;
  
  if (direction === 'LONG') {
    // For LONG: stop < entry < target
    if (stop >= entry) return false;
    if (target <= entry) return false;
  } else if (direction === 'SHORT') {
    // For SHORT: target < entry < stop
    if (stop <= entry) return false;
    if (target >= entry) return false;
  } else {
    return false;
  }
  
  return true;
}

function calculateExcursion(
  direction: string,
  entry: number,
  candle: { high: number; low: number }
): { currentMfe: number; currentMae: number } {
  if (direction === 'LONG') {
    return {
      currentMfe: candle.high - entry,  // positive when price goes up
      currentMae: candle.low - entry,   // negative when price goes down
    };
  } else {
    return {
      currentMfe: entry - candle.low,   // positive when price goes down
      currentMae: entry - candle.high,  // negative when price goes up
    };
  }
}

type HitCheckResult = {
  hit: boolean;
  result?: OutcomeResult;
  exitPrice?: number;
};

function checkHit(
  direction: string,
  entry: number,
  stop: number,
  target: number,
  candle: { high: number; low: number },
  tieBreak: 'LOSS_FIRST' | 'WIN_FIRST'
): HitCheckResult {
  if (direction === 'LONG') {
    const hitTarget = candle.high >= target;
    const hitStop = candle.low <= stop;

    if (hitTarget && hitStop) {
      // Both hit in same bar - use tie break rule
      if (tieBreak === 'LOSS_FIRST') {
        return { hit: true, result: 'LOSS', exitPrice: stop };
      } else {
        return { hit: true, result: 'WIN', exitPrice: target };
      }
    }

    if (hitStop) {
      return { hit: true, result: 'LOSS', exitPrice: stop };
    }

    if (hitTarget) {
      return { hit: true, result: 'WIN', exitPrice: target };
    }
  } else {
    // SHORT
    const hitTarget = candle.low <= target;
    const hitStop = candle.high >= stop;

    if (hitTarget && hitStop) {
      if (tieBreak === 'LOSS_FIRST') {
        return { hit: true, result: 'LOSS', exitPrice: stop };
      } else {
        return { hit: true, result: 'WIN', exitPrice: target };
      }
    }

    if (hitStop) {
      return { hit: true, result: 'LOSS', exitPrice: stop };
    }

    if (hitTarget) {
      return { hit: true, result: 'WIN', exitPrice: target };
    }
  }

  return { hit: false };
}

function calculateReturn(
  direction: string,
  entry: number,
  exitPrice: number
): { returnAbs: number; returnPct: number } {
  let returnAbs: number;
  
  if (direction === 'LONG') {
    returnAbs = exitPrice - entry;
  } else {
    returnAbs = entry - exitPrice;
  }
  
  const returnPct = (returnAbs / entry) * 100;
  
  return {
    returnAbs: Math.round(returnAbs * 100) / 100,
    returnPct: Math.round(returnPct * 100) / 100,
  };
}

function createSkippedResult(reason: string): OutcomeEvalResult {
  return {
    result: 'SKIPPED',
    mfe: 0,
    mfePct: 0,
    mae: 0,
    maePct: 0,
    barsEvaluated: 0,
  };
}

function createPendingResult(barsEvaluated: number): OutcomeEvalResult {
  return {
    result: 'PENDING',
    mfe: 0,
    mfePct: 0,
    mae: 0,
    maePct: 0,
    barsEvaluated,
  };
}

// ═══════════════════════════════════════════════════════════════
// Trade Plan Extraction from Pattern
// ═══════════════════════════════════════════════════════════════

/**
 * Extract trade plan from a pattern's trade object
 * Returns null if trade plan is incomplete
 */
export function extractTradePlan(
  pattern: {
    direction: string;
    trade?: {
      entry: number;
      stop: number;
      target1: number;
      target2?: number;
      riskReward: number;
    };
  },
  defaultTimeoutBars: number = 30
): TradePlan | null {
  if (!pattern.trade) return null;
  
  const { entry, stop, target1, target2 } = pattern.trade;
  
  if (!entry || !stop) return null;
  
  // Determine direction from pattern
  let direction: 'LONG' | 'SHORT';
  if (pattern.direction === 'BULLISH') {
    direction = 'LONG';
  } else if (pattern.direction === 'BEARISH') {
    direction = 'SHORT';
  } else {
    return null; // NEUTRAL patterns don't have a trade direction
  }
  
  // Select best target: prefer target1 if valid, else use target2
  let target: number | undefined;
  
  if (direction === 'LONG') {
    // For LONG: target must be > entry
    if (target1 && target1 > entry) {
      target = target1;
    } else if (target2 && target2 > entry) {
      target = target2;
    }
    // Validate stop < entry
    if (stop >= entry) return null;
  } else {
    // For SHORT: target must be < entry
    if (target1 && target1 < entry) {
      target = target1;
    } else if (target2 && target2 < entry) {
      target = target2;
    }
    // Validate stop > entry
    if (stop <= entry) return null;
  }
  
  if (!target) return null;
  
  return {
    direction,
    entry,
    stop,
    target,
    timeoutBars: defaultTimeoutBars,
  };
}
