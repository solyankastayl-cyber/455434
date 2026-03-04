/**
 * VERDICT V4 ROUTES (FAST API)
 * ============================
 * 
 * P3: Smart Caching Layer - Blocks 13-28
 * Fast API endpoint with stale-while-revalidate pattern.
 * 
 * GET /api/market/chart/price-vs-expectation-v4
 * 
 * Features:
 * - Uses heavy verdict cache (Block 1)
 * - Applies light overlay in real-time (Block 2)
 * - Request coalescing (Block 3, 16)
 * - ML micro-cache (Block 4)
 * - Stability guard for anti-jerk (Block 5)
 * - TTL Auto-Refresh + Stale-While-Revalidate (Block 13, 26)
 * - Cache Key Normalization (Block 14)
 * - Smart Cache Invalidation (Block 15)
 * - In-Flight Lock / Single-Flight (Block 16, 22)
 * - Smart TTL per horizon (Block 23)
 * - Stampede Protection (Block 25)
 * - Background Warmup integration (Block 27)
 * - Metrics recording (Block 16)
 * - Target latency: <100ms for cache hit, <2s for cache miss
 */

import { FastifyInstance } from 'fastify';
import { heavyVerdictStore } from '../runtime/heavy-verdict.store.js';
import { heavyComputeService } from '../runtime/heavy-compute.service.js';
import { lightOverlayService } from '../runtime/light-overlay.service.js';
import { overlayInputsBuilder } from '../runtime/overlay.inputs.builder.js';
import { verdictStabilityGuard } from '../runtime/verdict-stability.guard.js';
import { requestCoalescer } from '../../shared/runtime/request-coalescer.js';
import { normalizeSymbol } from '../../shared/runtime/symbol-normalizer.js';
import { cacheMetricsService } from '../../shared/runtime/cache-metrics.service.js';
import { getPriceChartData } from '../../chart/services/price.service.js';
import { buildRealtimeOverlay } from '../../chart/services/realtime_overlay.service.js';
import * as forecastRepo from '../../exchange/forecast/forecast.repository.js';
import type { ForecastHorizon } from '../runtime/heavy-verdict.types.js';
import type { ChartRange, ChartTimeframe } from '../../chart/contracts/chart.types.js';
import type { ForecastPoint } from '../../exchange/forecast/forecast.types.js';
// BLOCK A: Explain builder for model transparency
import { 
  buildExplainSnapshot, 
  extractOverlayDeltas, 
  extractTopSignals,
  type ExplainSnapshot,
  type HorizonType
} from '../services/explain.builder.js';

const RANGE_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const HORIZON_MS: Record<ForecastHorizon, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

type CacheStatus = 'FRESH' | 'STALE' | 'MISS';

