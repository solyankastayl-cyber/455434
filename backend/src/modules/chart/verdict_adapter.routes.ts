/**
 * VERDICT ADAPTER ROUTES
 * ======================
 * 
 * Bridge between the new Verdict Engine and the existing frontend.
 * Provides backwards-compatible response format while using Verdict Engine internally.
 * 
 * GET /api/market/chart/price-vs-expectation-v3
 * - Uses Verdict Engine for evaluation
 * - Returns data in format compatible with PriceExpectationV2Page.jsx
 * - Includes verdict details (action, adjustments, applied rules)
 * 
 * Block 4: Added forecastOverlay segment for correct chart rendering.
 * The overlay corresponds only to the forecast horizon (1D/7D/30D),
 * not the entire chart timeframe.
 */

import { FastifyInstance } from 'fastify';
import { getPriceChartData } from './services/price.service.js';
import { buildRealtimeOverlay } from './services/realtime_overlay.service.js';
import * as forecastRepo from '../exchange/forecast/forecast.repository.js';
import type { ChartRange, ChartTimeframe } from './contracts/chart.types.js';
import type { ForecastHorizon, ForecastPoint } from '../exchange/forecast/forecast.types.js';

// Import Verdict Engine types
import type { VerdictContext, Verdict, Horizon, ModelOutput, MarketSnapshot } from '../verdict/contracts/verdict.types.js';
import { VerdictEngineImpl } from '../verdict/runtime/verdict.engine.impl.js';
import { IntelligenceMetaBrainAdapter } from '../verdict/runtime/intelligence.meta.adapter.js';
import { ShadowHealthAdapter } from '../verdict/adapters/shadow-health.adapter.js';
import { CredibilityService } from '../evolution/runtime/credibility.service.js';

// Models
import { Model1D } from '../ml/runtime/model.1d.js';
import { Model7D } from '../ml/runtime/model.7d.js';
import { Model30D } from '../ml/runtime/model.30d.js';

const RANGE_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

// Initialize services once
let verdictEngine: VerdictEngineImpl | null = null;
const model1d = new Model1D();
const model7d = new Model7D();
const model30d = new Model30D();

function getVerdictEngine(): VerdictEngineImpl {
  if (!verdictEngine) {
    // P2: Real adapters
    const metaBrain = new IntelligenceMetaBrainAdapter();
    const credibilityService = new CredibilityService();
    const healthPort = new ShadowHealthAdapter();
    
    verdictEngine = new VerdictEngineImpl(
      metaBrain,
      { getConfidenceModifier: (args) => credibilityService.getConfidenceModifier(args) },
      healthPort
    );
  }
  return verdictEngine;
}

/**
 * Build features from price data for ML models
 */
