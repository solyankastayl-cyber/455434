/**
 * Validation Service - ML v2.1 STEP 1
 * 
 * Evaluates ML predictions against actual market outcomes.
 * Core engine for the self-learning loop.
 */

import { 
  SignalOutcomeModel, 
  ISignalOutcome, 
  PredictedSide, 
  OutcomeResult, 
  OutcomeReason,
  Horizon 
} from './signal_outcome.model.js';

// ============================================
// TYPES
// ============================================

export interface MarketSignal {
  _id: string;
  signalId: string;
  network: string;
  asset: string;
  predictedSide: PredictedSide;
  score: number;
  confidence: number;
  modelVersion?: string;
  timestamp: Date;
  evaluated?: boolean;
}

export interface SignalOutcome {
  signalId: string;
  outcome: OutcomeResult;
  reason: OutcomeReason;
  entryPrice: number | null;
  exitPrice: number | null;
  actualReturnPct: number | null;
}

export interface PriceData {
  price: number;
  timestamp: number;
}

// ============================================
// CONFIGURATION
// ============================================

const HORIZON_MS: Record<Horizon, number> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// Minimum price move to count as directional (0.5%)
const MIN_MOVE_THRESHOLD = 0.005;

// ============================================
// VALIDATION SERVICE
// ============================================

/**
 * Get price at a specific timestamp
 * Uses existing price infrastructure
 */
async function getPriceAt(
  asset: string, 
  network: string, 
  timestamp: Date
): Promise<number | null> {
  try {
    // Import dynamically to avoid circular deps
    const { getHistoricalPrice } = await import('../../providers/price_service.js');
    
    const price = await getHistoricalPrice(asset, network, timestamp.getTime());
    return price || null;
  } catch (err) {
    console.error(`[Validation] Price fetch failed for ${asset}@${timestamp}:`, err);
    return null;
  }
}

/**
 * Determine outcome based on prediction and actual return
 */
function determineOutcome(
  predictedSide: PredictedSide,
  actualReturnPct: number | null
): { outcome: OutcomeResult; reason: OutcomeReason } {
  // No price data
  if (actualReturnPct === null) {
    return { outcome: 'SKIPPED', reason: 'NO_PRICE' };
  }
  
  // Very small move - treat as neutral
  if (Math.abs(actualReturnPct) < MIN_MOVE_THRESHOLD * 100) {
    return { outcome: 'NEUTRAL', reason: 'LOW_MOVE' };
  }
  
  const actualDirection = actualReturnPct > 0 ? 'BUY' : 'SELL';
  
  // NEUTRAL prediction - always correct if market moved
  if (predictedSide === 'NEUTRAL') {
    return { outcome: 'NEUTRAL', reason: 'OK' };
  }
  
  // Check if prediction matches reality
  if (predictedSide === actualDirection) {
    return { outcome: 'CORRECT', reason: 'OK' };
  } else {
    return { outcome: 'WRONG', reason: 'OK' };
  }
}

/**
 * Evaluate a single signal
 */
export async function evaluateSignal(
  signal: MarketSignal,
  horizon: Horizon = '4h'
): Promise<SignalOutcome> {
  const signalTime = new Date(signal.timestamp);
  const exitTime = new Date(signalTime.getTime() + HORIZON_MS[horizon]);
  
  // Check if enough time has passed
  if (exitTime.getTime() > Date.now()) {
    return {
      signalId: signal.signalId,
      outcome: 'SKIPPED',
      reason: 'TIMEOUT',
      entryPrice: null,
      exitPrice: null,
      actualReturnPct: null,
    };
  }
  
  // Get prices
  const entryPrice = await getPriceAt(signal.asset, signal.network, signalTime);
  const exitPrice = await getPriceAt(signal.asset, signal.network, exitTime);
  
  // Calculate return
  let actualReturnPct: number | null = null;
  if (entryPrice && exitPrice && entryPrice > 0) {
    actualReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  }
  
  // Determine outcome
  const { outcome, reason } = determineOutcome(signal.predictedSide, actualReturnPct);
  
  return {
    signalId: signal.signalId,
    outcome,
    reason,
    entryPrice,
    exitPrice,
    actualReturnPct,
  };
}

/**
 * Evaluate and save signal outcome
 */
export async function evaluateAndSaveSignal(
  signal: MarketSignal,
  horizon: Horizon = '4h'
): Promise<ISignalOutcome | null> {
  try {
    // Check if already evaluated
    const existing = await SignalOutcomeModel.findOne({ signalId: signal.signalId });
    if (existing) {
      return existing;
    }
    
    // Evaluate
    const outcome = await evaluateSignal(signal, horizon);
    
    // Save
    const doc = new SignalOutcomeModel({
      signalId: signal.signalId,
      network: signal.network,
      asset: signal.asset,
      predictedSide: signal.predictedSide,
      predictedScore: signal.score || 0,
      confidence: signal.confidence || 0,
      modelVersion: signal.modelVersion || 'v2.0.0',
      entryPrice: outcome.entryPrice,
      exitPrice: outcome.exitPrice,
      actualReturnPct: outcome.actualReturnPct,
      outcome: outcome.outcome,
      reason: outcome.reason,
      horizon,
      signalTimestamp: signal.timestamp,
      evaluatedAt: new Date(),
    });
    
    await doc.save();
    
    console.log(`[Validation] Signal ${signal.signalId}: ${outcome.outcome} (${outcome.reason})`);
    
    return doc;
  } catch (err: any) {
    // Handle duplicate key error gracefully
    if (err.code === 11000) {
      return SignalOutcomeModel.findOne({ signalId: signal.signalId });
    }
    console.error(`[Validation] Error saving outcome for ${signal.signalId}:`, err.message);
    return null;
  }
}

/**
 * Get outcomes summary
 */
export async function getOutcomesSummary(
  network?: string,
  modelVersion?: string,
  horizon?: Horizon,
  days: number = 7
): Promise<{
  total: number;
  correct: number;
  wrong: number;
  neutral: number;
  skipped: number;
  accuracy: number;
}> {
  const minDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const query: any = { createdAt: { $gte: minDate } };
  if (network) query.network = network;
  if (modelVersion) query.modelVersion = modelVersion;
  if (horizon) query.horizon = horizon;
  
  const outcomes = await SignalOutcomeModel.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$outcome',
        count: { $sum: 1 },
      },
    },
  ]);
  
  const counts: Record<string, number> = {};
  outcomes.forEach((o) => {
    counts[o._id] = o.count;
  });
  
  const correct = counts['CORRECT'] || 0;
  const wrong = counts['WRONG'] || 0;
  const neutral = counts['NEUTRAL'] || 0;
  const skipped = counts['SKIPPED'] || 0;
  const total = correct + wrong + neutral + skipped;
  
  // Accuracy excludes skipped and neutral
  const evaluated = correct + wrong;
  const accuracy = evaluated > 0 ? correct / evaluated : 0;
  
  return { total, correct, wrong, neutral, skipped, accuracy };
}

/**
 * Get recent outcomes
 */
export async function getRecentOutcomes(
  limit: number = 50,
  network?: string,
  outcome?: OutcomeResult
): Promise<ISignalOutcome[]> {
  const query: any = {};
  if (network) query.network = network;
  if (outcome) query.outcome = outcome;
  
  return SignalOutcomeModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export default {
  evaluateSignal,
  evaluateAndSaveSignal,
  getOutcomesSummary,
  getRecentOutcomes,
};