export async function verdictV4Routes(fastify: FastifyInstance) {
  /**
   * GET /api/market/chart/price-vs-expectation-v4
   * 
   * Fast API with caching
   */
  fastify.get<{
    Querystring: {
      asset?: string;
      range?: string;
      horizon?: string;
      tf?: string;
    };
  }>('/api/market/chart/price-vs-expectation-v4', async (request, reply) => {
    const t0 = Date.now();
    const timings: Record<string, number> = {};

    const {
      asset = 'BTC',
      range = '7d',
      horizon = '1D',
      tf = '1h',
    } = request.query;

    // Block 14: Normalize symbol to prevent cache fragmentation
    const symbolNorm = normalizeSymbol(asset);
    const symbolFull = symbolNorm.includes('USDT') ? symbolNorm : `${symbolNorm}USDT`;
    const selectedHorizon = horizon as ForecastHorizon;
    const chartRange = range as ChartRange;

    try {
      // 1. Get heavy verdict from cache (or compute if miss)
      // Block 25-26: Use getWithSWR for stampede protection + stale-while-revalidate
      const heavyKey = heavyVerdictStore.makeKey({ symbol: symbolNorm, horizon: selectedHorizon });
      
      let cacheStatus: CacheStatus = 'MISS';
      let heavy = null;
      let cacheAgeMs = 0;

      // Check cache with SWR pattern
      const tCache0 = Date.now();
      const cached = heavyVerdictStore.getStaleOk(heavyKey);
      timings.cacheCheck = Date.now() - tCache0;

      if (cached.value && !cached.isStale) {
        // Fresh cache hit - return immediately
        cacheStatus = 'FRESH';
        heavy = cached.value;
        cacheAgeMs = cached.ageMs;
        // Block 16: Record cache hit
        cacheMetricsService.recordCacheHit(heavyKey);
      } else if (cached.value && cached.isStale) {
        // Block 13, 26: Stale cache hit - return old immediately + trigger background refresh
        cacheStatus = 'STALE';
        heavy = cached.value;
        cacheAgeMs = cached.ageMs;
        // Block 16: Record stale hit
        cacheMetricsService.recordCacheHit(heavyKey, true);

        // Block 22: Check if not already computing (single-flight)
        if (!heavyVerdictStore.isComputing(heavyKey)) {
          // Block 13.3: Background refresh
          const refreshPromise = (async () => {
            heavyVerdictStore.markComputing(heavyKey);
            try {
              const tCompute = Date.now();
              const fresh = await heavyComputeService.compute(symbolNorm, selectedHorizon);
              // Block 23: Use horizon-aware TTL
              heavyVerdictStore.setWithHorizon(heavyKey, fresh, selectedHorizon);
              // Block 16: Record compute time
              cacheMetricsService.recordComputeTime(heavyKey, Date.now() - tCompute);
              return fresh;
            } catch (e) {
              console.warn(`[V4] Background refresh failed for ${heavyKey}:`, e);
              return cached.value!;
            } finally {
              heavyVerdictStore.clearComputing(heavyKey);
            }
          })();
          heavyVerdictStore.setInFlight(heavyKey, refreshPromise);
        }
      } else {
        // Cache miss - compute with stampede protection (Block 25)
        cacheStatus = 'MISS';
        const tCompute0 = Date.now();
        // Block 16: Record cache miss
        cacheMetricsService.recordCacheMiss(heavyKey);
        
        // Block 25: Use getOrCreate for stampede protection
        heavy = await heavyVerdictStore.getOrCreate(
          heavyKey,
          async () => {
            const computed = await heavyComputeService.compute(symbolNorm, selectedHorizon);
            // Block 16: Record compute time
            cacheMetricsService.recordComputeTime(heavyKey, computed.computeMs);
            return computed;
          },
          selectedHorizon
        );
        
        timings.heavyCompute = Date.now() - tCompute0;
      }

      // 2. Build light overlay inputs (fast)
      const tOverlay0 = Date.now();
      const overlayInputs = await overlayInputsBuilder.build(symbolNorm);
      timings.overlayInputs = Date.now() - tOverlay0;

      // 3. Apply light overlay
      const tOverlayApply0 = Date.now();
      const rawConfidence = heavy?.verdict?.confidence ?? 0;
      const overlay = lightOverlayService.apply(rawConfidence, overlayInputs);
      timings.overlayApply = Date.now() - tOverlayApply0;

      // 4. Fetch price data for chart (separate from heavy compute)
      const tPrice0 = Date.now();
      const priceData = await getPriceChartData(symbolFull, chartRange, tf as ChartTimeframe);
      timings.priceData = Date.now() - tPrice0;

      const now = Date.now();
      const lastPrice = priceData.points?.[priceData.points.length - 1]?.price || 0;
      const rangeMs = RANGE_MS[chartRange] || RANGE_MS['7d'];
      const fromTs = now - rangeMs;

      // 5. Get historical forecasts for chart
      const tForecasts0 = Date.now();
      const [allForecasts, metrics] = await Promise.all([
        forecastRepo.listForecasts(symbolNorm, fromTs, now, selectedHorizon),
        forecastRepo.calculateMetrics(symbolNorm, selectedHorizon, 30),
      ]);
      timings.forecasts = Date.now() - tForecasts0;

      // Build forecast history
      const forecastHistory: ForecastPoint[] = allForecasts
        .filter(f => f.evaluated)
        .map(forecastRepo.toForecastPoint);

      // 6. Build response with merged heavy + light data
      // FIX: Use data from requested horizon candidate, not engine-selected verdict
      const candidates = heavy?.candidates || [];
      const requestedCandidate = candidates.find((c: any) => c.horizon === selectedHorizon);
      
      // Use requested horizon data if available, fallback to verdict
      const horizonExpectedReturn = requestedCandidate?.expectedReturn ?? verdict.expectedReturn ?? 0;
      const horizonConfidence = requestedCandidate?.confidence ?? verdict.confidence ?? 0;
      const horizonAction = requestedCandidate?.action ?? verdict.action ?? 'HOLD';
      
      const verdict = heavy?.verdict || {};
      const finalConfidence = overlay.adjustedConfidence;
      const direction = horizonAction === 'BUY' ? 'UP' : 
                       horizonAction === 'SELL' ? 'DOWN' : 'FLAT';
      
      // Block 5: Apply stability guard to prevent verdict jitter
      const tStability0 = Date.now();
      const stabilizedVerdict = verdictStabilityGuard.apply({
        symbol: symbolNorm,
        ts: now,
        direction: direction as 'UP' | 'DOWN' | 'FLAT',
        confidenceAdjusted: horizonConfidence * overlay.modifier,
        expectedMovePctAdjusted: horizonExpectedReturn * 100,
        action: horizonAction,
        positionSize: verdict.positionSize || 0,
        macroRegime: overlayInputs.macro?.regime,
        riskLevel: overlayInputs.macro?.riskLevel,
        fundingCrowdedness: overlayInputs.funding?.crowdedness,
      });
      timings.stabilityGuard = Date.now() - tStability0;

      // Use stabilized values
      const stableDirection = stabilizedVerdict.stable.direction;
      const stableConfidence = stabilizedVerdict.stable.confidence;
      const stableAction = stabilizedVerdict.stable.action;
      
      // FIX: Use horizon-specific expectedReturn for targetPrice calculation
      const targetPrice = lastPrice * (1 + horizonExpectedReturn);
      const bandWidth = lastPrice * Math.abs(horizonExpectedReturn) * (1 - stableConfidence);

      const forecastHorizonMs = HORIZON_MS[selectedHorizon] || HORIZON_MS['1D'];
      const forecastEndTs = now + forecastHorizonMs;

      const futurePoint: ForecastPoint = {
        ts: forecastEndTs,
        horizon: selectedHorizon,
        basePrice: lastPrice,
        targetPrice,
        expectedMovePct: horizonExpectedReturn * 100,
        direction: stableDirection,
        confidence: stableConfidence,
        upperBand: targetPrice + bandWidth,
        lowerBand: targetPrice - bandWidth,
        evaluated: false,
      };

      // Forecast overlay segment
      const forecastOverlay = {
        fromTs: now,
        toTs: forecastEndTs,
        fromPrice: lastPrice,
        targetPrice,
        direction: stableDirection,
        confidence: stableConfidence,
        expectedMovePct: horizonExpectedReturn * 100,
        horizon: selectedHorizon,
        action: stableAction,
        risk: verdict.risk || 'MEDIUM',
        renderAs: 'markLine',
        color: stableDirection === 'UP' ? '#22c55e' : stableDirection === 'DOWN' ? '#ef4444' : '#6b7280',
        volatility: heavy?.layers?.features?.volatility_1d || 0.03,
        healthState: verdict.health?.state || 'HEALTHY',
        healthModifier: verdict.health?.modifier || 1.0,
        bandWidthFactors: {
          baseWidth: bandWidth,
          volatilityContribution: (heavy?.layers?.features?.volatility_1d || 0.03) * lastPrice * 0.5,
          uncertaintyContribution: (1 - stableConfidence) * lastPrice * Math.abs(horizonExpectedReturn),
        },
        // Block 5: Stability info
        stability: {
          isStabilized: stabilizedVerdict.stable.meta.smoothed || false,
          wasShock: stabilizedVerdict.stable.meta.shock || false,
          rawDirection: direction,
          rawConfidence: horizonConfidence,
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

      // Meta-aware forecast data
      const metaForecast = {
        raw: {
          direction: (verdict.raw?.expectedReturn || 0) > 0 ? 'UP' : 
                    (verdict.raw?.expectedReturn || 0) < 0 ? 'DOWN' : 'FLAT',
          confidence: verdict.raw?.confidence || 0,
          expectedMovePct: (verdict.raw?.expectedReturn || 0) * 100,
        },
        direction: stableDirection,
        confidence: stableConfidence,
        expectedMovePct: horizonExpectedReturn * 100,
        targetPrice,
        action: stableAction,
        riskLevel: verdict.risk || 'MEDIUM',
        appliedOverlays: [
          ...((verdict.adjustments || []).map((adj: any) => ({
            id: adj.key,
            source: adj.stage,
            effect: adj.deltaConfidence ? 'ADJUST_CONFIDENCE' : 'ADJUST_RETURN',
            value: adj.deltaConfidence || adj.deltaReturn || 0,
            reason: adj.notes || '',
          }))),
          // Add light overlay adjustments
          ...overlay.adjustments.map(adj => ({
            id: adj.key,
            source: 'LIGHT_OVERLAY',
            effect: 'ADJUST_CONFIDENCE',
            value: adj.deltaPct,
            reason: adj.note,
          })),
        ],
        isMetaAdjusted: (verdict.adjustments?.length || 0) > 0 || overlay.adjustments.length > 0,
      };

      // Get realtime overlay
      let realtimeOverlay = null;
      try {
        realtimeOverlay = await buildRealtimeOverlay(symbolNorm);
      } catch (e) {
        console.warn('[V4] Overlay failed:', e);
      }

      // BLOCK A: Build explain snapshot for model transparency
      const { overlayAdjustments, overlayLabels } = extractOverlayDeltas(
        verdict.adjustments || []
      );
      
      // Add light overlay adjustments to overlay deltas
      for (const adj of overlay.adjustments) {
        if (adj.key.includes('MACRO')) {
          overlayAdjustments.macro += (adj.deltaPct / 100);
        } else if (adj.key.includes('FUNDING')) {
          overlayAdjustments.funding += (adj.deltaPct / 100);
        }
      }
      
      // Extract top signals from features
      const topSignals = extractTopSignals(
        heavy?.layers?.features || {},
        verdict.adjustments
      );
      
      // Build explain object
      const explain: ExplainSnapshot = buildExplainSnapshot({
        horizon: selectedHorizon as HorizonType,
        rawConfidence: verdict.raw?.confidence || 0,
        adjustedConfidence: stableConfidence,
        expectedMovePct: (verdict.expectedReturn || 0) * 100,
        action: stableAction,
        layerScores: {
          exchange: 1.0, // Currently only exchange layer is active
          onchain: 0,    // Frozen
          sentiment: 0,  // Frozen
        },
        overlayAdjustments,
        overlayLabels,
        topSignals,
      });

      const totalMs = Date.now() - t0;

      return {
        ok: true,
        
        // Cache metadata
        __cache: {
          status: cacheStatus,
          ageMs: cacheAgeMs,
          key: heavyKey,
          computedAt: heavy?.computedAt || null,
          heavyComputeMs: heavy?.computeMs || 0,
        },

        // Timing metadata
        __timings: {
          totalMs,
          ...timings,
        },

        // Chart data
        asset: symbolNorm,
        range: chartRange,
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
            futureBand: {
              ts: forecastEndTs,
              upper: targetPrice + bandWidth,
              lower: targetPrice - bandWidth,
            },
          },
          meta: {
            forecastHistory,
            futurePoint,
            futureBand: {
              ts: forecastEndTs,
              upper: targetPrice + bandWidth,
              lower: targetPrice - bandWidth,
            },
          },
        },

        forecastOverlay,

        // Verdict with overlay applied - use horizon-specific data
        verdict: {
          ...verdict,
          horizon: selectedHorizon,
          expectedReturn: horizonExpectedReturn,
          confidence: stableConfidence,
          action: stableAction,
          overlay: {
            inputs: overlayInputs,
            result: overlay,
          },
        },

        // All horizon candidates
        candidates: heavy?.candidates || [],

        metaForecast,
        outcomeMarkers,
        metrics,

        // BLOCK A: Explain snapshot for model transparency
        explain,

        overlay: realtimeOverlay,

        flags: {
          dataSource: 'verdict_engine_v4',
          cacheEnabled: true,
          onchainEnabled: false,
          sentimentEnabled: false,
          verdictEngineVersion: '4.1.0',
        },

        v4Contract: {
          version: '4.2.0',
          frozen: false,
          features: [
            'Heavy verdict caching with LRU eviction (Block 18)',
            'Smart TTL per horizon: 1D=2min, 7D=5min, 30D=10min (Block 23)',
            'Stale-while-revalidate pattern (Block 13, 26)',
            'Stampede protection / Single-flight (Block 16, 22, 25)',
            'Light overlay real-time adjustments (Block 20)',
            'Background warmup job (Block 24, 27)',
            'Auto-cleanup every 60s (Block 18)',
            'Memory safety: max 300 entries (Block 18)',
            'BLOCK A: Explain snapshot for model transparency',
          ],
        },
      };
    } catch (error: any) {
      console.error('[V4] Error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: error.message,
        __timings: { totalMs: Date.now() - t0 },
      });
    }
  });

  console.log('[VerdictV4] Routes registered');
}

export default verdictV4Routes;
