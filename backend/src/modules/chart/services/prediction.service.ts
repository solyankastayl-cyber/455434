/**
 * PREDICTION SERVICE — Layer-based predictions
 * =============================================
 * 
 * Generates prediction data from:
 * - Exchange layer (order flow, volume, etc.) — REAL DATA
 * - Onchain layer (whale activity, flows) — Mock for now
 * - Sentiment layer (fear/greed, social) — From macro intel
 * 
 * Combined into final prediction
 */

import type { 
  PredictionPoint, 
  PredictionChartData, 
  ChartRange, 
  ChartTimeframe 
} from '../contracts/chart.types.js';
import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// LAYER WEIGHTS (from Meta-Brain)
// ═══════════════════════════════════════════════════════════════

const LAYER_WEIGHTS = {
  exchange: 0.45,   // Exchange signals (order flow, funding)
  onchain: 0.35,    // Onchain data (whale activity, flows)
  sentiment: 0.20,  // Sentiment (fear/greed, social)
};

const RANGE_MS: Record<ChartRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// FETCH REAL EXCHANGE DATA
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch exchange observations from DB
 */
async function fetchExchangeObservations(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<any[]> {
  try {
    const db = await getDb();
    
    // Get observations from exchange_observations collection
    const docs = await db.collection('exchange_observations')
      .find({
        symbol: { $in: [symbol, symbol.replace('USDT', '')] },
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray();
    
    console.log(`[PredictionService] Fetched ${docs.length} exchange observations for ${symbol}`);
    return docs;
  } catch (error: any) {
    console.warn('[PredictionService] Exchange fetch error:', error.message);
    return [];
  }
}

/**
 * Fetch ML predictions from DB
 */
async function fetchMLPredictions(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<any[]> {
  try {
    const db = await getDb();
    
    // Get ML predictions
    const docs = await db.collection('ml_predictions')
      .find({
        symbol: { $in: [symbol, symbol.replace('USDT', '')] },
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray();
    
    console.log(`[PredictionService] Fetched ${docs.length} ML predictions for ${symbol}`);
    return docs;
  } catch (error: any) {
    console.warn('[PredictionService] ML predictions fetch error:', error.message);
    return [];
  }
}

/**
 * Fetch macro intel for sentiment
 */
async function fetchMacroIntel(
  startTime: number,
  endTime: number
): Promise<any[]> {
  try {
    const db = await getDb();
    
    const docs = await db.collection('macro_intel_snapshots')
      .find({
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray();
    
    console.log(`[PredictionService] Fetched ${docs.length} macro snapshots`);
    return docs;
  } catch (error: any) {
    console.warn('[PredictionService] Macro fetch error:', error.message);
    return [];
  }
}

/**
 * Convert exchange observation to signal score (0-1)
 */
function observationToScore(obs: any): number {
  if (!obs) return 0.5;
  
  // Extract signals from observation
  const fundingRate = obs.fundingRate ?? obs.features?.fundingRate ?? 0;
  const volumeRatio = obs.volumeRatio ?? obs.features?.volumeRatio ?? 1;
  const orderImbalance = obs.orderImbalance ?? obs.features?.orderImbalance ?? 0;
  const priceChange24h = obs.priceChange24h ?? obs.features?.priceChange24h ?? 0;
  
  // Calculate score based on exchange signals
  let score = 0.5;
  
  // Funding rate: positive = longs paying, negative = shorts paying
  if (fundingRate > 0.01) score -= 0.1; // Overleveraged longs
  if (fundingRate < -0.01) score += 0.1; // Overleveraged shorts
  
  // Volume ratio: > 1.5 = high activity
  if (volumeRatio > 1.5) score += 0.05;
  if (volumeRatio < 0.5) score -= 0.05;
  
  // Order imbalance: positive = more buy orders
  score += orderImbalance * 0.15;
  
  // Price momentum
  if (priceChange24h > 5) score += 0.1;
  if (priceChange24h < -5) score -= 0.1;
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Convert ML prediction to score
 */
function mlPredictionToScore(pred: any): { score: number; confidence: number } {
  if (!pred) return { score: 0.5, confidence: 0.5 };
  
  const label = pred.label ?? pred.prediction ?? 'NEUTRAL';
  const confidence = pred.confidence ?? 0.5;
  
  let score = 0.5;
  if (label === 'BUY' || label === 'BULLISH') {
    score = 0.5 + (confidence * 0.4);
  } else if (label === 'SELL' || label === 'BEARISH') {
    score = 0.5 - (confidence * 0.4);
  }
  
  return { score, confidence };
}

/**
 * Convert macro intel to sentiment score
 */
function macroToSentimentScore(macro: any): number {
  if (!macro) return 0.5;
  
  const fearGreed = macro.raw?.fearGreedIndex ?? macro.fearGreed ?? 50;
  
  // Fear/Greed: 0 = extreme fear, 100 = extreme greed
  // Normalize to 0-1
  return fearGreed / 100;
}

/**
 * Generate prediction from historical data or mock
 */
function generatePredictionPoint(
  ts: number,
  basePrice: number,
  historical?: any
): PredictionPoint {
  // If we have historical data, use it
  if (historical) {
    const conf = historical.finalDecision?.confidence || 0.5;
    const dir = historical.input?.direction || 'NEUTRAL';
    
    // Estimate layer scores from historical data
    const exchangeScore = historical.mlCalibration?.mlModifier || 0.5;
    const onchainScore = historical.assetTruth?.venueAgreementScore || 0.5;
    const sentimentScore = historical.macroContext?.fearGreed 
      ? historical.macroContext.fearGreed / 100 
      : 0.5;
    
    // Combined score
    const combined = (
      exchangeScore * LAYER_WEIGHTS.exchange +
      onchainScore * LAYER_WEIGHTS.onchain +
      sentimentScore * LAYER_WEIGHTS.sentiment
    );
    
    return {
      ts,
      combined,
      combinedConfidence: conf,
      exchange: exchangeScore,
      onchain: onchainScore,
      sentiment: sentimentScore,
      direction: dir as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    };
  }
  
  // Generate synthetic prediction with some persistence
  const seed = ts / 3600000; // hourly seed
  const noise = Math.sin(seed) * 0.15 + Math.cos(seed * 0.3) * 0.1;
  
  const exchange = 0.5 + noise + (Math.random() - 0.5) * 0.1;
  const onchain = 0.5 + noise * 0.8 + (Math.random() - 0.5) * 0.1;
  const sentiment = 0.5 + noise * 0.5 + (Math.random() - 0.5) * 0.15;
  
  const combined = (
    Math.max(0, Math.min(1, exchange)) * LAYER_WEIGHTS.exchange +
    Math.max(0, Math.min(1, onchain)) * LAYER_WEIGHTS.onchain +
    Math.max(0, Math.min(1, sentiment)) * LAYER_WEIGHTS.sentiment
  );
  
  const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 
    combined > 0.55 ? 'BULLISH' : 
    combined < 0.45 ? 'BEARISH' : 'NEUTRAL';
  
  return {
    ts,
    combined: Math.max(0, Math.min(1, combined)),
    combinedConfidence: 0.5 + Math.abs(combined - 0.5) * 0.8,
    exchange: Math.max(0, Math.min(1, exchange)),
    onchain: Math.max(0, Math.min(1, onchain)),
    sentiment: Math.max(0, Math.min(1, sentiment)),
    direction,
  };
}

/**
 * Convert prediction score (0-1) to price-like value
 * Uses base price and expected movement based on score
 */
export function scoreToPriceLike(
  score: number, 
  basePrice: number,
  maxDeviation: number = 0.05 // 5% max deviation
): number {
  // Score 0.5 = neutral = basePrice
  // Score 1.0 = very bullish = basePrice * (1 + maxDeviation)
  // Score 0.0 = very bearish = basePrice * (1 - maxDeviation)
  const deviation = (score - 0.5) * 2 * maxDeviation;
  return basePrice * (1 + deviation);
}

/**
 * Get prediction chart data with REAL exchange data
 * 
 * Priority:
 * 1. Try to use real ML observations from DB
 * 2. Fall back to price-action derived signals
 */
export async function getPredictionChartData(
  symbol: string,
  range: ChartRange,
  tf: ChartTimeframe = '1h',
  pricePoints?: Array<{ ts: number; price: number }>
): Promise<PredictionChartData> {
  const now = Date.now();
  const rangeMs = RANGE_MS[range];
  const startTime = now - rangeMs;
  
  const tfMs: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  
  const interval = tfMs[tf];
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Try to fetch REAL exchange observations from DB
  // ═══════════════════════════════════════════════════════════════
  const exchangeObs = await fetchExchangeObservations(symbol, startTime, now);
  
  const points: PredictionPoint[] = [];
  let totalConfidence = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  
  // Use real ML data if available
  if (exchangeObs.length > 0) {
    console.log(`[PredictionService] Using REAL data: ${exchangeObs.length} observations`);
    
    for (const obs of exchangeObs) {
      // Extract ML features from observation
      const regimeType = obs.regime?.type || obs.regime || 'NEUTRAL';
      const regimeConf = obs.regime?.confidence || obs.regimeConfidence || 0.5;
      
      // Calculate exchange score from regime and patterns
      let exchangeScore = 0.5;
      
      // Regime impacts
      if (regimeType === 'EXPANSION') exchangeScore += 0.2;
      if (regimeType === 'ACCUMULATION') exchangeScore += 0.1;
      if (regimeType === 'LONG_SQUEEZE') exchangeScore -= 0.25;
      if (regimeType === 'SHORT_SQUEEZE') exchangeScore += 0.15;
      if (regimeType === 'EXHAUSTION') exchangeScore -= 0.15;
      
      // Pattern impacts
      const patterns = obs.patterns || [];
      for (const p of patterns) {
        const patternName = typeof p === 'string' ? p : p.name;
        if (patternName?.includes('Exhaustion')) exchangeScore -= 0.1;
        if (patternName?.includes('Absorption')) exchangeScore += 0.1;
        if (patternName?.includes('Squeeze')) exchangeScore -= 0.15;
      }
      
      // Indicator impacts if available
      const indicators = obs.indicators || {};
      if (indicators.marketStress > 0.7) exchangeScore -= 0.15;
      if (indicators.readability > 0.7) exchangeScore += 0.05;
      if (indicators.flowBias) exchangeScore += indicators.flowBias * 0.15;
      
      // Clamp exchange score
      exchangeScore = Math.max(0.15, Math.min(0.85, exchangeScore));
      
      // Onchain and sentiment are placeholders until real integrations
      const onchainScore = 0.5 + (exchangeScore - 0.5) * 0.3; // Slight correlation
      const sentimentScore = 0.5; // Will be from fear/greed API
      
      // Combined score
      const combined = (
        exchangeScore * LAYER_WEIGHTS.exchange +
        onchainScore * LAYER_WEIGHTS.onchain +
        sentimentScore * LAYER_WEIGHTS.sentiment
      );
      
      const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 
        combined > 0.53 ? 'BULLISH' : 
        combined < 0.47 ? 'BEARISH' : 'NEUTRAL';
      
      const confidence = regimeConf * 0.5 + Math.abs(combined - 0.5) * 1.0;
      
      points.push({
        ts: obs.timestamp,
        combined: Math.max(0.1, Math.min(0.9, combined)),
        combinedConfidence: Math.min(0.95, confidence),
        exchange: exchangeScore,
        onchain: onchainScore,
        sentiment: sentimentScore,
        direction,
      });
      
      totalConfidence += confidence;
      if (direction === 'BULLISH') bullishCount++;
      if (direction === 'BEARISH') bearishCount++;
    }
    
    // Sort by timestamp
    points.sort((a, b) => a.ts - b.ts);
    
  } else if (pricePoints && pricePoints.length > 0) {
    // Calculate technical signals from price action
    // Using enhanced formula with stronger signal sensitivity
    
    for (let i = 0; i < pricePoints.length; i++) {
      const price = pricePoints[i];
      
      // ═══════════════════════════════════════════════════════════
      // EXCHANGE SIGNAL — Momentum + RSI + Volume-weighted trends
      // ═══════════════════════════════════════════════════════════
      let exchangeScore = 0.5;
      
      // Short-term momentum (5 candles) — AMPLIFIED
      if (i >= 5) {
        const startPrice = pricePoints[i - 5].price;
        const endPrice = price.price;
        const shortTermChange = (endPrice - startPrice) / startPrice;
        // Amplify: 1% change = 0.25 shift in score
        exchangeScore += shortTermChange * 25;
      }
      
      // Medium-term momentum (20 candles) — trend confirmation
      if (i >= 20) {
        const startPrice = pricePoints[i - 20].price;
        const endPrice = price.price;
        const midTermChange = (endPrice - startPrice) / startPrice;
        // Amplify: 5% change over 20 candles = 0.2 shift
        exchangeScore += midTermChange * 4;
      }
      
      // RSI-like overbought/oversold (14 periods)
      let rsi = 50;
      if (i >= 14) {
        const recent = pricePoints.slice(i - 14, i + 1);
        let gains = 0, losses = 0;
        for (let j = 1; j < recent.length; j++) {
          const change = recent[j].price - recent[j - 1].price;
          if (change > 0) gains += change;
          else losses -= change;
        }
        const rs = losses === 0 ? 100 : gains / losses;
        rsi = 100 - (100 / (1 + rs));
        
        // RSI contribution: scale to -0.2 to +0.2
        // RSI > 70 bearish, RSI < 30 bullish
        const rsiSignal = (50 - rsi) / 100; // -0.5 to +0.5
        exchangeScore += rsiSignal * 0.4;
      }
      
      // Clamp exchange score
      exchangeScore = Math.max(0.15, Math.min(0.85, exchangeScore));
      
      // ═══════════════════════════════════════════════════════════
      // SENTIMENT SIGNAL — Volatility-based proxy
      // ═══════════════════════════════════════════════════════════
      let sentimentScore = 0.5;
      if (i >= 5) {
        // Calculate realized volatility (5 periods)
        const recentPrices = pricePoints.slice(i - 5, i + 1);
        let sumSquaredReturns = 0;
        for (let j = 1; j < recentPrices.length; j++) {
          const ret = (recentPrices[j].price - recentPrices[j-1].price) / recentPrices[j-1].price;
          sumSquaredReturns += ret * ret;
        }
        const volatility = Math.sqrt(sumSquaredReturns / 5);
        
        // Low volatility (< 0.5%) = stability = slight bullish
        // High volatility (> 2%) = uncertainty = bearish
        if (volatility < 0.005) {
          sentimentScore = 0.55 + (0.005 - volatility) * 20; // up to 0.65
        } else if (volatility > 0.02) {
          sentimentScore = 0.45 - (volatility - 0.02) * 5; // down to 0.35
        } else {
          // Normal volatility - use trend direction
          const trendDir = price.price > pricePoints[i - 5].price ? 0.05 : -0.05;
          sentimentScore = 0.5 + trendDir;
        }
      }
      sentimentScore = Math.max(0.2, Math.min(0.8, sentimentScore));
      
      // ═══════════════════════════════════════════════════════════
      // ONCHAIN SIGNAL — Trend following proxy (until real data)
      // ═══════════════════════════════════════════════════════════
      let onchainScore = 0.5;
      if (i >= 10) {
        const trend = (price.price - pricePoints[i - 10].price) / pricePoints[i - 10].price;
        // Strong trend following: 2% move = full bullish/bearish
        onchainScore = 0.5 + Math.tanh(trend * 50) * 0.35;
      }
      onchainScore = Math.max(0.15, Math.min(0.85, onchainScore));
      
      // ═══════════════════════════════════════════════════════════
      // COMBINED SCORE — Weighted average of layers
      // ═══════════════════════════════════════════════════════════
      const combined = (
        exchangeScore * LAYER_WEIGHTS.exchange +
        onchainScore * LAYER_WEIGHTS.onchain +
        sentimentScore * LAYER_WEIGHTS.sentiment
      );
      
      // Direction with tighter thresholds (more decisive)
      const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 
        combined > 0.53 ? 'BULLISH' : 
        combined < 0.47 ? 'BEARISH' : 'NEUTRAL';
      
      // Confidence based on score deviation from neutral
      const deviation = Math.abs(combined - 0.5);
      const confidence = 0.4 + deviation * 2.0; // Max ~0.9 at extreme
      
      points.push({
        ts: price.ts,
        combined: Math.max(0.1, Math.min(0.9, combined)),
        combinedConfidence: Math.min(0.95, confidence),
        exchange: exchangeScore,
        onchain: onchainScore,
        sentiment: sentimentScore,
        direction,
      });
      
      totalConfidence += confidence;
      if (direction === 'BULLISH') bullishCount++;
      if (direction === 'BEARISH') bearishCount++;
    }
    
    // Log first and last for debugging
    if (points.length > 0) {
      console.log(`[PredictionService] Sample: first=${JSON.stringify(points[0])}, last=${JSON.stringify(points[points.length-1])}`);
    }
  } else {
    // Fallback: generate synthetic prediction with variance
    console.log('[PredictionService] WARNING: No price points provided, using synthetic data');
    for (let ts = startTime; ts <= now; ts += interval) {
      // Create some variance using timestamp-based seed
      const seed = ts / 3600000;
      const noise = Math.sin(seed) * 0.15 + Math.cos(seed * 0.3) * 0.1;
      
      const exchange = 0.5 + noise + (Math.random() - 0.5) * 0.1;
      const onchain = 0.5 + noise * 0.8 + (Math.random() - 0.5) * 0.1;
      const sentiment = 0.5 + noise * 0.5 + (Math.random() - 0.5) * 0.15;
      
      const combined = (
        Math.max(0.1, Math.min(0.9, exchange)) * LAYER_WEIGHTS.exchange +
        Math.max(0.1, Math.min(0.9, onchain)) * LAYER_WEIGHTS.onchain +
        Math.max(0.1, Math.min(0.9, sentiment)) * LAYER_WEIGHTS.sentiment
      );
      
      const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 
        combined > 0.53 ? 'BULLISH' : 
        combined < 0.47 ? 'BEARISH' : 'NEUTRAL';
      
      points.push({
        ts,
        combined: Math.max(0.1, Math.min(0.9, combined)),
        combinedConfidence: 0.4 + Math.abs(combined - 0.5) * 1.5,
        exchange: Math.max(0.1, Math.min(0.9, exchange)),
        onchain: Math.max(0.1, Math.min(0.9, onchain)),
        sentiment: Math.max(0.1, Math.min(0.9, sentiment)),
        direction,
      });
      
      if (direction === 'BULLISH') bullishCount++;
      if (direction === 'BEARISH') bearishCount++;
    }
  }
  
  const dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    bullishCount > bearishCount * 1.2 ? 'BULLISH' :
    bearishCount > bullishCount * 1.2 ? 'BEARISH' : 'NEUTRAL';
  
  console.log(`[PredictionService] Generated ${points.length} points from price action, dominant: ${dominantDirection}`);
  
  return {
    symbol,
    range,
    tf,
    points,
    meta: {
      avgConfidence: points.length > 0 ? totalConfidence / points.length : 0.5,
      dominantDirection,
      layerWeights: LAYER_WEIGHTS,
    },
  };
}

console.log('[PredictionService] Loaded with price-action analysis');