function buildFeatures(pricePoints: Array<{ ts: number; price: number; volume?: number }>): Record<string, number> {
  if (!pricePoints || pricePoints.length < 10) {
    return { momentum_1d: 0, volatility_1d: 0.02, rsi: 50, volume_change: 0 };
  }
  
  const prices = pricePoints.map(p => p.price);
  const volumes = pricePoints.map(p => p.volume || 0);
  
  // Calculate momentum (24h price change)
  const recent = prices.slice(-24);
  const momentum = recent.length >= 2 
    ? (recent[recent.length - 1] - recent[0]) / recent[0]
    : 0;
  
  // Calculate volatility (std dev of returns)
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push((recent[i] - recent[i-1]) / recent[i-1]);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);
  
  // Simple RSI approximation
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i-1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const rs = losses > 0 ? gains / losses : 100;
  const rsi = 100 - (100 / (1 + rs));
  
  // Volume change
  const recentVol = volumes.slice(-24);
  const prevVol = volumes.slice(-48, -24);
  const avgRecentVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length || 1;
  const avgPrevVol = prevVol.reduce((a, b) => a + b, 0) / prevVol.length || avgRecentVol;
  const volumeChange = (avgRecentVol - avgPrevVol) / avgPrevVol;
  
  // Long-term features for 7D/30D models
  const prices7d = prices.slice(-168); // 7 days of hourly data
  const momentum7d = prices7d.length >= 2 
    ? (prices7d[prices7d.length - 1] - prices7d[0]) / prices7d[0]
    : momentum;
  
  const prices30d = prices.slice(-720); // 30 days
  const momentum30d = prices30d.length >= 2 
    ? (prices30d[prices30d.length - 1] - prices30d[0]) / prices30d[0]
    : momentum7d;
  
  // Volume growth over 7 days
  const vol7d = volumes.slice(-168);
  const vol7dFirst = vol7d.slice(0, 84).reduce((a, b) => a + b, 0) / 84 || 1;
  const vol7dLast = vol7d.slice(-84).reduce((a, b) => a + b, 0) / 84 || vol7dFirst;
  const volumeGrowth7d = (vol7dLast - vol7dFirst) / vol7dFirst;
  
  // Fear & Greed proxy (from RSI + momentum)
  const fearGreed = Math.max(0, Math.min(100, 50 + rsi - 50 + momentum * 100));
  
  return {
    // 1D features
    momentum_1d: momentum,
    volatility_1d: volatility || 0.02,
    rsi,
    volume_change: volumeChange,
    
    // 7D features
    momentum_7d: momentum7d,
    trend_7d: momentum7d,
    volume_growth_7d: volumeGrowth7d,
    macd: momentum - momentum7d * 0.5, // Simplified MACD proxy
    regime_score: Math.abs(momentum7d) > 0.05 ? 0.7 : 0.3,
    
    // 30D features
    momentum_30d: momentum30d,
    trend_30d: momentum30d,
    macro_bias: momentum30d > 0.1 ? 0.5 : momentum30d < -0.1 ? -0.5 : 0,
    btc_dominance: 50, // Would need external data
    fear_greed: fearGreed,
    
    // Common
    trend_strength: Math.abs(momentum) * 10,
    mean_reversion: rsi > 70 ? -0.02 : rsi < 30 ? 0.02 : 0,
  };
}

/**
 * Run all ML models and get predictions
 */
async function getModelOutputs(
  symbol: string, 
  features: Record<string, number>,
  ts: string
): Promise<ModelOutput[]> {
  const [pred1d, pred7d, pred30d] = await Promise.all([
    model1d.predict({ symbol, features, ts }),
    model7d.predict({ symbol, features, ts }),
    model30d.predict({ symbol, features, ts }),
  ]);
  
  return [
    {
      horizon: '1D' as Horizon,
      expectedReturn: pred1d.expectedReturn,
      confidenceRaw: pred1d.confidence,
      modelId: pred1d.modelId,
    },
    {
      horizon: '7D' as Horizon,
      expectedReturn: pred7d.expectedReturn,
      confidenceRaw: pred7d.confidence,
      modelId: pred7d.modelId,
    },
    {
      horizon: '30D' as Horizon,
      expectedReturn: pred30d.expectedReturn,
      confidenceRaw: pred30d.confidence,
      modelId: pred30d.modelId,
    },
  ];
}

/**
 * Build V3 chart data using Verdict Engine
 */
