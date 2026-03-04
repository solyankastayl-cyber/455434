/**
 * PRICE VS EXPECTATION — Композитный endpoint для графика
 * =======================================================
 * 
 * Единственный источник данных для UI Price vs Expectation.
 * UI НЕ ДОЛЖЕН сам вычислять prediction/deviation.
 * 
 * Возвращает:
 * - Real price (from exchange providers)
 * - Exchange predictions (from ML pipeline)
 * - Expectation line (calculated from predictions)
 * - Outcome markers (TP/FP/FN/WEAK)
 * - Accuracy metrics
 */

import { FastifyInstance } from 'fastify';
import { getPriceChartData, getCurrentPrice } from './services/price.service.js';
import { getDb } from '../../db/mongodb.js';
import type { ChartRange, ChartTimeframe } from './contracts/chart.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PredictionEvent {
  t: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  strength: 'WEAK' | 'MID' | 'STRONG';
  regime?: string;
  expectedMovePct?: number;
}

interface ExpectationPoint {
  t: number;
  y: number; // predicted price
}

interface OutcomeEvent {
  t: number;
  horizon: '1h' | '4h' | '24h';
  label: 'TP' | 'FP' | 'FN' | 'WEAK';
  realizedMovePct: number;
  predictedMovePct: number;
  directionMatch: boolean;
}

interface PriceVsExpectationResponse {
  ok: boolean;
  asset: string;
  tf: string;
  range: string;
  
  price: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
  
  layers: {
    exchange: {
      predictions: PredictionEvent[];
      expectationLine: ExpectationPoint[];
    };
    combined: {
      predictions: PredictionEvent[];
      expectationLine: ExpectationPoint[];
    };
  };
  
  outcomes: OutcomeEvent[];
  
  metrics: {
    directionMatch: number;
    hitRate: number;
    avgDeviationPct: number;
    accuracyWindow: string;
    sampleCount: number;
  };
  
  signalChanges: {
    buy: number;
    sell: number;
    avoid: number;
  };
  
  topDrivers: {
    exchange: number;
    onchain: number;
    sentiment: number;
  };
  
