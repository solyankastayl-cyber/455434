/**
 * FORECAST-ONLY ROUTES
 * ====================
 * 
 * V3.2: Synthetic forecast market (no real BTC candles)
 * V3.4: Auto-snapshot creation for outcome tracking
 * V3.5-V3.10: Quality + Drift + Confidence Modifier + Position Sizing
 * V3.11: ADAPTIVE TRAJECTORY ENGINE with learning bias
 * 
 * GET /api/market/forecast-only
 *   - Returns synthetic candles from Adaptive Trajectory
 *   - For Forecast/Exchange tabs
 *   - Uses quality/drift/health + 7D bias to shape trajectory
 *   - Completely detached from real price history
 *   - Auto-creates snapshot for outcome tracking
 * 
 * Key:
 *   - 1D = 2 candles (day0 + day1)
 *   - 7D = 8 candles (day0...day7)
 *   - 30D = 31 candles (day0...day30)
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { buildAdaptiveTrajectory, daySeedUTC, type QualityState, type DriftState, type HealthState } from './adaptive-trajectory.engine.js';
import { getLearningBiasService } from './learning-bias.service.js';
import { getForecastQualityService, type QualityResult } from './quality/forecast-quality.service.js';
import { getForecastDriftService, type DriftResult, type DriftState as DriftStateType } from './quality/forecast-drift.service.js';
import { getForecastConfidenceModifierService, type ConfidenceModifierResult } from './quality/forecast-confidence-modifier.service.js';
import { getPositionSizingService, type PositionSizingResult } from './quality/position-sizing.service.js';

export type ForecastLayer = 'forecast' | 'exchange' | 'onchain' | 'sentiment';
export type ForecastHorizon = '1D' | '7D' | '30D';

type GetVerdictFn = (args: { 
  symbol: string; 
  horizon: ForecastHorizon;
  layer?: ForecastLayer;
}) => Promise<{
  fromPrice: number;
  expectedMovePct: number;
  confidence: number;
} | null>;

type GetRecentClosesFn = (symbol: string) => Promise<number[]>;

// Optional: Snapshot creator for outcome tracking
type CreateSnapshotFn = (params: {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  startPrice: number;
  targetPrice: number;
  expectedMovePct: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
}) => Promise<string>;

export type ForecastOnlyResponse = {
  ok: boolean;
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  startPrice: number;
  targetPrice: number;
  expectedMovePct: number;
  confidence: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  volume?: Array<{ time: number; value: number; color: string }>; // V3.11: Volume data
  snapshotId?: string;  // V3.4: ID of created snapshot
  
  // V3.5-V3.10: Quality Engine
  quality?: {
    winRate: number;
    rollingWinRate: number;
    state: 'GOOD' | 'NEUTRAL' | 'WEAK';
    sampleCount: number;
  };
  drift?: {
    value: number;
    state: DriftStateType;
    historicalWinRate: number;
    rollingWinRate: number;
  };
  confidenceAdjustment?: {
    raw: number;
    adjusted: number;
    modifier: number;
    reasons: Array<{ code: string; value: number; note?: string }>;
  };
  positionSizing?: {
    positionPct: number;
    notionalHint: string;
    reasons: Array<{ code: string; value: number; note?: string }>;
  };
  
  // V3.11: Learning integration
  learning?: {
    bias7d: number;
    samples: number;
    horizonBiasMult: number;
    trendWeight: number;
    noiseWeight: number;
  };
};

function horizonToDays(h: ForecastHorizon): number {
  if (h === '1D') return 1;
  if (h === '7D') return 7;
  return 30;
}

function toDirection(pct: number): 'UP' | 'DOWN' | 'FLAT' {
  if (pct > 0.001) return 'UP';
  if (pct < -0.001) return 'DOWN';
  return 'FLAT';
}

export async function registerForecastOnlyRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    getVerdictForLayer: GetVerdictFn;
    getRecentCloses?: GetRecentClosesFn;
    createSnapshot?: CreateSnapshotFn;  // V3.4: Optional snapshot creator
  }
) {
  /**
   * GET /api/market/forecast-only
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   layer: forecast | exchange | onchain | sentiment
   *   horizon: 1D | 7D | 30D
   */
  app.get<{
    Querystring: {
      symbol?: string;
      layer?: string;
      horizon?: string;
    };
  }>('/api/market/forecast-only', async (request, reply) => {
    const {
      symbol = 'BTC',
      layer = 'forecast',
      horizon = '1D',
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const layerNorm = layer as ForecastLayer;
    const horizonNorm = horizon as ForecastHorizon;

    // Validate layer
    const validLayers: ForecastLayer[] = ['forecast', 'exchange', 'onchain', 'sentiment'];
    if (!validLayers.includes(layerNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_LAYER',
        message: `Layer must be one of: ${validLayers.join(', ')}`,
      });
    }

    // Validate horizon
    const validHorizons: ForecastHorizon[] = ['1D', '7D', '30D'];
    if (!validHorizons.includes(horizonNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: ${validHorizons.join(', ')}`,
      });
    }

    // Check if layer is frozen (onchain, sentiment)
    const frozenLayers: ForecastLayer[] = ['onchain', 'sentiment'];
    if (frozenLayers.includes(layerNorm)) {
      return reply.status(503).send({
        ok: false,
        error: 'LAYER_FROZEN',
        message: `Layer "${layerNorm}" is currently frozen. Use forecast or exchange.`,
      });
    }

    try {
      // Get verdict for this layer + horizon
      console.log(`[ForecastOnly] Calling getVerdictForLayer: ${symbolNorm}/${horizonNorm}/${layerNorm}`);
      const verdict = await deps.getVerdictForLayer({
        symbol: symbolNorm,
        horizon: horizonNorm,
        layer: layerNorm,
      });
      console.log(`[ForecastOnly] Verdict result:`, verdict);

      if (!verdict) {
        return reply.status(404).send({
          ok: false,
          error: 'VERDICT_NOT_FOUND',
          message: `No verdict available for ${symbolNorm} ${layerNorm} ${horizonNorm}`,
        });
      }

      const startPrice = verdict.fromPrice;
      const expectedMovePct = verdict.expectedMovePct;
      const targetPrice = startPrice * (1 + expectedMovePct);
      const days = horizonToDays(horizonNorm);
      const rawConfidence = verdict.confidence;

      // V3.5-V3.7: Get quality and drift metrics
      const qualityService = getForecastQualityService(deps.db);
      const driftService = getForecastDriftService(deps.db);
      const confidenceModifier = getForecastConfidenceModifierService();
      const positionSizer = getPositionSizingService();

      let qualityData: QualityResult | null = null;
      let driftData: DriftResult | null = null;

      try {
        [qualityData, driftData] = await Promise.all([
          qualityService.getQuality({ symbol: symbolNorm, layer: layerNorm, horizon: horizonNorm }),
          driftService.getDrift({ symbol: symbolNorm, layer: layerNorm, horizon: horizonNorm }),
        ]);
      } catch (qErr: any) {
        app.log.warn(`[ForecastOnly] Quality/Drift fetch failed: ${qErr.message}`);
      }

      // V3.8: Apply confidence modifier based on drift state
      let adjustedConfidence = rawConfidence;
      let confidenceAdjustmentData: ConfidenceModifierResult | null = null;

      if (driftData) {
        const healthState = driftData.state === 'CRITICAL' ? 'CRITICAL' 
          : driftData.state === 'DEGRADING' ? 'DEGRADING' 
          : 'HEALTHY';

        confidenceAdjustmentData = confidenceModifier.apply({
          rawConfidence,
          horizon: horizonNorm,
          healthState,
          rollingWinRate: driftData.rollingWinRate,
          historicalWinRate: driftData.historicalWinRate,
          drift: driftData.drift,
        });

        adjustedConfidence = confidenceAdjustmentData.adjustedConfidence;
      }

      // V3.10: Calculate position sizing
      let positionSizingData: PositionSizingResult | null = null;
      
      if (driftData) {
        const action = expectedMovePct > 0.003 ? 'BUY' 
          : expectedMovePct < -0.003 ? 'SELL' 
          : 'HOLD';

        positionSizingData = positionSizer.compute({
          action,
          confidence: adjustedConfidence,
          driftState: driftData.state,
          horizon: horizonNorm,
        });
      }

      // V3.11: Get learning bias from 7D outcomes
      const biasService = getLearningBiasService(deps.db);
      const biasResult = await biasService.get7dBias({ 
        symbol: symbolNorm, 
        layer: layerNorm, 
        lookbackDays: 45 
      });

      // Estimate volatility (default 1.0 normalized)
      let volDaily = 1.0;

      // V3.11: Build adaptive trajectory with learning integration
      const steps = days + 1; // 1D=2, 7D=8, 30D=31
      
      const qualityState: QualityState = qualityData?.qualityState ?? 'NEUTRAL';
      const driftState: DriftState = driftData?.state ?? 'HEALTHY';
      const healthState: HealthState = driftData?.state === 'CRITICAL' ? 'CRITICAL' 
        : driftData?.state === 'DEGRADING' ? 'DEGRADED' 
        : 'HEALTHY';

      const trajectory = buildAdaptiveTrajectory({
        startPrice,
        targetPrice,
        steps,
        volDaily,
        confidence: adjustedConfidence,
        quality: qualityState,
        drift: driftState,
        health: healthState,
        bias7d: biasResult.bias7d,
        seed: daySeedUTC(layerNorm === 'exchange' ? 11 : layerNorm === 'forecast' ? 7 : 3),
      });

      // Add timestamps to candles
      const startTime = new Date();
      startTime.setUTCHours(0, 0, 0, 0);
      
      const candles = trajectory.candles.map((c, i) => ({
        time: Math.floor((startTime.getTime() + i * 24 * 60 * 60 * 1000) / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // V3.11: Generate simulated volume (proportional to candle body size)
      const volume = trajectory.candles.map((c, i) => ({
        time: Math.floor((startTime.getTime() + i * 24 * 60 * 60 * 1000) / 1000),
        value: Math.abs(c.close - c.open) * 1000 + Math.random() * 500, // Simulated volume
        color: c.close >= c.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
      }));

      // Use trajectory's adjusted target (with bias correction)
      const finalTargetPrice = trajectory.target;

      // V3.4: Create snapshot for outcome tracking (if creator provided)
      let snapshotId: string | undefined;
      if (deps.createSnapshot) {
        try {
          snapshotId = await deps.createSnapshot({
            symbol: symbolNorm,
            layer: layerNorm,
            horizon: horizonNorm,
            startPrice,
            targetPrice: finalTargetPrice,
            expectedMovePct,
            direction: toDirection(expectedMovePct),
            confidence: adjustedConfidence,
          });
          if (snapshotId === 'EXISTS') {
            snapshotId = undefined;
          }
        } catch (snapshotErr: any) {
          app.log.warn(`[ForecastOnly] Snapshot creation failed: ${snapshotErr.message}`);
        }
      }

      // Build response with V3.11 learning data
      const response: ForecastOnlyResponse = {
        ok: true,
        symbol: symbolNorm,
        layer: layerNorm,
        horizon: horizonNorm,
        startPrice,
        targetPrice: finalTargetPrice,
        expectedMovePct,
        confidence: adjustedConfidence, // Return adjusted confidence
        direction: toDirection(expectedMovePct),
        candles,
        volume, // V3.11: Volume data
        snapshotId,
      };

      // Add quality data if available
      if (qualityData) {
        response.quality = {
          winRate: qualityData.winRate,
          rollingWinRate: qualityData.rollingWinRate,
          state: qualityData.qualityState,
          sampleCount: qualityData.sampleCount,
        };
      }

      // Add drift data if available
      if (driftData) {
        response.drift = {
          value: driftData.drift,
          state: driftData.state,
          historicalWinRate: driftData.historicalWinRate,
          rollingWinRate: driftData.rollingWinRate,
        };
      }

      // Add confidence adjustment details
      if (confidenceAdjustmentData) {
        response.confidenceAdjustment = {
          raw: rawConfidence,
          adjusted: adjustedConfidence,
          modifier: confidenceAdjustmentData.modifier,
          reasons: confidenceAdjustmentData.reasons,
        };
      }

      // Add position sizing
      if (positionSizingData) {
        response.positionSizing = {
          positionPct: positionSizingData.positionPct,
          notionalHint: positionSizingData.notionalHint,
          reasons: positionSizingData.reasons,
        };
      }

      // V3.11: Add learning data with simulation info
      response.learning = {
        bias7d: biasResult.bias7d,
        effectiveBias: trajectory.effectiveBias,
        samples: biasResult.samples,
        horizonBiasMult: trajectory.horizonBiasMult,
        trendWeight: trajectory.trendWeight,
        noiseWeight: trajectory.noiseWeight,
        simulation: trajectory.simulation,
      };

      return reply.send(response);
    } catch (err: any) {
      app.log.error(`[ForecastOnly] Error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  app.log.info('[ForecastOnly] Routes registered (V3.11 Adaptive Bridge)');
}

console.log('[ForecastOnlyRoutes] Module loaded (V3.11 Adaptive Bridge)');
