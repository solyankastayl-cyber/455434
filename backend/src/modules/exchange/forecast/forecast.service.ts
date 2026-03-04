/**
 * FORECAST SERVICE — Creates and manages price forecasts
 * ======================================================
 * 
 * Key responsibilities:
 * 1. Create forecasts with proper targetPrice calculation
 * 2. Calculate confidence bands based on volatility
 * 3. Integrate with verdict engine for direction/strength
 * 
 * Formula for expectedMovePct:
 *   expectedMovePct = strength × volatilityMultiplier
 *   where volatilityMultiplier = ATR × scaleFactor
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../../../db/mongodb.js';
import {
  ForecastEvent,
  ForecastDirection,
  ForecastHorizon,
  CreateForecastInput,
} from './forecast.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION = 'exchange_forecasts';
const MODEL_VERSION = 'v1.0.0';

// Horizon in milliseconds
const HORIZON_MS: Record<ForecastHorizon, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

// Default volatility if not provided (3.5% daily)
const DEFAULT_VOLATILITY = 0.035;

// Layer weights for meta calculation
const LAYER_WEIGHTS = {
  exchange: 0.45,
  onchain: 0.35,
  sentiment: 0.20,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Horizon multipliers for expected move (Block 21)
const HORIZON_MOVE_MULTIPLIER: Record<ForecastHorizon, number> = {
  '1D': 1.0,
  '7D': 2.5,   // ~sqrt(7) for volatility scaling
  '30D': 5.0,  // ~sqrt(30) for volatility scaling
};

/**
 * Calculate expected move percentage based on strength, volatility, and horizon
 * 
 * Formula: expectedMovePct = volatility × (0.5 + strength × 1.5) × horizonMultiplier
 * 
 * Examples (1D):
 * - strength=0.5, vol=3% → move = 3% × (0.5 + 0.75) = 3.75%
 * - strength=0.8, vol=3% → move = 3% × (0.5 + 1.2) = 5.1%
 * 
 * Examples (7D):
 * - strength=0.5, vol=3% → move = 3% × 1.25 × 2.5 = 9.4%
 */
function calculateExpectedMovePct(
  strength: number,
  volatility: number,
  direction: ForecastDirection,
  horizon: ForecastHorizon = '1D'
): number {
  const vol = volatility || DEFAULT_VOLATILITY;
  const s = clamp(strength, 0, 1);
  const horizonMult = HORIZON_MOVE_MULTIPLIER[horizon] || 1.0;
  
  // Base move calculation with horizon scaling
  const moveMultiplier = 0.5 + s * 1.5; // 0.5 to 2.0
  let movePct = vol * 100 * moveMultiplier * horizonMult;
  
  // Cap at reasonable values (scaled by horizon)
  const maxMove = 15 * horizonMult;
  movePct = clamp(movePct, 0.5, maxMove);
  
  // Apply direction sign
  if (direction === 'DOWN') {
    movePct = -movePct;
  } else if (direction === 'FLAT') {
    movePct = 0;
  }
  
  return Math.round(movePct * 100) / 100; // 2 decimal places
}

/**
 * Calculate band width based on confidence and volatility
 * 
 * Lower confidence = wider band
 * Higher volatility = wider band
 */