  flags: {
    onchainEnabled: boolean;
    sentimentEnabled: boolean;
    dataSource: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA FETCHERS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch exchange observations with ML predictions
 */
async function fetchExchangePredictions(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<PredictionEvent[]> {
  try {
    const db = await getDb();
    
    const docs = await db.collection('exchange_observations')
      .find({
        symbol: { $in: [symbol, symbol.replace('USDT', '')] },
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray();
    
    return docs.map(doc => {
      const regime = doc.regime?.type || doc.regime || 'NEUTRAL';
      const regimeConf = doc.regime?.confidence || doc.regimeConfidence || 0.5;
      const patterns = doc.patterns || [];
      const indicators = doc.indicators || {};
      
      // Calculate direction from regime and patterns
      let score = 0.5;
      
      // Regime impacts
      if (regime === 'EXPANSION') score += 0.2;
      if (regime === 'ACCUMULATION') score += 0.1;
      if (regime === 'LONG_SQUEEZE') score -= 0.25;
      if (regime === 'SHORT_SQUEEZE') score += 0.15;
      if (regime === 'EXHAUSTION') score -= 0.15;
      
      // Pattern impacts
      for (const p of patterns) {
        const name = typeof p === 'string' ? p : p.name;
        if (name?.includes('Exhaustion')) score -= 0.1;
        if (name?.includes('Absorption')) score += 0.1;
        if (name?.includes('Squeeze')) score -= 0.15;
      }
      
      // Flow bias
      if (indicators.flowBias) score += indicators.flowBias * 0.15;
      
      score = Math.max(0.1, Math.min(0.9, score));
      
      const direction: 'UP' | 'DOWN' | 'FLAT' = 
        score > 0.55 ? 'UP' : score < 0.45 ? 'DOWN' : 'FLAT';
      
      const strength: 'WEAK' | 'MID' | 'STRONG' =
        Math.abs(score - 0.5) > 0.25 ? 'STRONG' :
        Math.abs(score - 0.5) > 0.1 ? 'MID' : 'WEAK';
      
      // Expected move based on confidence and regime
      let expectedMovePct = (score - 0.5) * 4; // -2% to +2% range
      if (regime === 'EXPANSION' || regime === 'SQUEEZE') {
        expectedMovePct *= 1.5; // Amplify in volatile regimes
      }
      
      return {
        t: doc.timestamp,
        direction,
        confidence: regimeConf,
        strength,
        regime,
        expectedMovePct: Math.round(expectedMovePct * 100) / 100,
      };
    });
  } catch (error: any) {
    console.error('[PriceVsExpectation] Fetch predictions error:', error.message);
    return [];
  }
}

/**
 * Fetch decision outcomes for accuracy calculation
 */
async function fetchOutcomes(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<OutcomeEvent[]> {
  try {
    const db = await getDb();
    
    const docs = await db.collection('decision_outcomes')
      .find({
        symbol: { $in: [symbol, symbol.replace('USDT', '')] },
        timestamp: { $gte: startTime, $lte: endTime },
      })
      .sort({ timestamp: 1 })
      .limit(200)
      .toArray();
    
    return docs.map(doc => ({
      t: doc.timestamp,
      horizon: doc.horizon || '1h',
      label: doc.label || 'WEAK',
      realizedMovePct: doc.realizedMovePct || 0,
      predictedMovePct: doc.predictedMovePct || 0,
      directionMatch: doc.directionCorrect || false,
    }));
  } catch (error: any) {
    console.error('[PriceVsExpectation] Fetch outcomes error:', error.message);
    return [];
  }
}

/**
 * Build expectation line from predictions
 */
function buildExpectationLine(
  predictions: PredictionEvent[],
  priceAtTime: Map<number, number>
): ExpectationPoint[] {
  const line: ExpectationPoint[] = [];
  
  for (const pred of predictions) {
    const basePrice = priceAtTime.get(pred.t);
    if (!basePrice) continue;
    
    const expectedMove = pred.expectedMovePct || 0;
    const predictedPrice = basePrice * (1 + expectedMove / 100);
    
    line.push({
      t: pred.t,
      y: Math.round(predictedPrice * 100) / 100,
    });
  }
  
  return line;
}

/**
 * Calculate accuracy metrics from outcomes
 */
function calculateMetrics(
  predictions: PredictionEvent[],
  outcomes: OutcomeEvent[],
  pricePoints: Array<{ t: number; c: number }>
): {
  directionMatch: number;
  hitRate: number;
  avgDeviationPct: number;
  sampleCount: number;
} {
  if (outcomes.length === 0 && predictions.length === 0) {
    return { directionMatch: 0, hitRate: 0, avgDeviationPct: 0, sampleCount: 0 };
  }
  
  // If we have outcomes, use them
  if (outcomes.length > 0) {
    const matches = outcomes.filter(o => o.directionMatch).length;
    const directionMatch = Math.round((matches / outcomes.length) * 100);
    
    const tps = outcomes.filter(o => o.label === 'TP').length;
    const hitRate = Math.round((tps / outcomes.length) * 100);
    
    const avgDev = outcomes.reduce((sum, o) => sum + Math.abs(o.realizedMovePct - o.predictedMovePct), 0) / outcomes.length;
    
    return {
      directionMatch,
      hitRate,
      avgDeviationPct: Math.round(avgDev * 100) / 100,
      sampleCount: outcomes.length,
    };
  }
  
  // Otherwise calculate from predictions vs price
  if (predictions.length > 1 && pricePoints.length > 1) {
    let correctDir = 0;
    let totalDev = 0;
    let count = 0;
    
    const priceMap = new Map(pricePoints.map(p => [p.t, p.c]));
    
    for (let i = 0; i < predictions.length - 1; i++) {
      const pred = predictions[i];
      const nextPred = predictions[i + 1];
      
      const priceAtPred = priceMap.get(pred.t);
      const priceAfter = priceMap.get(nextPred.t);
      
      if (!priceAtPred || !priceAfter) continue;
      
      const actualMove = ((priceAfter - priceAtPred) / priceAtPred) * 100;
      const expectedMove = pred.expectedMovePct || 0;
      
      // Direction match
      const actualDir = actualMove > 0.5 ? 'UP' : actualMove < -0.5 ? 'DOWN' : 'FLAT';
      if (actualDir === pred.direction || 
          (pred.direction === 'FLAT' && Math.abs(actualMove) < 1)) {
        correctDir++;
      }
      
      // Deviation
      totalDev += Math.abs(actualMove - expectedMove);
      count++;
    }
    
    return {
      directionMatch: count > 0 ? Math.round((correctDir / count) * 100) : 0,
      hitRate: count > 0 ? Math.round((correctDir / count) * 100) : 0,
      avgDeviationPct: count > 0 ? Math.round((totalDev / count) * 100) / 100 : 0,
      sampleCount: count,
    };
  }
  
  return { directionMatch: 50, hitRate: 50, avgDeviationPct: 0, sampleCount: 0 };
}

/**
 * Count signal changes
 */
function countSignalChanges(predictions: PredictionEvent[]): {
  buy: number;
  sell: number;
  avoid: number;
} {
  let buy = 0, sell = 0, avoid = 0;
  let lastDir: string | null = null;
  
  for (const pred of predictions) {
    if (pred.direction !== lastDir) {
      if (pred.direction === 'UP') buy++;
      else if (pred.direction === 'DOWN') sell++;
      else avoid++;
      lastDir = pred.direction;
    }
  }
  
  return { buy, sell, avoid };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function priceVsExpectationRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/market/chart/price-vs-expectation
   * 
   * Main endpoint for Price vs Expectation chart
   */
  fastify.get<{
    Querystring: {
      asset?: string;
      tf?: string;
      range?: string;
    };
  }>('/api/market/chart/price-vs-expectation', async (request) => {
    const { 
      asset = 'BTC', 
      tf = '1h', 
      range = '7d' 
    } = request.query;
    
    const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
    
    // Time range
    const RANGE_MS: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '1y': 365 * 24 * 60 * 60 * 1000,
    };
    
    const now = Date.now();
    const startTime = now - (RANGE_MS[range] || RANGE_MS['7d']);
    
    // Fetch all data in parallel
    const [priceData, predictions, outcomes] = await Promise.all([
      getPriceChartData(symbol, range as ChartRange, tf as ChartTimeframe),
      fetchExchangePredictions(symbol, startTime, now),
      fetchOutcomes(symbol, startTime, now),
    ]);
    
    // Build price map for expectation line calculation
    const priceMap = new Map(
      priceData.points.map(p => [p.ts, p.price])
    );
    
    // Build expectation line
    const expectationLine = buildExpectationLine(predictions, priceMap);
    
    // Convert price to OHLC format (using close for all since we have close only)
    const priceOHLC = priceData.points.map(p => ({
      t: p.ts,
      o: p.price,
      h: p.price * 1.001, // Slight variance for visual
      l: p.price * 0.999,
      c: p.price,
      v: p.volume,
    }));
    
    // Calculate metrics
    const metrics = calculateMetrics(predictions, outcomes, priceOHLC);
    
    // Signal changes
    const signalChanges = countSignalChanges(predictions);
    
    // Top drivers (currently Exchange only)
    const lastPred = predictions[predictions.length - 1];
    const exchangeContrib = lastPred ? (lastPred.confidence - 0.5) * 200 : 0;
    
    const response: PriceVsExpectationResponse = {
      ok: true,
      asset,
      tf,
      range,
      
      price: priceOHLC,
      
      layers: {
        exchange: {
          predictions,
          expectationLine,
        },
        combined: {
          predictions, // Same as exchange for now
          expectationLine,
        },
      },
      
      outcomes,
      
      metrics: {
        ...metrics,
        accuracyWindow: '1h',
      },
      
      signalChanges,
      
      topDrivers: {
        exchange: Math.round(exchangeContrib),
        onchain: 0, // Disabled
        sentiment: 0, // Disabled
      },
      
      flags: {
        onchainEnabled: false,
        sentimentEnabled: false,
        dataSource: priceData.source,
      },
    };
    
    console.log(`[PriceVsExpectation] ${asset}/${tf}/${range}: ${priceOHLC.length} candles, ${predictions.length} predictions, source=${priceData.source}`);
    
    return response;
  });
  
  console.log('[PriceVsExpectation] Routes registered');
}

export default priceVsExpectationRoutes;
