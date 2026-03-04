/**
 * PRICE VS EXPECTATION V2 — New forecast-based endpoint
 * ======================================================
 * 
 * Uses the new ForecastEvent system for:
 * - Fixed target prices (not "soft signals")
 * - Confidence bands
 * - Proper outcome evaluation
 * - Real accuracy metrics
 * 
 * P1.0: META-AWARE FORECASTS
 * ==========================
 * Forecasts now pass through Meta-Brain for risk adjustment.
 * UI displays the FINAL state after invariants are applied.
 * This ensures: what you see = what the system would act on.
 * 
 * Endpoint: GET /api/market/chart/price-vs-expectation-v2
 */

import { FastifyInstance } from 'fastify';
import { getPriceChartData } from './services/price.service.js';
import * as forecastRepo from '../exchange/forecast/forecast.repository.js';
import { evaluatePendingForecasts } from '../exchange/forecast/forecast.evaluator.js';
import { buildRealtimeOverlay } from './services/realtime_overlay.service.js';
import { applyMetaBrainToForecast } from '../intelligence/index.js';
import type { MetaAwareForecast, AppliedOverlay, RiskLevel, MetaAction } from '../intelligence/index.js';
import type { ChartRange, ChartTimeframe } from './contracts/chart.types.js';
import type {
  ForecastHorizon,
  ForecastPoint,
  PriceVsExpectationPayload,
} from '../exchange/forecast/forecast.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const RANGE_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// META-AWARE FORECAST RESPONSE TYPE
// ═══════════════════════════════════════════════════════════════

interface MetaAwareForecastData {
  // Raw values (transparency)
  raw: {
    direction: string;
    confidence: number;
    expectedMovePct: number;
  };
  // Final risk-adjusted values
  direction: string;
  confidence: number;
  expectedMovePct: number;
  targetPrice: number;
  action: MetaAction;
  riskLevel: RiskLevel;
  appliedOverlays: AppliedOverlay[];
  isMetaAdjusted: boolean;
}

// ═══════════════════════════════════════════════════════════════
// BUILD CHART DATA
// ═══════════════════════════════════════════════════════════════