function calculateBandWidthPct(
  confidence: number,
  volatility: number
): number {
  const vol = volatility || DEFAULT_VOLATILITY;
  const conf = clamp(confidence, 0, 1);
  
  // Band width: wider when less confident
  // Base: volatility × (1.2 - confidence)
  const bandPct = vol * 100 * (1.2 - conf * 0.4);
  
  // Clamp to reasonable range (0.8% to 8%)
  return clamp(Math.round(bandPct * 100) / 100, 0.8, 8);
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new forecast
 */
export async function createForecast(
  input: CreateForecastInput,
  horizon: ForecastHorizon = '1D'
): Promise<ForecastEvent> {
  const db = getDb();
  const now = Date.now();
  
  const asset = input.asset.toUpperCase().replace('USDT', '');
  const symbol = asset + 'USDT';
  
  const direction = input.direction;
  const confidence = clamp(input.confidence, 0, 1);
  const strength = clamp(input.strength, 0, 1);
  const volatility = input.volatility || DEFAULT_VOLATILITY;
  
  // Calculate expected move (Block 21: horizon-aware)
  const expectedMovePct = calculateExpectedMovePct(strength, volatility, direction, horizon);
  
  // Calculate target price
  const targetPrice = input.currentPrice * (1 + expectedMovePct / 100);
  
  // Calculate confidence band (wider for longer horizons)
  const horizonBandMult = HORIZON_MOVE_MULTIPLIER[horizon] || 1.0;
  const baseBandWidthPct = calculateBandWidthPct(confidence, volatility);
  const bandWidthPct = baseBandWidthPct * Math.sqrt(horizonBandMult);
  const upperBand = targetPrice * (1 + bandWidthPct / 100);
  const lowerBand = targetPrice * (1 - bandWidthPct / 100);
  
  // Build layer data
  const exchangeScore = input.layers?.exchange?.score ?? 0.5;
  const onchainScore = input.layers?.onchain?.score;
  const sentimentScore = input.layers?.sentiment?.score;
  
  const layers: ForecastEvent['layers'] = {
    exchange: {
      score: exchangeScore,
      contribution: LAYER_WEIGHTS.exchange,
    },
  };
  
  if (onchainScore !== undefined) {
    layers.onchain = {
      score: onchainScore,
      contribution: LAYER_WEIGHTS.onchain,
    };
  }
  
  if (sentimentScore !== undefined) {
    layers.sentiment = {
      score: sentimentScore,
      contribution: LAYER_WEIGHTS.sentiment,
    };
  }
  
  // Create forecast document
  const forecast: ForecastEvent = {
    id: uuid(),
    asset,
    symbol,
    horizon,
    
    createdAt: now,
    evaluateAfter: now + HORIZON_MS[horizon],
    
    basePrice: input.currentPrice,
    targetPrice: Math.round(targetPrice * 100) / 100,
    expectedMovePct,
    
    upperBand: Math.round(upperBand * 100) / 100,
    lowerBand: Math.round(lowerBand * 100) / 100,
    bandWidthPct,
    
    direction,
    confidence,
    strength,
    
    volatilitySnapshot: volatility,
    regimeAtCreation: input.regime,
    
    layers,
    
    evaluated: false,
    modelVersion: MODEL_VERSION,
    source: 'auto',
  };
  
  // Save to database
  await db.collection(COLLECTION).insertOne(forecast as any);
  
  console.log(
    `[Forecast] Created: ${symbol} ${direction} ` +
    `target=${forecast.targetPrice} (${expectedMovePct > 0 ? '+' : ''}${expectedMovePct}%) ` +
    `band=[${forecast.lowerBand}, ${forecast.upperBand}] ` +
    `conf=${confidence.toFixed(2)}`
  );
  
  return forecast;
}

/**
 * Check if forecast already exists (to avoid duplicates)
 */
export async function hasPendingForecast(
  asset: string,
  horizon: ForecastHorizon = '1D'
): Promise<boolean> {
  const db = getDb();
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  const existing = await db.collection(COLLECTION).findOne({
    asset: assetNorm,
    horizon,
    evaluated: false,
  });
  
  return existing !== null;
}

/**
 * Create forecast only if none pending
 */
export async function createForecastIfNeeded(
  input: CreateForecastInput,
  horizon: ForecastHorizon = '1D'
): Promise<ForecastEvent | null> {
  const hasPending = await hasPendingForecast(input.asset, horizon);
  
  if (hasPending) {
    console.log(`[Forecast] Skipping: pending forecast exists for ${input.asset}`);
    return null;
  }
  
  return createForecast(input, horizon);
}

/**
 * Create forecast from verdict data
 */
export async function createForecastFromVerdict(
  symbol: string,
  verdict: {
    verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    strength: 'WEAK' | 'MEDIUM' | 'STRONG';
    axisContrib: {
      momentum: number;
      structure: number;
      participation: number;
      orderbookPressure: number;
      positioning: number;
      marketStress: number;
    };
  },
  currentPrice: number,
  volatility?: number
): Promise<ForecastEvent | null> {
  // Map verdict to direction
  const direction: ForecastDirection =
    verdict.verdict === 'BULLISH' ? 'UP' :
    verdict.verdict === 'BEARISH' ? 'DOWN' : 'FLAT';
  
  // Skip FLAT/NEUTRAL with low confidence
  if (direction === 'FLAT' && verdict.confidence < 0.4) {
    console.log(`[Forecast] Skipping: FLAT with low confidence (${verdict.confidence})`);
    return null;
  }
  
  // Map strength to numeric
  const strengthMap = { WEAK: 0.3, MEDIUM: 0.55, STRONG: 0.8 };
  const strength = strengthMap[verdict.strength] || 0.5;
  
  // Calculate exchange score from axes
  const axes = verdict.axisContrib;
  const exchangeScore = 0.5 + (
    axes.momentum * 0.25 +
    axes.structure * 0.2 +
    axes.orderbookPressure * 0.2 +
    (1 - axes.marketStress) * 0.15 +
    axes.participation * 0.1 +
    (1 - axes.positioning) * 0.1
  ) * 0.5;
  
  return createForecastIfNeeded({
    asset: symbol,
    currentPrice,
    direction,
    confidence: verdict.confidence,
    strength,
    volatility,
    layers: {
      exchange: { score: clamp(exchangeScore, 0, 1) },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// MULTI-HORIZON FORECAST CREATION (Block H1)
// ═══════════════════════════════════════════════════════════════

const ALL_HORIZONS: ForecastHorizon[] = ['1D', '7D', '30D'];

/**
 * Confidence decay by horizon
 * Longer horizons naturally have lower confidence
 */
const HORIZON_CONFIDENCE_DECAY: Record<ForecastHorizon, number> = {
  '1D': 1.0,    // No decay
  '7D': 0.85,   // 15% confidence reduction
  '30D': 0.70,  // 30% confidence reduction
};

/**
 * Create forecasts for ALL horizons (1D, 7D, 30D) from same input
 * Each horizon gets:
 * - Different expectedMovePct (scaled by sqrt(horizon))
 * - Different confidence (decayed for longer horizons)
 * - Different band width (wider for longer horizons)
 */
export async function createMultiHorizonForecasts(
  input: CreateForecastInput
): Promise<{ created: ForecastHorizon[]; skipped: ForecastHorizon[] }> {
  const created: ForecastHorizon[] = [];
  const skipped: ForecastHorizon[] = [];
  
  for (const horizon of ALL_HORIZONS) {
    // Check if already pending
    const hasPending = await hasPendingForecast(input.asset, horizon);
    
    if (hasPending) {
      skipped.push(horizon);
      continue;
    }
    
    // Apply confidence decay for longer horizons
    const decayedConfidence = input.confidence * HORIZON_CONFIDENCE_DECAY[horizon];
    
    // Create forecast with adjusted confidence
    const adjustedInput: CreateForecastInput = {
      ...input,
      confidence: Math.max(0.3, decayedConfidence), // Minimum 30% confidence
    };
    
    await createForecast(adjustedInput, horizon);
    created.push(horizon);
  }
  
  console.log(
    `[Forecast] Multi-horizon: ${input.asset} created=[${created.join(',')}] skipped=[${skipped.join(',')}]`
  );
  
  return { created, skipped };
}

/**
 * Create multi-horizon forecasts from verdict
 */
export async function createMultiHorizonForecastsFromVerdict(
  symbol: string,
  verdict: {
    verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    strength: 'WEAK' | 'MEDIUM' | 'STRONG';
    axisContrib: {
      momentum: number;
      structure: number;
      participation: number;
      orderbookPressure: number;
      positioning: number;
      marketStress: number;
    };
  },
  currentPrice: number,
  volatility?: number
): Promise<{ created: ForecastHorizon[]; skipped: ForecastHorizon[] }> {
  // Map verdict to direction
  const direction: ForecastDirection =
    verdict.verdict === 'BULLISH' ? 'UP' :
    verdict.verdict === 'BEARISH' ? 'DOWN' : 'FLAT';
  
  // Skip FLAT/NEUTRAL with low confidence
  if (direction === 'FLAT' && verdict.confidence < 0.4) {
    console.log(`[Forecast] Skipping all horizons: FLAT with low confidence (${verdict.confidence})`);
    return { created: [], skipped: ALL_HORIZONS };
  }
  
  // Map strength to numeric
  const strengthMap = { WEAK: 0.3, MEDIUM: 0.55, STRONG: 0.8 };
  const strength = strengthMap[verdict.strength] || 0.5;
  
  // Calculate exchange score from axes
  const axes = verdict.axisContrib;
  const exchangeScore = 0.5 + (
    axes.momentum * 0.25 +
    axes.structure * 0.2 +
    axes.orderbookPressure * 0.2 +
    (1 - axes.marketStress) * 0.15 +
    axes.participation * 0.1 +
    (1 - axes.positioning) * 0.1
  ) * 0.5;
  
  return createMultiHorizonForecasts({
    asset: symbol,
    currentPrice,
    direction,
    confidence: verdict.confidence,
    strength,
    volatility,
    layers: {
      exchange: { score: clamp(exchangeScore, 0, 1) },
    },
  });
}

console.log('[Forecast] Service loaded');
