/**
 * BLOCK 58/59 — Multi-Signal Extended Endpoint
 * 
 * Returns signals for ALL horizons (7d, 14d, 30d, 90d, 180d, 365d)
 * with hierarchical resolver output (Bias + Timing + Final)
 * 
 * GET /api/fractal/v2.1/multi-signal?symbol=BTC&set=extended
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';
import {
  HORIZON_CONFIG,
  FRACTAL_HORIZONS,
  type HorizonKey,
} from '../config/horizon.config.js';
import {
  HierarchicalResolverService,
  type HierarchicalResolveInput,
  type HorizonInput,
} from '../strategy/resolver/index.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface HorizonSignalExtended {
  action: 'LONG' | 'SHORT' | 'HOLD';
  expectedReturn: number;
  confidence: number;
  reliability: number;
  effectiveN: number;
  entropy: number;
  sizeMultiplier: number;
  phase: string;
  tailRisk: {
    mcP95_DD: number;
    maxDD_WF: number;
  };
  blockers: string[];
}

interface MultiSignalResponse {
  symbol: string;
  set: string;
  asof: string;
  contractVersion: string;
  signalsByHorizon: Record<HorizonKey, HorizonSignalExtended>;
  resolved: {
    bias: any;
    timing: any;
    final: any;
  };
  meta: {
    currentPrice: number;
    sma200: number;
    globalPhase: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const engine = new FractalEngine();
const canonicalStore = new CanonicalStore();
const resolver = new HierarchicalResolverService();

function detectPhase(candles: any[]): string {
  if (candles.length < 50) return 'UNKNOWN';
  
  const recent = candles.slice(-30);
  const ma20 = recent.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const ma50 = candles.slice(-50).reduce((s, c) => s + c.close, 0) / 50;
  const currentPrice = recent[recent.length - 1].close;
  
  const priceVsMa20 = (currentPrice - ma20) / ma20;
  const priceVsMa50 = (currentPrice - ma50) / ma50;
  
  if (priceVsMa20 > 0.05 && priceVsMa50 > 0.10) return 'MARKUP';
  if (priceVsMa20 < -0.05 && priceVsMa50 < -0.10) return 'MARKDOWN';
  if (priceVsMa20 > 0 && priceVsMa50 < 0) return 'RECOVERY';
  if (priceVsMa20 < 0 && priceVsMa50 > 0) return 'DISTRIBUTION';
  return 'ACCUMULATION';
}

function computeSMA(candles: any[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close, 0) / period;
}

async function computeHorizonSignal(
  candles: any[],
  horizonKey: HorizonKey,
  phase: string
): Promise<HorizonSignalExtended> {
  const config = HORIZON_CONFIG[horizonKey];
  const horizonDays = parseInt(horizonKey.replace('d', ''), 10);
  
  // Default response for insufficient data
  const defaultResponse: HorizonSignalExtended = {
    action: 'HOLD',
    expectedReturn: 0,
    confidence: 0,
    reliability: 0.5,
    effectiveN: 0,
    entropy: 1,
    sizeMultiplier: 0,
    phase,
    tailRisk: { mcP95_DD: 0.5, maxDD_WF: 0.1 },
    blockers: ['INSUFFICIENT_DATA'],
  };

  if (candles.length < config.minHistory) {
    return defaultResponse;
  }

  try {
    // Map horizon config windowLen to supported FractalEngine sizes
    const supportedWindowSizes = [30, 45, 60, 90, 120, 180];
    const mappedWindowLen = supportedWindowSizes.reduce((prev, curr) => 
      Math.abs(curr - config.windowLen) < Math.abs(prev - config.windowLen) ? curr : prev
    );

    // Run fractal matching with horizon config
    const result = await engine.match({
      symbol: 'BTCUSD',
      windowLen: mappedWindowLen,
      topK: config.topK,
    });

    if (!result || !result.forwardStats) {
      return { ...defaultResponse, blockers: ['NO_MATCHES'] };
    }

    const stats = result.forwardStats;
    const matches = result.matches || [];
    const effectiveN = Math.min(matches.length, config.topK);

    // Get aftermath stats for this horizon
    const horizonIndex = Math.min(horizonDays - 1, (stats.return?.series?.length || 1) - 1);
    const meanReturn = stats.return?.series?.[horizonIndex] || stats.return?.mean || 0;
    
    // Calculate confidence metrics
    const p10 = stats.return?.p10 || -0.1;
    const p50 = stats.return?.p50 || 0;
    const p90 = stats.return?.p90 || 0.1;
    
    const winRate = p50 > 0 ? 0.5 + (p50 / (p90 - p10)) * 0.3 : 0.5 - (Math.abs(p50) / (p90 - p10)) * 0.3;
    const clampedWinRate = Math.max(0.1, Math.min(0.9, winRate));
    const entropy = 1 - Math.abs(2 * clampedWinRate - 1);
    
    const spread = p90 - p10;
    const spreadFactor = Math.max(0, 1 - spread);
    const rawConfidence = Math.abs(2 * clampedWinRate - 1) * (0.5 + spreadFactor * 0.5);
    
    // Apply effectiveN floor
    const nFloor = Math.min(1, effectiveN / 15);
    const confidence = rawConfidence * nFloor;
    
    // Tail risk metrics
    const maxDD_WF = stats.drawdown?.max || 0.1;
    const mcP95_DD = stats.drawdown?.p95 || 0.5;
    
    // Determine action
    let action: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
    if (confidence > 0.05 && meanReturn > 0.015) action = 'LONG';
    else if (confidence > 0.05 && meanReturn < -0.015) action = 'SHORT';

    // Blockers
    const blockers: string[] = [];
    if (confidence < 0.05) blockers.push('LOW_CONFIDENCE');
    if (entropy > 0.8) blockers.push('HIGH_ENTROPY');
    if (mcP95_DD > 0.55) blockers.push('HIGH_TAIL_RISK');
    if (effectiveN < 5) blockers.push('LOW_SAMPLE');

    // Reliability based on horizon
    const baseReliability = horizonDays >= 90 ? 0.80 : horizonDays >= 30 ? 0.75 : 0.70;
    const reliability = baseReliability * (1 - entropy * 0.3);

    // Size multiplier
    const sizeMultiplier = entropy > 0.8 ? 0 : entropy > 0.6 ? 0.25 : entropy > 0.4 ? 0.5 : 0.75;

    return {
      action,
      expectedReturn: meanReturn,
      confidence: Math.min(1, confidence),
      reliability,
      effectiveN,
      entropy,
      sizeMultiplier,
      phase,
      tailRisk: { mcP95_DD, maxDD_WF },
      blockers,
    };
  } catch (err) {
    console.error(`[MultiSignal] Error computing ${horizonKey}:`, err);
    return { ...defaultResponse, blockers: ['COMPUTATION_ERROR'] };
  }
}

function toResolverInput(
  signalsByHorizon: Record<HorizonKey, HorizonSignalExtended>
): HierarchicalResolveInput {
  const horizons: Record<HorizonKey, HorizonInput> = {} as any;

  for (const key of FRACTAL_HORIZONS) {
    const sig = signalsByHorizon[key];
    horizons[key] = {
      horizon: key,
      dir: sig.action === 'LONG' ? 'LONG' : sig.action === 'SHORT' ? 'SHORT' : 'HOLD',
      expectedReturn: sig.expectedReturn,
      confidence: sig.confidence,
      reliability: sig.reliability,
      phaseRisk: sig.entropy * 0.5, // Approximate phase risk from entropy
      blockers: sig.blockers,
    };
  }

  // Use 30d metrics for global entropy/tail
  const sig30 = signalsByHorizon['30d'];
  
  return {
    horizons,
    globalEntropy: sig30.entropy,
    mcP95_DD: sig30.tailRisk.mcP95_DD,
    maxDD_WF: sig30.tailRisk.maxDD_WF,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function fractalMultiSignalRoutes(fastify: FastifyInstance): Promise<void> {
  
  fastify.get('/api/fractal/v2.1/multi-signal', async (
    req: FastifyRequest<{ Querystring: { symbol?: string; set?: string } }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();
    const set = String(req.query.set ?? 'extended');

    // BTC-only policy
    if (symbol !== 'BTC') {
      return reply.code(400).send({
        error: 'BTC_ONLY',
        message: 'Fractal module is BTC-only by policy',
      });
    }

    if (set !== 'extended') {
      return reply.code(400).send({
        error: 'INVALID_SET',
        message: 'Only set=extended is supported',
      });
    }

    try {
      // Load candles (maximum needed for 365d horizon)
      const candles = await canonicalStore.getCandles({
        symbol: 'BTCUSD',
        limit: 1200,
      });

      if (!candles || candles.length < 100) {
        return reply.code(503).send({
          error: 'INSUFFICIENT_DATA',
          message: 'Not enough historical data',
        });
      }

      const currentPrice = candles[candles.length - 1].close;
      const sma200 = computeSMA(candles, 200);
      const globalPhase = detectPhase(candles);
      const asof = new Date().toISOString().slice(0, 10);

      // Compute signals for all horizons
      const signalsByHorizon: Record<HorizonKey, HorizonSignalExtended> = {} as any;

      for (const key of FRACTAL_HORIZONS) {
        signalsByHorizon[key] = await computeHorizonSignal(candles, key, globalPhase);
      }

      // Run hierarchical resolver
      const resolverInput = toResolverInput(signalsByHorizon);
      const resolved = resolver.resolve(resolverInput);

      const response: MultiSignalResponse = {
        symbol,
        set,
        asof,
        contractVersion: 'v2.1.0',
        signalsByHorizon,
        resolved,
        meta: {
          currentPrice,
          sma200,
          globalPhase,
        },
      };

      return reply.send(response);
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[MultiSignal] Error');
      return reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  fastify.log.info('[Fractal] BLOCK 58/59: Multi-signal extended routes registered');
}