async function buildChartData(
  asset: string,
  range: string,
  horizon: ForecastHorizon,
  tf: ChartTimeframe
): Promise<any> {
  const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  const now = Date.now();
  const rangeMs = RANGE_MS[range] || RANGE_MS['7d'];
  const fromTs = now - rangeMs;
  
  // Fetch price data
  const priceData = await getPriceChartData(symbol, range as ChartRange, tf);
  
  // Get last price for meta-brain adjustment
  const lastPrice = priceData.points?.[priceData.points.length - 1]?.price || 0;
  
  // Fetch forecasts
  const [allForecasts, pendingForecast, metrics] = await Promise.all([
    forecastRepo.listForecasts(assetNorm, fromTs, now, horizon),
    forecastRepo.getLatestPendingForecast(assetNorm, horizon),
    forecastRepo.calculateMetrics(assetNorm, horizon, 30),
  ]);
  
  // Convert to ForecastPoints
  const forecastHistory: ForecastPoint[] = allForecasts
    .filter(f => f.evaluated)
    .map(forecastRepo.toForecastPoint);
  
  // Build future point (if pending)
  // IMPORTANT: Now using META-AWARE forecast — risk-adjusted values
  let futurePoint: ForecastPoint | null = null;
  let futureBand: { ts: number; upper: number; lower: number } | null = null;
  let metaForecast: MetaAwareForecastData | undefined = undefined;
  
  if (pendingForecast) {
    // ═══════════════════════════════════════════════════════════════
    // META-BRAIN INTEGRATION — The key architectural change
    // ═══════════════════════════════════════════════════════════════
    // Apply meta-brain risk adjustments to the raw forecast
    // This ensures UI shows the FINAL state that system would act on
    
    let metaAwareForecast: MetaAwareForecast | null = null;
    
    try {
      metaAwareForecast = await applyMetaBrainToForecast({
        asset: assetNorm,
        horizon,
        direction: pendingForecast.direction,
        confidence: pendingForecast.confidence,
        expectedMovePct: pendingForecast.expectedMovePct,
        basePrice: pendingForecast.basePrice,
        asOfTs: now, // Use current time for fresh context
      });
      
      console.log(
        `[PriceVsExpectationV2] Meta-aware forecast: ` +
        `${assetNorm} ${horizon} → ` +
        `conf: ${(pendingForecast.confidence * 100).toFixed(0)}% → ${(metaAwareForecast.confidence * 100).toFixed(0)}% ` +
        `(${metaAwareForecast.appliedOverlays.length} overlays)`
      );
    } catch (error: any) {
      console.warn('[PriceVsExpectationV2] Meta-brain unavailable, using raw forecast:', error.message);
    }
    
    // Use meta-adjusted values if available, otherwise raw
    const finalConfidence = metaAwareForecast?.confidence ?? pendingForecast.confidence;
    const finalMove = metaAwareForecast?.expectedMovePct ?? pendingForecast.expectedMovePct;
    const finalTarget = metaAwareForecast?.targetPrice ?? pendingForecast.targetPrice;
    const finalDirection = metaAwareForecast?.direction ?? pendingForecast.direction;
    
    // Visual projection: always 24h forward from now (short arrow)
    // This keeps the chart clean regardless of 1D/7D/30D horizon
    const VISUAL_PROJECTION_MS = 24 * 60 * 60 * 1000; // Always 24h visual
    const visualTs = now + VISUAL_PROJECTION_MS;
    
    // Build future point with META-ADJUSTED values
    futurePoint = {
      ts: visualTs,
      horizon,
      basePrice: pendingForecast.basePrice,
      targetPrice: finalTarget, // META-ADJUSTED
      expectedMovePct: finalMove, // META-ADJUSTED
      direction: finalDirection, // META-ADJUSTED (usually same)
      confidence: finalConfidence, // META-ADJUSTED
      upperBand: pendingForecast.upperBand,
      lowerBand: pendingForecast.lowerBand,
      evaluated: false,
    };
    
    // Adjust bands based on meta confidence
    // Lower confidence = wider uncertainty band
    const bandAdjustment = metaAwareForecast 
      ? (pendingForecast.confidence / finalConfidence) 
      : 1;
    
    futureBand = {
      ts: visualTs,
      upper: pendingForecast.basePrice + (pendingForecast.upperBand - pendingForecast.basePrice) * bandAdjustment,
      lower: pendingForecast.basePrice - (pendingForecast.basePrice - pendingForecast.lowerBand) * bandAdjustment,
    };
    
    // Include meta-forecast data for UI
    if (metaAwareForecast) {
      metaForecast = {
        raw: metaAwareForecast.raw,
        direction: metaAwareForecast.direction,
        confidence: metaAwareForecast.confidence,
        expectedMovePct: metaAwareForecast.expectedMovePct,
        targetPrice: metaAwareForecast.targetPrice,
        action: metaAwareForecast.action,
        riskLevel: metaAwareForecast.riskLevel,
        appliedOverlays: metaAwareForecast.appliedOverlays,
        isMetaAdjusted: metaAwareForecast.isMetaAdjusted,
      };
    }
  }
  
  // Build outcome markers from evaluated forecasts
  const outcomeMarkers = allForecasts
    .filter(f => f.evaluated && f.outcome)
    .map(f => ({
      ts: f.createdAt,
      label: f.outcome!.label,
      direction: f.direction,
      expectedMovePct: f.expectedMovePct,
      actualMovePct: f.outcome!.realMovePct,
      confidence: f.confidence,
    }));
  
  // Block 34: Error Cluster Analysis
  const errorForecasts = allForecasts.filter(f => 
    f.evaluated && f.outcome && (f.outcome.label === 'FP' || f.outcome.label === 'FN')
  );
  
  const errorClusters = {
    byDirection: {
      upErrors: errorForecasts.filter(f => f.direction === 'UP').length,
      downErrors: errorForecasts.filter(f => f.direction === 'DOWN').length,
    },
    byConfidence: {
      highConfErrors: errorForecasts.filter(f => f.confidence > 0.7).length,
      medConfErrors: errorForecasts.filter(f => f.confidence >= 0.5 && f.confidence <= 0.7).length,
      lowConfErrors: errorForecasts.filter(f => f.confidence < 0.5).length,
    },
    byDeviation: {
      overshot: errorForecasts.filter(f => 
        f.outcome && Math.abs(f.outcome.realMovePct) > Math.abs(f.expectedMovePct)
      ).length,
      undershot: errorForecasts.filter(f => 
        f.outcome && Math.abs(f.outcome.realMovePct) < Math.abs(f.expectedMovePct)
      ).length,
    },
    totalErrors: errorForecasts.length,
    failureRate: allForecasts.filter(f => f.evaluated).length > 0
      ? Math.round((errorForecasts.length / allForecasts.filter(f => f.evaluated).length) * 100)
      : 0,
  };
  
  // Calculate drivers (simplified - Exchange only for now)
  const lastForecast = pendingForecast || allForecasts[allForecasts.length - 1];
  const exchangeContrib = lastForecast?.layers?.exchange?.score ?? 0.5;
  
  const directionBias = lastForecast?.direction ?? 'FLAT';
  
  // Block 28: Multi-layer alignment calculation
  const exchangeDir = exchangeContrib > 0.55 ? 1 : exchangeContrib < 0.45 ? -1 : 0;
  const onchainDir = 0; // Disabled for now
  const sentimentDir = 0; // Disabled for now
  
  // Alignment score: -1 (divergent) to +1 (aligned)
  const activeLayerCount = 1; // Only exchange active
  const directionSum = exchangeDir + onchainDir + sentimentDir;
  const alignmentScore = activeLayerCount > 0 ? directionSum / activeLayerCount : 0;
  
  // Consensus status
  let consensus: 'STRONG_BULL' | 'BULL' | 'MIXED' | 'BEAR' | 'STRONG_BEAR' | 'NEUTRAL';
  if (alignmentScore > 0.66) consensus = 'STRONG_BULL';
  else if (alignmentScore > 0.33) consensus = 'BULL';
  else if (alignmentScore < -0.66) consensus = 'STRONG_BEAR';
  else if (alignmentScore < -0.33) consensus = 'BEAR';
  else if (Math.abs(alignmentScore) < 0.1) consensus = 'NEUTRAL';
  else consensus = 'MIXED';
  
  return {
    asset: assetNorm,
    range,
    horizon,
    
    price: priceData.points.map(p => ({
      ts: p.ts,
      price: p.price,
      volume: p.volume,
    })),
    
    layers: {
      exchange: {
        forecastHistory,
        futurePoint,
        futureBand,
      },
      meta: {
        // Meta layer now shows META-AWARE forecast (after risk adjustments)
        forecastHistory,
        futurePoint,
        futureBand,
      },
    },
    
    // P1.0: Meta-aware forecast data (risk-adjusted)
    // This is the key addition — shows how meta-brain adjusted the forecast
    metaForecast,
    
    outcomeMarkers,
    
    metrics,
    
    drivers: {
      exchange: Math.round((exchangeContrib - 0.5) * 200),
      onchain: 0,
      sentiment: 0,
      directionBias,
    },
    
    // Block 28: Alignment data
    alignment: {
      score: Math.round(alignmentScore * 100) / 100,
      consensus,
      layerSignals: {
        exchange: exchangeDir,
        onchain: onchainDir,
        sentiment: sentimentDir,
      },
      activeLayerCount,
    },
    
    // Block 34: Error clusters
    errorClusters,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function priceVsExpectationV2Routes(fastify: FastifyInstance) {
  /**
   * GET /api/market/chart/price-vs-expectation-v2
   * 
   * New endpoint using ForecastEvent system
   */
  fastify.get<{
    Querystring: {
      asset?: string;
      range?: string;
      horizon?: string;
      tf?: string;
    };
  }>('/api/market/chart/price-vs-expectation-v2', async (request) => {
    const {
      asset = 'BTC',
      range = '7d',
      horizon = '1D',
      tf = '1h',
    } = request.query;
    
    try {
      const data = await buildChartData(
        asset,
        range,
        horizon as ForecastHorizon,
        tf as ChartTimeframe
      );
      
      // Fetch realtime overlay for market context
      let overlay = null;
      try {
        overlay = await buildRealtimeOverlay(asset);
      } catch (e) {
        console.warn('[PriceVsExpectationV2] Overlay failed:', e);
      }
      
      return {
        ok: true,
        ...data,
        // Real-time market context overlay
        overlay,
        flags: {
          dataSource: 'forecast_v2',
          onchainEnabled: false,
          sentimentEnabled: false,
        },
        // Block 35: V3 Exchange Layer Contract
        v3Contract: {
          version: '3.0.0',
          frozen: true,
          frozenAt: '2026-02-12T15:00:00Z',
          exchangeLayerStable: true,
          nextBreakingChange: null,
          changeLog: [
            'v3.0.0: Frozen exchange layer for production use',
            'v2.1.0: Added multi-horizon support (1D, 7D, 30D)',
            'v2.0.0: New forecast-based system with outcome evaluation',
            'v1.0.0: Initial soft signals implementation',
          ],
        },
      };
    } catch (error: any) {
      console.error('[PriceVsExpectationV2] Error:', error.message);
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  /**
   * POST /api/market/chart/forecast/evaluate
   * 
   * Trigger evaluation of pending forecasts
   */
  fastify.post('/api/market/chart/forecast/evaluate', async () => {
    try {
      const result = await evaluatePendingForecasts();
      return {
        ok: true,
        ...result,
      };
    } catch (error: any) {
      console.error('[ForecastEvaluate] Error:', error.message);
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  /**
   * GET /api/market/chart/forecast/stats
   * 
   * Get forecast system stats
   */
  fastify.get('/api/market/chart/forecast/stats', async () => {
    try {
      const stats = await forecastRepo.getStats();
      return {
        ok: true,
        ...stats,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  /**
   * POST /api/market/chart/forecast/create
   * 
   * Manually create a forecast (for testing)
   * Now creates forecasts for ALL horizons (1D, 7D, 30D)
   */
  fastify.post<{
    Body: {
      asset: string;
      direction: 'UP' | 'DOWN' | 'FLAT';
      confidence?: number;
      strength?: number;
      multiHorizon?: boolean; // Default true: create for all horizons
    };
  }>('/api/market/chart/forecast/create', async (request) => {
    const { 
      asset, 
      direction, 
      confidence = 0.6, 
      strength = 0.5,
      multiHorizon = true 
    } = request.body;
    
    try {
      const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
      
      // Get current price from chart data (uses providers with mock fallback)
      const priceData = await getPriceChartData(symbol, '24h', '1h');
      
      let currentPrice: number | null = null;
      
      if (priceData.points && priceData.points.length > 0) {
        currentPrice = priceData.points[priceData.points.length - 1].price;
      }
      
      if (!currentPrice) {
        return { ok: false, error: 'Could not get current price' };
      }
      
      if (multiHorizon) {
        // Create forecasts for ALL horizons (1D, 7D, 30D)
        const { createMultiHorizonForecasts } = await import('../exchange/forecast/forecast.service.js');
        
        const result = await createMultiHorizonForecasts({
          asset,
          currentPrice,
          direction,
          confidence,
          strength,
        });
        
        return {
          ok: true,
          multiHorizon: true,
          horizons: {
            created: result.created,
            skipped: result.skipped,
          },
          message: `Created forecasts for horizons: ${result.created.join(', ') || 'none (all pending)'}`,
        };
      } else {
        // Legacy: single horizon (1D)
        const { createForecast } = await import('../exchange/forecast/forecast.service.js');
        
        const forecast = await createForecast({
          asset,
          currentPrice,
          direction,
          confidence,
          strength,
        });
        
        return {
          ok: true,
          multiHorizon: false,
          forecast: {
            id: forecast.id,
            symbol: forecast.symbol,
            direction: forecast.direction,
            basePrice: forecast.basePrice,
            targetPrice: forecast.targetPrice,
            expectedMovePct: forecast.expectedMovePct,
            upperBand: forecast.upperBand,
            lowerBand: forecast.lowerBand,
            evaluateAfter: new Date(forecast.evaluateAfter).toISOString(),
          },
        };
      }
    } catch (error: any) {
      console.error('[ForecastCreate] Error:', error.message);
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  /**
   * GET /api/market/realtime-overlay
   * 
   * Real-time market context overlay for forecast interpretation
   * Shows funding, positioning, regime, and risk assessment
   */
  fastify.get<{
    Querystring: {
      asset?: string;
    };
  }>('/api/market/realtime-overlay', async (request) => {
    const { asset = 'BTC' } = request.query;
    
    try {
      const overlay = await buildRealtimeOverlay(asset);
      
      return {
        ok: true,
        ...overlay,
      };
    } catch (error: any) {
      console.error('[RealtimeOverlay] Error:', error.message);
      return {
        ok: false,
        error: error.message,
        // Return safe defaults
        asset: asset.toUpperCase().replace('USDT', ''),
        timestamp: Date.now(),
        regime: 'RANGE',
        regimeConfidence: 0.5,
        funding: { rate: null, state: 'NORMAL', annualized: null },
        positioning: { longShortRatio: null, oiDeltaPct: null, imbalanceDirection: null },
        liquidationRisk: 'LOW',
        confidenceModifier: 0,
        summary: 'Data unavailable',
        warnings: [],
      };
    }
  });
  
  console.log('[PriceVsExpectationV2] Routes registered');
}

export default priceVsExpectationV2Routes;
