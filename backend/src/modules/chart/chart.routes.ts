/**
 * CHART ROUTES — Central Chart API
 * =================================
 * 
 * Endpoints:
 * - GET /api/v10/chart/price      - Real price data
 * - GET /api/v10/chart/prediction - Prediction data (layers)
 * - GET /api/v10/chart/events     - Decision events
 * - GET /api/v10/chart/combined   - All data in one call
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPriceChartData } from './services/price.service.js';
import { getPredictionChartData, scoreToPriceLike } from './services/prediction.service.js';
import { getEventChartData } from './services/events.service.js';
import type { ChartRange, ChartTimeframe, CentralChartData } from './contracts/chart.types.js';

// ═══════════════════════════════════════════════════════════════
// QUERY TYPES
// ═══════════════════════════════════════════════════════════════

interface ChartQuery {
  symbol?: string;
  range?: ChartRange;
  tf?: ChartTimeframe;
  source?: string;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function chartRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/chart/price — Real price data
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: ChartQuery;
  }>('/api/v10/chart/price', async (request, reply) => {
    const symbol = request.query.symbol || 'BTCUSDT';
    const range = (request.query.range as ChartRange) || '7d';
    const tf = (request.query.tf as ChartTimeframe) || '1h';
    const source = request.query.source || 'binance';
    
    try {
      const data = await getPriceChartData(symbol, range, tf, source);
      
      return reply.send({
        ok: true,
        data,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'PRICE_FETCH_FAILED',
        message: error.message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/chart/prediction — Prediction data
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: ChartQuery & { priceLike?: string };
  }>('/api/v10/chart/prediction', async (request, reply) => {
    const symbol = request.query.symbol || 'BTCUSDT';
    const range = (request.query.range as ChartRange) || '7d';
    const tf = (request.query.tf as ChartTimeframe) || '1h';
    const priceLike = request.query.priceLike === 'true';
    
    try {
      // Get price data first for price-like conversion
      let pricePoints: Array<{ ts: number; price: number }> | undefined;
      
      if (priceLike) {
        const priceData = await getPriceChartData(symbol, range, tf);
        pricePoints = priceData.points;
      }
      
      const data = await getPredictionChartData(symbol, range, tf, pricePoints);
      
      // Convert to price-like if requested
      if (priceLike && pricePoints && pricePoints.length > 0) {
        const basePrice = pricePoints[0].price;
        
        data.points = data.points.map((p, idx) => ({
          ...p,
          // Map combined score to price-like value
          combinedPriceLike: scoreToPriceLike(p.combined, basePrice),
          // Reference price at same timestamp
          refPrice: pricePoints?.[idx]?.price || basePrice,
        })) as any;
      }
      
      return reply.send({
        ok: true,
        data,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'PREDICTION_FETCH_FAILED',
        message: error.message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/chart/events — Decision events
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: ChartQuery;
  }>('/api/v10/chart/events', async (request, reply) => {
    const symbol = request.query.symbol || 'BTCUSDT';
    const range = (request.query.range as ChartRange) || '7d';
    
    try {
      const data = await getEventChartData(symbol, range);
      
      return reply.send({
        ok: true,
        data,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'EVENTS_FETCH_FAILED',
        message: error.message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/chart/combined — All data in one call
  // ─────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: ChartQuery;
  }>('/api/v10/chart/combined', async (request, reply) => {
    const symbol = request.query.symbol || 'BTCUSDT';
    const range = (request.query.range as ChartRange) || '7d';
    const tf = (request.query.tf as ChartTimeframe) || '1h';
    const source = request.query.source || 'binance';
    
    try {
      // Fetch price data first (needed for prediction)
      const priceData = await getPriceChartData(symbol, range, tf, source);
      
      // Fetch prediction with price points for proper calculation
      const [predictionData, eventsData] = await Promise.all([
        getPredictionChartData(symbol, range, tf, priceData.points),
        getEventChartData(symbol, range),
      ]);
      
      // Calculate accuracy metrics
      let correctDirections = 0;
      let totalComparisons = 0;
      let totalDeviation = 0;
      
      const priceMap = new Map(priceData.points.map(p => [p.ts, p.price]));
      
      for (let i = 1; i < predictionData.points.length; i++) {
        const pred = predictionData.points[i];
        const prevPred = predictionData.points[i - 1];
        
        const price = priceMap.get(pred.ts);
        const prevPrice = priceMap.get(prevPred.ts);
        
        if (price && prevPrice) {
          const actualDirection = price > prevPrice ? 'BULLISH' : price < prevPrice ? 'BEARISH' : 'NEUTRAL';
          
          if (pred.direction === actualDirection) {
            correctDirections++;
          }
          
          // Deviation from prediction
          const expectedPrice = scoreToPriceLike(pred.combined, prevPrice);
          totalDeviation += Math.abs(price - expectedPrice) / prevPrice;
          
          totalComparisons++;
        }
      }
      
      const accuracy = {
        directionAccuracy: totalComparisons > 0 
          ? Math.round((correctDirections / totalComparisons) * 100) 
          : 50,
        avgDeviation: totalComparisons > 0 
          ? Math.round((totalDeviation / totalComparisons) * 10000) / 100 
          : 0,
        hitRate: totalComparisons > 0 
          ? Math.round((correctDirections / totalComparisons) * 100)
          : 50,
      };
      
      const combinedData: CentralChartData = {
        symbol,
        range,
        tf,
        price: priceData,
        prediction: predictionData,
        events: eventsData,
        accuracy,
      };
      
      return reply.send({
        ok: true,
        data: combinedData,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'COMBINED_FETCH_FAILED',
        message: error.message,
      });
    }
  });

  console.log('[Chart] Routes registered: /api/v10/chart/*');
}

export default chartRoutes;
