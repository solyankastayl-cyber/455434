/**
 * UNIFIED FRACTAL ENDPOINT FOR SPX
 * 
 * Provides SPX data in BTC-compatible FractalSignalContract format.
 * Frontend can consume /api/fractal/spx exactly like /api/fractal/btc.
 * 
 * @module fractal/api/spx
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildSpxFocusPack, type SpxFocusPack } from '../../spx-core/spx-focus-pack.builder.js';
import { adaptSpxToFractal, type FractalSignalContract } from '../../spx/adapters/spx-to-fractal.adapter.js';
import { isValidSpxHorizon, type SpxHorizonKey } from '../../spx-core/spx-horizon.config.js';
import { resolveSpxStrategy, type SpxStrategyPreset, type SpxVolRegime } from '../../spx/strategy/spx-strategy.service.js';
import { getMetricsSummary, getEquityCurve } from '../../forward/services/forward_metrics.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface SpxQueryParams {
  focus?: string;
  mode?: 'full' | 'compact';
}

interface SpxApiResponse {
  ok: boolean;
  symbol: 'SPX';
  focus: string;
  processingTimeMs: number;
  data: FractalSignalContract;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxUnifiedRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal';

  /**
   * GET /api/fractal/spx
   * 
   * Returns SPX data in FractalSignalContract format (BTC-compatible).
   * This is the PRIMARY endpoint for frontend consumption.
   * 
   * Query params:
   * - focus: horizon (default: 30d) - 7d, 14d, 30d, 90d, 180d, 365d
   * - mode: 'full' | 'compact' (default: full)
   */
  fastify.get(`${prefix}/spx`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxQueryParams;
    const focus = query.focus || '30d';
    const mode = query.mode || 'full';
    
    // Validate horizon
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}. Valid options: 7d, 14d, 30d, 90d, 180d, 365d`,
      });
    }
    
    try {
      const t0 = Date.now();
      
      // Step 1: Build SPX focus pack (native format)
      const focusPack: SpxFocusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      
      // Step 2: Adapt to FractalSignalContract (BTC-compatible)
      const fractalContract: FractalSignalContract = adaptSpxToFractal(focusPack);
      
      const processingTimeMs = Date.now() - t0;
      
      // Compact mode returns minimal data
      if (mode === 'compact') {
        return {
          ok: true,
          symbol: 'SPX',
          focus,
          processingTimeMs,
          data: {
            contract: fractalContract.contract,
            decision: fractalContract.decision,
            market: fractalContract.market,
            diagnostics: {
              similarity: fractalContract.diagnostics.similarity,
              quality: fractalContract.diagnostics.quality,
            },
          },
        };
      }
      
      // Full mode returns complete contract
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs,
        data: fractalContract,
      } as SpxApiResponse;
      
    } catch (error: any) {
      fastify.log.error(`[Fractal SPX] Error: ${error.message}`);
      
      if (error.message?.includes('INSUFFICIENT_DATA')) {
        return reply.code(503).send({
          ok: false,
          error: error.message,
          hint: 'SPX historical data not available. Run data ingestion first.',
        });
      }
      
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });

  /**
   * GET /api/fractal/spx/replay
   * 
   * Returns replay data for selected historical match.
   * UNIFIED: Returns format compatible with BTC replay-pack.builder
   */
  fastify.get(`${prefix}/spx/replay`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; matchIndex?: string };
    const focus = query.focus || '30d';
    const matchIndex = parseInt(query.matchIndex || '0', 10);
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}`,
      });
    }
    
    try {
      const t0 = Date.now();
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      const fractalContract = adaptSpxToFractal(focusPack);
      
      const selectedMatch = fractalContract.explain.topMatches[matchIndex];
      if (!selectedMatch) {
        return reply.code(404).send({
          ok: false,
          error: `Match at index ${matchIndex} not found`,
        });
      }
      
      // Get overlay match for replay path
      const overlayMatch = focusPack.overlay.matches[matchIndex];
      const anchorPrice = focusPack.price.current;
      const horizonDays = focusPack.meta.aftermathDays;
      
      // Build unified replay path (t=0 = NOW, anchored to current price)
      // This matches the format from unified-path.builder.ts
      const replayPath: Array<{ t: number; price: number; pct: number }> = [];
      
      // t=0 = NOW (anchor)
      replayPath.push({
        t: 0,
        price: anchorPrice,
        pct: 0,
      });
      
      // t=1..N from aftermath normalized returns
      const aftermath = overlayMatch?.aftermathNormalized || [];
      for (let t = 1; t <= horizonDays; t++) {
        const idx = t - 1;
        const pctReturn = aftermath[idx] ?? 0;
        replayPath.push({
          t,
          price: anchorPrice * (1 + pctReturn),
          pct: pctReturn * 100, // Convert to percentage
        });
      }
      
      // Return in replayPack format (compatible with BTC)
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        replayPack: {
          matchId: selectedMatch.id,
          matchMeta: {
            similarity: selectedMatch.similarity,
            phase: selectedMatch.phase,
            date: selectedMatch.id,
            score: selectedMatch.similarity * 100,
          },
          replayPath,
          outcomes: calculateMatchOutcomes(replayPath, horizonDays),
        },
        // Also include legacy format for backward compatibility
        selectedMatch: {
          ...selectedMatch,
          replayPath,
        },
        chartData: fractalContract.chartData,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * Calculate outcomes at standard horizon checkpoints
   */
  function calculateMatchOutcomes(
    replayPath: Array<{ t: number; price: number; pct: number }>,
    maxHorizon: number
  ): Array<{ horizon: string; return: number; maxDD: number; hitTarget: boolean }> {
    const horizons = [7, 14, 30, 90, 180, 365].filter(h => h <= maxHorizon);
    const outcomes: Array<{ horizon: string; return: number; maxDD: number; hitTarget: boolean }> = [];
    
    for (const h of horizons) {
      const point = replayPath[h];
      if (!point) continue;
      
      // Calculate max drawdown up to this horizon
      let maxDD = 0;
      let peak = replayPath[0].price;
      for (let i = 1; i <= h && i < replayPath.length; i++) {
        const price = replayPath[i].price;
        peak = Math.max(peak, price);
        const dd = (peak - price) / peak;
        maxDD = Math.max(maxDD, dd);
      }
      
      outcomes.push({
        horizon: `${h}d`,
        return: point.pct,
        maxDD: maxDD * 100,
        hitTarget: point.pct > 0,
      });
    }
    
    return outcomes;
  }

  /**
   * GET /api/fractal/spx/hybrid
   * 
   * Returns hybrid projection combining synthetic + primary match.
   */
  fastify.get(`${prefix}/spx/hybrid`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}`,
      });
    }
    
    try {
      const t0 = Date.now();
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      const fractalContract = adaptSpxToFractal(focusPack);
      
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        hybrid: {
          syntheticPath: fractalContract.chartData.path,
          bands: fractalContract.chartData.bands,
          primaryMatch: focusPack.primarySelection.primaryMatch,
          divergence: focusPack.divergence,
        },
        market: fractalContract.market,
        decision: fractalContract.decision,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/fractal/spx/consensus
   * 
   * Returns multi-horizon consensus data.
   */
  fastify.get(`${prefix}/spx/consensus`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const t0 = Date.now();
      
      // Build for multiple horizons
      const horizons: SpxHorizonKey[] = ['7d', '14d', '30d', '90d'];
      const results = await Promise.all(
        horizons.map(async (h) => {
          try {
            const pack = await buildSpxFocusPack(h);
            return {
              horizon: h,
              medianReturn: pack.overlay.stats.medianReturn,
              hitRate: pack.overlay.stats.hitRate,
              action: pack.overlay.stats.medianReturn > 0.02 ? 'LONG' : 
                      pack.overlay.stats.medianReturn < -0.02 ? 'SHORT' : 'HOLD',
              confidence: pack.diagnostics.reliability,
            };
          } catch {
            return {
              horizon: h,
              medianReturn: 0,
              hitRate: 0,
              action: 'HOLD' as const,
              confidence: 0,
            };
          }
        })
      );
      
      // Calculate consensus
      const actions = results.map(r => r.action);
      const longCount = actions.filter(a => a === 'LONG').length;
      const shortCount = actions.filter(a => a === 'SHORT').length;
      
      let consensusAction: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
      if (longCount >= 3) consensusAction = 'LONG';
      else if (shortCount >= 3) consensusAction = 'SHORT';
      
      const consensusStrength = Math.max(longCount, shortCount, actions.filter(a => a === 'HOLD').length) / horizons.length;
      
      return {
        ok: true,
        symbol: 'SPX',
        processingTimeMs: Date.now() - t0,
        consensus: {
          action: consensusAction,
          strength: consensusStrength,
          horizonBreakdown: results,
        },
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/fractal/spx/strategy
   * 
   * SPX Strategy Engine v1 - Actionable trading recommendations.
   * 
   * Query params:
   * - horizon: 7d, 14d, 30d, 90d, 180d, 365d (default: 30d)
   * - preset: CONSERVATIVE | BALANCED | AGGRESSIVE (default: BALANCED)
   * 
   * Returns:
   * - action: BUY | HOLD | REDUCE
   * - confidence: LOW | MEDIUM | HIGH
   * - size: 0-1 position multiplier
   * - reasons: Why this recommendation
   * - riskNotes: What risks to watch
   */
  fastify.get(`${prefix}/spx/strategy`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { horizon?: string; preset?: string };
    const horizon = query.horizon || '30d';
    const preset = (query.preset?.toUpperCase() || 'BALANCED') as SpxStrategyPreset;
    
    // Validate horizon
    if (!isValidSpxHorizon(horizon)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${horizon}. Valid options: 7d, 14d, 30d, 90d, 180d, 365d`,
      });
    }
    
    // Validate preset
    const validPresets: SpxStrategyPreset[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
    if (!validPresets.includes(preset)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid preset: ${preset}. Valid options: CONSERVATIVE, BALANCED, AGGRESSIVE`,
      });
    }
    
    try {
      const t0 = Date.now();
      
      // Build focus pack for the horizon
      const focusPack = await buildSpxFocusPack(horizon as SpxHorizonKey);
      
      // Extract strategy input from focusPack
      const stats = focusPack.overlay.stats;
      const diagnostics = focusPack.diagnostics;
      const phase = focusPack.phase;
      
      // Determine volatility regime
      let volRegime: SpxVolRegime = 'NORMAL';
      if (phase.volatility === 'HIGH') {
        volRegime = 'ELEVATED';
      }
      // Check for crisis conditions (very high drawdown or extreme entropy)
      if (Math.abs(stats.avgMaxDD) > 25 || diagnostics.entropy > 0.9) {
        volRegime = 'CRISIS';
      }
      
      // Build strategy input
      // NOTE: stats.medianReturn and stats.p10Return are in % (e.g., 2.4 = 2.4%)
      // Strategy expects values in decimals (e.g., 0.024 = 2.4%)
      // Also apply guardrails for realistic SPX bounds
      
      // Horizon-specific guardrails for SPX (realistic max returns)
      const horizonGuardrails: Record<string, { maxReturn: number; minReturn: number }> = {
        '7d': { maxReturn: 0.10, minReturn: -0.10 },
        '14d': { maxReturn: 0.15, minReturn: -0.15 },
        '30d': { maxReturn: 0.20, minReturn: -0.20 },
        '90d': { maxReturn: 0.35, minReturn: -0.35 },
        '180d': { maxReturn: 0.50, minReturn: -0.50 },
        '365d': { maxReturn: 0.70, minReturn: -0.70 },
      };
      
      const guardrail = horizonGuardrails[horizon] || { maxReturn: 0.30, minReturn: -0.30 };
      
      // Convert from % to decimal and apply guardrails
      let forecastReturn = stats.medianReturn / 100; // Convert % to decimal
      forecastReturn = Math.max(guardrail.minReturn, Math.min(guardrail.maxReturn, forecastReturn));
      
      let tailRisk = stats.p10Return / 100; // Convert % to decimal
      tailRisk = Math.max(-0.80, Math.min(0, tailRisk)); // Tail risk should be negative and capped at -80%
      
      const strategyInput = {
        forecastReturn,
        probUp: stats.hitRate,
        entropy: diagnostics.entropy,
        tailRisk,
        volRegime,
        phase: phase.phase,
        preset,
        horizon,
      };
      
      // Resolve strategy
      const strategy = resolveSpxStrategy(strategyInput);
      
      const processingTimeMs = Date.now() - t0;
      
      return {
        ok: true,
        ...strategy,
        processingTimeMs,
        // Additional context for UI
        context: {
          currentPrice: focusPack.price.current,
          sma200: focusPack.price.sma200,
          sma200Position: focusPack.price.current > focusPack.price.sma200 ? 'ABOVE' : 'BELOW',
          sampleSize: diagnostics.sampleSize,
          effectiveN: diagnostics.effectiveN,
          coverageYears: diagnostics.coverageYears,
        },
      };
      
    } catch (error: any) {
      fastify.log.error(`[SPX Strategy] Error: ${error.message}`);
      
      if (error.message?.includes('INSUFFICIENT_DATA')) {
        return reply.code(503).send({
          ok: false,
          error: error.message,
          hint: 'SPX historical data not available. Run data ingestion first.',
        });
      }
      
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });

  /**
   * GET /api/fractal/spx/forward/summary
   * 
   * FP4: Production-ready forward performance metrics.
   * Returns aggregated hit rate, avgReturn, bias by horizon.
   * 
   * Query params:
   * - horizon: optional, e.g. "30d" to filter single horizon
   */
  fastify.get(`${prefix}/spx/forward/summary`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { horizon?: string };
    
    try {
      const summary = await getMetricsSummary("SPX");
      
      // FP7: Return default metrics if none available (cold start)
      if (!summary) {
        const defaultMetrics = {
          ok: true,
          asset: "SPX",
          asOf: new Date().toISOString(),
          window: "ALL_TIME",
          overall: {
            hitRate: 0,
            avgReturn: 0,
            avgForecastReturn: 0,
            bias: 0,
            trades: 0,
          },
          byHorizon: [
            { horizonDays: 7, hitRate: 0, avgReturn: 0, trades: 0 },
            { horizonDays: 14, hitRate: 0, avgReturn: 0, trades: 0 },
            { horizonDays: 30, hitRate: 0, avgReturn: 0, trades: 0 },
          ],
          updatedAt: new Date().toISOString(),
          note: "No forward performance data yet. Metrics will appear after signals resolve.",
        };
        return defaultMetrics;
      }
      
      // Optional: filter by horizon
      const horizon = query.horizon;
      if (horizon) {
        const days = parseInt(horizon.replace("d", ""));
        const filtered = summary.byHorizon.find(h => h.horizonDays === days);
        if (!filtered) {
          // Return default for missing horizon
          return { ok: true, asset: "SPX", horizon, metrics: { horizonDays: days, hitRate: 0, avgReturn: 0, trades: 0 } };
        }
        return { ok: true, asset: "SPX", horizon, metrics: filtered };
      }
      
      return { ok: true, ...summary };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });

  /**
   * GET /api/fractal/spx/forward/equity
   * 
   * FP6: Equity curve visualization data.
   * Returns cumulative performance over time.
   * 
   * Query params:
   * - horizon: optional, e.g. "30d" to filter single horizon
   */
  fastify.get(`${prefix}/spx/forward/equity`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { horizon?: string };
    
    try {
      const horizonDays = query.horizon ? parseInt(query.horizon.replace("d", "")) : undefined;
      const curve = await getEquityCurve({ asset: "SPX", horizonDays });
      
      // FP7: Return default equity curve if none available
      if (!curve || !curve.equity || curve.equity.length === 0) {
        return { 
          ok: true, 
          equity: [], 
          maxDD: 0, 
          trades: 0,
          winRate: 0,
          note: "No equity data yet. Will appear after signals resolve." 
        };
      }
      
      return { ok: true, ...curve };
      
    } catch (error: any) {
      // Return empty default on error instead of 500
      return { 
        ok: true, 
        equity: [], 
        maxDD: 0, 
        trades: 0,
        winRate: 0,
        note: "Unable to compute equity curve." 
      };
    }
  });

  /**
   * GET /api/fractal/spx/overlay/debug
   * 
   * DEBUG ENDPOINT: Validate Cross-Asset Overlay computation
   * Returns full breakdown of overlay calculation for validation.
   * 
   * Query params:
   * - horizon: 7d, 14d, 30d, 90d (default: 30d)
   */
  fastify.get(`${prefix}/spx/overlay/debug`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { horizon?: string };
    const horizon = query.horizon || '30d';
    
    if (!isValidSpxHorizon(horizon)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${horizon}`,
      });
    }
    
    try {
      const t0 = Date.now();
      
      // Import overlay service
      const { computeCrossAssetOverlay, validateOverlay, BETA_BY_HORIZON, CORRELATION_BY_HORIZON, STABILITY_BY_HORIZON } = 
        await import('../../spx/services/cross-asset-overlay.service.js');
      
      // Build SPX focus pack
      const focusPack = await buildSpxFocusPack(horizon as SpxHorizonKey);
      const fractalContract = adaptSpxToFractal(focusPack);
      
      // Get SPX hybrid returns (convert path to log returns)
      const spxPath = fractalContract.chartData.path || [];
      const currentSpxPrice = focusPack.price.current;
      let spxHybridReturns = spxPath.map(p => Math.log(p / currentSpxPrice));
      
      // Get DXY macro data from real DXY endpoint
      let dxyMacroReturns: number[] = [];
      let dxyCurrentLevel = 100;
      let dxyDataAvailable = false;
      let dxyPath: number[] = [];
      
      try {
        // Fetch real DXY data from /api/fractal/dxy endpoint
        const dxyResponse = await fetch(`http://127.0.0.1:8002/api/fractal/dxy?focus=${horizon}`);
        const dxyResult = await dxyResponse.json();
        
        if (dxyResult.ok && dxyResult.data?.path) {
          dxyPath = dxyResult.data.path;
          dxyCurrentLevel = dxyResult.data.currentPrice || dxyPath[0] || 100;
          // Convert DXY prices to log returns
          dxyMacroReturns = dxyPath.map((p: number) => Math.log(p / dxyCurrentLevel));
          dxyDataAvailable = dxyMacroReturns.length > 0;
        }
      } catch (err) {
        fastify.log.warn(`[SPX Overlay Debug] DXY fetch error: ${err}`);
      }
      
      // Fallback: generate synthetic if no real DXY data
      if (dxyMacroReturns.length === 0) {
        const horizonDays = parseInt(horizon.replace('d', ''));
        for (let t = 0; t <= horizonDays; t++) {
          const drift = 0.01 * (t / horizonDays);
          dxyMacroReturns.push(drift);
        }
        dxyDataAvailable = false;
      }
      
      // Ensure SPX hybrid returns array is not empty
      if (spxHybridReturns.length === 0) {
        const horizonDays = parseInt(horizon.replace('d', ''));
        for (let t = 0; t <= horizonDays; t++) {
          const drift = 0.02 * (t / horizonDays);
          spxHybridReturns.push(drift);
        }
      }
      
      // Compute overlay
      const overlayResult = computeCrossAssetOverlay({
        horizon: horizon as any,
        spxHybridReturns,
        dxyMacroReturns,
        currentSpxPrice,
        currentDxyLevel: dxyCurrentLevel,
        guardMultiplier: 1.0, // TODO: get from reliability/guard state
      });
      
      // Validate
      const validation = validateOverlay(overlayResult);
      
      const processingTimeMs = Date.now() - t0;
      
      return {
        ok: true,
        symbol: 'SPX',
        horizon,
        processingTimeMs,
        
        // Main results
        overlay: {
          beta: overlayResult.beta,
          correlation: overlayResult.correlation,
          stability: overlayResult.stability,
          weight: overlayResult.weight,
          active: overlayResult.debug.overlayActive,
        },
        
        // Final returns (%)
        returns: {
          spxHybrid: overlayResult.spxHybridFinalReturn,
          dxyMacro: overlayResult.dxyMacroFinalReturn,
          spxAdjusted: overlayResult.spxAdjustedFinalReturn,
          overlayDelta: overlayResult.overlayDelta,
        },
        
        // Sample deltaOverlay at key points
        deltaOverlaySample: {
          t7: overlayResult.deltaOverlay[7] ? (Math.exp(overlayResult.deltaOverlay[7]) - 1) * 100 : null,
          t14: overlayResult.deltaOverlay[14] ? (Math.exp(overlayResult.deltaOverlay[14]) - 1) * 100 : null,
          t30: overlayResult.deltaOverlay[30] ? (Math.exp(overlayResult.deltaOverlay[30]) - 1) * 100 : null,
          tFinal: overlayResult.deltaOverlay[overlayResult.deltaOverlay.length - 1] 
            ? (Math.exp(overlayResult.deltaOverlay[overlayResult.deltaOverlay.length - 1]) - 1) * 100 
            : null,
        },
        
        // Validation
        validation: {
          valid: validation.valid,
          checks: validation.checks,
        },
        
        // Debug details
        debug: {
          ...overlayResult.debug,
          dxyDataAvailable,
          pathLengths: {
            spxHybrid: spxHybridReturns.length,
            dxyMacro: dxyMacroReturns.length,
            adjusted: overlayResult.adjustedReturns.length,
          },
        },
        
        // Parameters reference
        params: {
          beta: BETA_BY_HORIZON,
          correlation: CORRELATION_BY_HORIZON,
          stability: STABILITY_BY_HORIZON,
        },
        
        // Chart paths for visualization
        chartPaths: {
          // SPX Hybrid path (prices)
          spxHybrid: spxPath,
          // SPX Adjusted path (prices) 
          spxAdjusted: overlayResult.adjustedPrices,
          // DXY path (prices) - for secondary axis
          dxy: dxyPath,
          // DXY normalized to percentage change from start
          dxyNormalized: dxyPath.map((p: number) => ((p / dxyCurrentLevel) - 1) * 100),
          // Overlay delta path (percentage points)
          overlayDelta: overlayResult.deltaOverlay.map(d => (Math.exp(d) - 1) * 100),
        },
      };
      
    } catch (error: any) {
      fastify.log.error(`[SPX Overlay Debug] Error: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  fastify.log.info(`[Fractal SPX] Unified routes registered at ${prefix}/spx/* (BTC-compatible contract)`);
}

export default registerSpxUnifiedRoutes;
