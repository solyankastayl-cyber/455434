/**
 * OUTCOME TRACKER JOB — Creates decision outcomes from predictions
 * =================================================================
 * 
 * Pipeline:
 * 1. Find predictions without outcomes
 * 2. For each horizon (1h, 4h, 24h):
 *    - Get realized price at T+horizon
 *    - Calculate direction match
 *    - Assign label (TP/FP/FN/WEAK)
 * 3. Save to decision_outcomes
 * 4. Optionally generate learning_samples
 */

import { getDb } from '../db/mongodb.js';
import { getCurrentPrice } from '../modules/chart/services/price.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PredictionRecord {
  id: string;
  symbol: string;
  timestamp: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  priceAtPrediction: number;
  regime?: string;
  expectedMovePct?: number;
}

interface OutcomeRecord {
  predictionId: string;
  symbol: string;
  timestamp: number;
  horizon: '1h' | '4h' | '24h';
  priceAtPrediction: number;
  priceAtHorizon: number;
  realizedMovePct: number;
  predictedMovePct: number;
  directionCorrect: boolean;
  label: 'TP' | 'FP' | 'FN' | 'TN' | 'WEAK';
  deviationPct: number;
  createdAt: Date;
}

interface LearningSample {
  predictionId: string;
  symbol: string;
  features: Record<string, number>;
  label: number; // 0 or 1
  weight: number;
  horizon: string;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const HORIZONS = ['1h', '4h', '24h'] as const;
const HORIZON_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// Thresholds for labeling
const THRESHOLDS = {
  strongMove: 2.0,   // % move for STRONG
  weakMove: 0.5,     // % move for WEAK
  directionTol: 0.3, // % tolerance for direction match
};

const PROCESSING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PREDICTIONS_PER_RUN = 100;

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;
let lastRun: Date | null = null;
let stats = { processed: 0, created: 0, errors: 0 };

// ═══════════════════════════════════════════════════════════════
// PREDICTION RETRIEVAL
// ═══════════════════════════════════════════════════════════════

/**
 * Get predictions that need outcomes for a specific horizon
 */
async function getPendingPredictions(horizon: string): Promise<PredictionRecord[]> {
  const db = await getDb();
  const now = Date.now();
  const horizonMs = HORIZON_MS[horizon];
  
  // Find observations that:
  // 1. Are old enough that their horizon has PASSED (timestamp + horizon < now)
  // 2. Don't have outcome yet for this horizon
  // 3. Not too old (within last 48h for efficiency)
  const maxAge = now - horizonMs;  // Oldest prediction whose horizon just passed
  const minAge = now - 48 * 60 * 60 * 1000; // Don't go back more than 48h
  
  console.log(`[OutcomeTracker] ${horizon}: looking for obs between ${new Date(minAge).toISOString()} and ${new Date(maxAge).toISOString()}`);
  
  // Get observations old enough for this horizon to have passed
  const observations = await db.collection('exchange_observations')
    .find({
      timestamp: { $gt: minAge, $lt: maxAge },
    })
    .sort({ timestamp: -1 })
    .limit(MAX_PREDICTIONS_PER_RUN)
    .toArray();
  
  console.log(`[OutcomeTracker] Found ${observations.length} candidate observations`);
  
  if (observations.length === 0) return [];
  
  // Get existing outcomes for these predictions
  const existingOutcomes = await db.collection('decision_outcomes')
    .find({
      predictionId: { $in: observations.map(o => o.id) },
      horizon,
    })
    .toArray();
  
  const existingIds = new Set(existingOutcomes.map(o => o.predictionId));
  console.log(`[OutcomeTracker] ${existingIds.size} already have outcomes`);
  
  // Filter to pending only
  const pending: PredictionRecord[] = [];
  
  for (const obs of observations) {
    if (existingIds.has(obs.id)) continue;
    
    // Extract prediction info from observation
    const regime = obs.regime?.type || obs.regime || 'NEUTRAL';
    const confidence = obs.regime?.confidence || 0.5;
    
    // Determine direction from regime and indicators
    let direction: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    
    if (regime === 'EXPANSION' || regime === 'SHORT_SQUEEZE') {
      direction = 'UP';
    } else if (regime === 'LONG_SQUEEZE' || regime === 'EXHAUSTION') {
      direction = 'DOWN';
    } else if (regime === 'ACCUMULATION') {
      direction = confidence > 0.6 ? 'UP' : 'FLAT';
    }
    
    // Calculate expected move from confidence
    const expectedMovePct = (confidence - 0.5) * 4; // -2% to +2%
    
    pending.push({
      id: obs.id,
      symbol: obs.symbol,
      timestamp: obs.timestamp,
      direction,
      confidence,
      priceAtPrediction: obs.market?.price || 0,
      regime,
      expectedMovePct,
    });
  }
  
  return pending;
}

// ═══════════════════════════════════════════════════════════════
// PRICE AT HORIZON
// ═══════════════════════════════════════════════════════════════

/**
 * Get price at a specific timestamp (or closest available)
 */
async function getPriceAtTimestamp(symbol: string, timestamp: number): Promise<number | null> {
  const db = await getDb();
  
  // Try to find observation closest to target timestamp
  // Use larger tolerance (1 hour) since we may not have exact timestamps
  const tolerance = 60 * 60 * 1000; // 1 hour
  
  console.log(`[OutcomeTracker] Looking for price near ${new Date(timestamp).toISOString()}`);
  
  const obs = await db.collection('exchange_observations')
    .findOne({
      symbol,
      timestamp: { $gte: timestamp - tolerance, $lte: timestamp + tolerance },
    }, {
      sort: { timestamp: 1 },
    });
  
  if (obs?.market?.price) {
    console.log(`[OutcomeTracker] Found price ${obs.market.price} at ${new Date(obs.timestamp).toISOString()}`);
    return obs.market.price;
  }
  
  // If no observation within tolerance, try ANY observation after target
  const laterObs = await db.collection('exchange_observations')
    .findOne({
      symbol,
      timestamp: { $gte: timestamp },
    }, {
      sort: { timestamp: 1 },
    });
  
  if (laterObs?.market?.price) {
    console.log(`[OutcomeTracker] Found later price ${laterObs.market.price} at ${new Date(laterObs.timestamp).toISOString()}`);
    return laterObs.market.price;
  }
  
  // Try current price as last resort
  const current = await getCurrentPrice(symbol);
  if (current) {
    console.log(`[OutcomeTracker] Using current price ${current}`);
    return current;
  }
  
  console.log(`[OutcomeTracker] No price found for ${symbol} near ${timestamp}`);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// LABELING LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Assign label based on prediction vs actual
 */
function assignLabel(
  predictedDirection: 'UP' | 'DOWN' | 'FLAT',
  realizedMovePct: number,
  predictedMovePct: number
): 'TP' | 'FP' | 'FN' | 'TN' | 'WEAK' {
  const actualDirection: 'UP' | 'DOWN' | 'FLAT' = 
    realizedMovePct > THRESHOLDS.directionTol ? 'UP' :
    realizedMovePct < -THRESHOLDS.directionTol ? 'DOWN' : 'FLAT';
  
  const moveSize = Math.abs(realizedMovePct);
  
  // WEAK: Very small move, inconclusive
  if (moveSize < THRESHOLDS.weakMove) {
    return 'WEAK';
  }
  
  // Check direction match
  const directionMatch = 
    (predictedDirection === 'UP' && actualDirection === 'UP') ||
    (predictedDirection === 'DOWN' && actualDirection === 'DOWN') ||
    (predictedDirection === 'FLAT' && actualDirection === 'FLAT');
  
  if (predictedDirection === 'FLAT') {
    // For FLAT prediction
    return actualDirection === 'FLAT' ? 'TN' : 'FN';
  }
  
  if (directionMatch) {
    return 'TP'; // True Positive - correct direction
  } else {
    return 'FP'; // False Positive - wrong direction
  }
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create outcome record for a prediction
 */
async function createOutcome(
  prediction: PredictionRecord,
  horizon: typeof HORIZONS[number]
): Promise<OutcomeRecord | null> {
  const horizonMs = HORIZON_MS[horizon];
  const targetTimestamp = prediction.timestamp + horizonMs;
  
  console.log(`[OutcomeTracker] Creating outcome for ${prediction.id}: price@pred=${prediction.priceAtPrediction}, targetTs=${targetTimestamp}`);
  
  // Get price at horizon
  const priceAtHorizon = await getPriceAtTimestamp(prediction.symbol, targetTimestamp);
  
  console.log(`[OutcomeTracker] Price at horizon: ${priceAtHorizon}`);
  
  if (!priceAtHorizon || !prediction.priceAtPrediction) {
    console.log(`[OutcomeTracker] Skipping - missing price data: horizon=${priceAtHorizon}, pred=${prediction.priceAtPrediction}`);
    return null;
  }
  
  // Calculate realized move
  const realizedMovePct = ((priceAtHorizon - prediction.priceAtPrediction) / prediction.priceAtPrediction) * 100;
  
  // Assign label
  const label = assignLabel(prediction.direction, realizedMovePct, prediction.expectedMovePct || 0);
  
  // Check direction correctness
  const actualDirection = realizedMovePct > 0.3 ? 'UP' : realizedMovePct < -0.3 ? 'DOWN' : 'FLAT';
  const directionCorrect = prediction.direction === actualDirection || 
    (prediction.direction === 'FLAT' && Math.abs(realizedMovePct) < 1);
  
  // Calculate deviation
  const deviationPct = Math.abs(realizedMovePct - (prediction.expectedMovePct || 0));
  
  const outcome: OutcomeRecord = {
    predictionId: prediction.id,
    symbol: prediction.symbol,
    timestamp: prediction.timestamp,
    horizon,
    priceAtPrediction: prediction.priceAtPrediction,
    priceAtHorizon,
    realizedMovePct: Math.round(realizedMovePct * 100) / 100,
    predictedMovePct: Math.round((prediction.expectedMovePct || 0) * 100) / 100,
    directionCorrect,
    label,
    deviationPct: Math.round(deviationPct * 100) / 100,
    createdAt: new Date(),
  };
  
  return outcome;
}

/**
 * Create learning sample from outcome
 */
function createLearningSample(
  prediction: PredictionRecord,
  outcome: OutcomeRecord
): LearningSample {
  // Extract features from prediction
  const features: Record<string, number> = {
    confidence: prediction.confidence,
    expectedMovePct: prediction.expectedMovePct || 0,
    priceAtPrediction: prediction.priceAtPrediction,
  };
  
  // Label: 1 if correct, 0 if wrong
  const label = outcome.label === 'TP' || outcome.label === 'TN' ? 1 : 0;
  
  // Weight: higher for clear outcomes
  let weight = 1.0;
  if (outcome.label === 'WEAK') weight = 0.5;
  if (outcome.label === 'FP') weight = 1.5; // Penalize false positives more
  
  return {
    predictionId: prediction.id,
    symbol: prediction.symbol,
    features,
    label,
    weight,
    horizon: outcome.horizon,
    createdAt: new Date(),
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN JOB
// ═══════════════════════════════════════════════════════════════

/**
 * Process one run of outcome tracking
 */
async function runOutcomeTracking(): Promise<{
  processed: number;
  created: number;
  errors: number;
}> {
  if (isRunning) {
    console.log('[OutcomeTracker] Already running, skipping');
    return { processed: 0, created: 0, errors: 0 };
  }
  
  isRunning = true;
  const startTime = Date.now();
  let processed = 0;
  let created = 0;
  let errors = 0;
  
  try {
    const db = await getDb();
    
    for (const horizon of HORIZONS) {
      console.log(`[OutcomeTracker] Processing horizon: ${horizon}`);
      
      const pendingPredictions = await getPendingPredictions(horizon);
      console.log(`[OutcomeTracker] Found ${pendingPredictions.length} pending predictions for ${horizon}`);
      
      for (const prediction of pendingPredictions) {
        try {
          const outcome = await createOutcome(prediction, horizon);
          
          if (outcome) {
            // Save outcome
            await db.collection('decision_outcomes').insertOne(outcome);
            
            // Create learning sample
            const sample = createLearningSample(prediction, outcome);
            await db.collection('learning_samples').insertOne(sample);
            
            created++;
            console.log(`[OutcomeTracker] Created outcome for ${prediction.symbol}/${horizon}: ${outcome.label} (${outcome.realizedMovePct}%)`);
          }
          
          processed++;
        } catch (error: any) {
          console.error(`[OutcomeTracker] Error processing ${prediction.id}:`, error.message);
          errors++;
        }
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[OutcomeTracker] Run complete: ${created} outcomes created, ${processed} processed, ${errors} errors, took ${duration}ms`);
    
  } finally {
    isRunning = false;
    lastRun = new Date();
    stats.processed += processed;
    stats.created += created;
    stats.errors += errors;
  }
  
  return { processed, created, errors };
}

// ═══════════════════════════════════════════════════════════════
// JOB CONTROL
// ═══════════════════════════════════════════════════════════════

export function startOutcomeTracker(): { success: boolean; message: string } {
  if (intervalId) {
    return { success: false, message: 'Tracker already running' };
  }
  
  console.log(`[OutcomeTracker] Starting (interval: ${PROCESSING_INTERVAL_MS / 1000}s)`);
  
  // Run immediately
  runOutcomeTracking();
  
  // Schedule periodic runs
  intervalId = setInterval(runOutcomeTracking, PROCESSING_INTERVAL_MS);
  
  return { success: true, message: `Started tracking every ${PROCESSING_INTERVAL_MS / 1000}s` };
}

export function stopOutcomeTracker(): { success: boolean; message: string } {
  if (!intervalId) {
    return { success: false, message: 'Tracker not running' };
  }
  
  clearInterval(intervalId);
  intervalId = null;
  
  console.log('[OutcomeTracker] Stopped');
  
  return { success: true, message: 'Tracker stopped' };
}

export function getOutcomeTrackerStatus(): {
  running: boolean;
  lastRun: Date | null;
  stats: { processed: number; created: number; errors: number };
} {
  return {
    running: intervalId !== null,
    lastRun,
    stats: { ...stats },
  };
}

export async function triggerOutcomeTracking(): Promise<{
  processed: number;
  created: number;
  errors: number;
}> {
  return runOutcomeTracking();
}

console.log('[OutcomeTracker] Module loaded');