async function buildVerdictChartData(
  asset: string,
  range: string,
  selectedHorizon: ForecastHorizon,
  tf: ChartTimeframe
) {
  const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rangeMs = RANGE_MS[range] || RANGE_MS['7d'];
  const fromTs = now - rangeMs;
  
  // Fetch price data
  const priceData = await getPriceChartData(symbol, range as ChartRange, tf);
  const lastPrice = priceData.points?.[priceData.points.length - 1]?.price || 0;
  
  // Build features from price history
  const features = buildFeatures(priceData.points);
  
  // Get model predictions for all horizons
  const modelOutputs = await getModelOutputs(symbol, features, nowIso);
  
  // Build market snapshot
  const snapshot: MarketSnapshot = {
    symbol,
    ts: nowIso,
    price: lastPrice,
    volatility: features.volatility_1d,
    regime: features.momentum_1d > 0.02 ? 'TREND_UP' : 
            features.momentum_1d < -0.02 ? 'TREND_DOWN' : 'RANGE',
  };
  
  // Build verdict context
  const verdictCtx: VerdictContext = {
    snapshot,
    outputs: modelOutputs,
    metaBrain: { invariantsEnabled: true },
  };
  
  // Evaluate verdict using the engine
  const engine = getVerdictEngine();
  const verdict = await engine.evaluate(verdictCtx);
  
  // Get historical forecasts for chart
  const [allForecasts, metrics] = await Promise.all([
    forecastRepo.listForecasts(assetNorm, fromTs, now, selectedHorizon),
    forecastRepo.calculateMetrics(assetNorm, selectedHorizon, 30),
  ]);
  
  // Build forecast history from evaluated forecasts
  const forecastHistory: ForecastPoint[] = allForecasts
    .filter(f => f.evaluated)
    .map(forecastRepo.toForecastPoint);
  
  // Build future point from verdict
  // Block 4: Correct overlay — segment corresponds only to forecast horizon
  const horizonMs: Record<ForecastHorizon, number> = {
    '1D': 24 * 60 * 60 * 1000,
    '7D': 7 * 24 * 60 * 60 * 1000,
    '30D': 30 * 24 * 60 * 60 * 1000,
  };
  
  const forecastHorizonMs = horizonMs[selectedHorizon] || horizonMs['1D'];
  const forecastEndTs = now + forecastHorizonMs;
  
  const direction = verdict.action === 'BUY' ? 'UP' : 
                   verdict.action === 'SELL' ? 'DOWN' : 'FLAT';
  const targetPrice = lastPrice * (1 + verdict.expectedReturn);
  const bandWidth = lastPrice * Math.abs(verdict.expectedReturn) * (1 - verdict.confidence);
  
  const futurePoint: ForecastPoint = {
    ts: forecastEndTs,
    horizon: selectedHorizon,
    basePrice: lastPrice,
    targetPrice,
    expectedMovePct: verdict.expectedReturn * 100,
    direction,
    confidence: verdict.confidence,
    upperBand: targetPrice + bandWidth,
    lowerBand: targetPrice - bandWidth,
    evaluated: false,
  };
  
  const futureBand = {
    ts: forecastEndTs,
    upper: targetPrice + bandWidth,
    lower: targetPrice - bandWidth,
  };
  
  // Block 4: Forecast overlay segment for ECharts markLine/markPoint
  // This is a short segment from current price to target at horizon end
  // Block 10: Added volatility and health metrics for confidence band refinement
  const forecastOverlay = {
    fromTs: now,
    toTs: forecastEndTs,
    fromPrice: lastPrice,
    targetPrice,
    direction,
    confidence: verdict.confidence,
    expectedMovePct: verdict.expectedReturn * 100,
    horizon: selectedHorizon,
    action: verdict.action,
    risk: verdict.risk,
    // For ECharts rendering hints
    renderAs: 'markLine', // Frontend should use markLine + markPoint
    color: direction === 'UP' ? '#22c55e' : direction === 'DOWN' ? '#ef4444' : '#6b7280',
    // Block 10: Volatility and calibration data for band width refinement
    volatility: snapshot.volatility || priceData.volatility || 0.03, // Default 3% if not available
    healthState: verdict.health?.state || 'HEALTHY',
    healthModifier: verdict.health?.modifier || 1.0,
    ece: verdict.health?.ece || null, // Expected Calibration Error if available
    // Block 10: Pre-calculated band width factors
    bandWidthFactors: {
      baseWidth: bandWidth,
      volatilityContribution: (snapshot.volatility || 0.03) * lastPrice * 0.5,
      uncertaintyContribution: (1 - verdict.confidence) * lastPrice * Math.abs(verdict.expectedReturn),
    },
  };
  
  // Build outcome markers
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
  
  // Error clusters for Block 34
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
  
  // Drivers calculation
  const exchangeContrib = features.momentum_1d > 0 ? 0.6 : features.momentum_1d < 0 ? 0.4 : 0.5;
  const directionBias = direction;
  
  // Alignment data
  const exchangeDir = exchangeContrib > 0.55 ? 1 : exchangeContrib < 0.45 ? -1 : 0;
  const alignmentScore = exchangeDir;
  
  let consensus: 'STRONG_BULL' | 'BULL' | 'MIXED' | 'BEAR' | 'STRONG_BEAR' | 'NEUTRAL';
  if (alignmentScore > 0.66) consensus = 'STRONG_BULL';
  else if (alignmentScore > 0.33) consensus = 'BULL';
  else if (alignmentScore < -0.66) consensus = 'STRONG_BEAR';
  else if (alignmentScore < -0.33) consensus = 'BEAR';
  else if (Math.abs(alignmentScore) < 0.1) consensus = 'NEUTRAL';
  else consensus = 'MIXED';
  
  // Build meta-aware forecast data from verdict
  const metaForecast = {
    raw: {
      direction: verdict.raw.expectedReturn > 0 ? 'UP' : verdict.raw.expectedReturn < 0 ? 'DOWN' : 'FLAT',
      confidence: verdict.raw.confidence,
      expectedMovePct: verdict.raw.expectedReturn * 100,
    },
    direction,
    confidence: verdict.confidence,
    expectedMovePct: verdict.expectedReturn * 100,
    targetPrice,
    action: verdict.action,
    riskLevel: verdict.risk,
    appliedOverlays: verdict.adjustments.map(adj => ({
      id: adj.key,
      source: adj.stage,
      effect: adj.deltaConfidence ? 'ADJUST_CONFIDENCE' : 'ADJUST_RETURN',
      value: adj.deltaConfidence || adj.deltaReturn || 0,
      reason: adj.notes || '',
    })),
    isMetaAdjusted: verdict.adjustments.length > 0,
  };
  
  // Build all horizon candidates for UI
  const allCandidates = modelOutputs.map(out => {
    const candDirection = out.expectedReturn > 0 ? 'UP' : out.expectedReturn < 0 ? 'DOWN' : 'FLAT';
    const candAction = out.expectedReturn > 0 && out.confidenceRaw > 0.5 ? 'BUY' :
                      out.expectedReturn < 0 && out.confidenceRaw > 0.5 ? 'SELL' : 'HOLD';
    return {
      horizon: out.horizon,
      modelId: out.modelId,
      direction: candDirection,
      expectedReturn: out.expectedReturn,
      confidence: out.confidenceRaw,
      action: candAction,
      isSelected: out.horizon === verdict.horizon,
    };
  });
  
  return {
    asset: assetNorm,
    range,
    horizon: selectedHorizon,
    
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
        forecastHistory,
        futurePoint,
        futureBand,
      },
    },
    
    // Block 4: Forecast overlay segment for correct chart rendering
    forecastOverlay,
    
    // Verdict Engine data
    verdict: {
      verdictId: verdict.verdictId,
      action: verdict.action,
      confidence: verdict.confidence,
      expectedReturn: verdict.expectedReturn,
      risk: verdict.risk,
      horizon: verdict.horizon,
      positionSizePct: verdict.positionSizePct,
      modelId: verdict.modelId,
      regime: verdict.regime,
      raw: verdict.raw,
      adjustments: verdict.adjustments,
      appliedRules: verdict.appliedRules,
      // Block 1: Include health state
      health: verdict.health,
    },
    
    // All horizon candidates (for UI insights)
    candidates: allCandidates,
    
    // Meta-aware forecast (backwards compatible)
    metaForecast,
    
    outcomeMarkers,
    metrics,
    
    drivers: {
      exchange: Math.round((exchangeContrib - 0.5) * 200),
      onchain: 0,
      sentiment: 0,
      directionBias,
    },
    
    alignment: {
      score: Math.round(alignmentScore * 100) / 100,
      consensus,
      layerSignals: {
        exchange: exchangeDir,
        onchain: 0,
        sentiment: 0,
      },
      activeLayerCount: 1,
    },
    
    errorClusters,
  };
}

export async function verdictAdapterRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/market/chart/price-vs-expectation-v3
   * 
   * New endpoint using Verdict Engine
   * Backwards compatible with V2 frontend
   */
  fastify.get<{
    Querystring: {
      asset?: string;
      range?: string;
      horizon?: string;
      tf?: string;
    };
  }>('/api/market/chart/price-vs-expectation-v3', async (request) => {
    const {
      asset = 'BTC',
      range = '7d',
      horizon = '1D',
      tf = '1h',
    } = request.query;
    
    try {
      const data = await buildVerdictChartData(
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
        console.warn('[VerdictAdapter] Overlay failed:', e);
      }
      
      return {
        ok: true,
        ...data,
        overlay,
        flags: {
          dataSource: 'verdict_engine',
          onchainEnabled: false,
          sentimentEnabled: false,
          verdictEngineVersion: '1.0.0',
        },
        v3Contract: {
          version: '3.1.0',
          frozen: false,
          exchangeLayerStable: true,
          changeLog: [
            'v3.1.0: Verdict Engine integration (ensemble, multi-horizon)',
            'v3.0.0: Frozen exchange layer for production use',
          ],
        },
      };
    } catch (error: any) {
      console.error('[VerdictAdapter] Error:', error.message);
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  console.log('[VerdictAdapter] Routes registered');
}

export default verdictAdapterRoutes;
