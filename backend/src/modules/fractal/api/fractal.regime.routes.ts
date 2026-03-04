/**
 * BLOCK 59.1 — Global Regime Panel Endpoint
 * 
 * Returns regime data for all horizons with resolved bias
 * 
 * GET /api/fractal/v2.1/regime?symbol=BTC
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';
import {
  HORIZON_CONFIG,
  REGIME_WEIGHTS,
  type HorizonKey,
} from '../config/horizon.config.js';
import type {
  RegimeHorizonData,
  RegimeResponse,
  ResolvedBias,
  ResolvedDir,
} from '../strategy/resolver/resolver.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const engine = new FractalEngine();
const canonicalStore = new CanonicalStore();

const REGIME_HORIZONS: HorizonKey[] = ['30d', '90d', '180d', '365d'];

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

async function computeRegimeData(
  candles: any[],
  horizonKey: HorizonKey
): Promise<RegimeHorizonData> {
  const config = HORIZON_CONFIG[horizonKey];
  const horizonDays = parseInt(horizonKey.replace('d', ''), 10);
  const phase = detectPhase(candles);

  const defaultData: RegimeHorizonData = {
    key: horizonKey,
    label: config.label,
    action: 'NEUTRAL',
    expectedReturn: 0,
    confidence: 0,
    reliability: 0.5,
    phase,
    entropy: 1,
    tailP95DD: 0.5,
  };

  if (candles.length < config.minHistory) {
    return defaultData;
  }

  try {
    // Map horizon config windowLen to supported FractalEngine sizes  
    const supportedWindowSizes = [30, 45, 60, 90, 120, 180];
    const mappedWindowLen = supportedWindowSizes.reduce((prev, curr) => 
      Math.abs(curr - config.windowLen) < Math.abs(prev - config.windowLen) ? curr : prev
    );

    const result = await engine.match({
      symbol: 'BTCUSD',
      windowLen: mappedWindowLen,
      topK: config.topK,
    });

    if (!result || !result.forwardStats) {
      return defaultData;
    }

    const stats = result.forwardStats;
    const matches = result.matches || [];
    const effectiveN = Math.min(matches.length, config.topK);

    const meanReturn = stats.return?.mean || 0;
    const p10 = stats.return?.p10 || -0.1;
    const p50 = stats.return?.p50 || 0;
    const p90 = stats.return?.p90 || 0.1;

    const winRate = p50 > 0 ? 0.5 + (p50 / (p90 - p10)) * 0.3 : 0.5 - (Math.abs(p50) / (p90 - p10)) * 0.3;
    const clampedWinRate = Math.max(0.1, Math.min(0.9, winRate));
    const entropy = 1 - Math.abs(2 * clampedWinRate - 1);

    const spread = p90 - p10;
    const spreadFactor = Math.max(0, 1 - spread);
    const rawConfidence = Math.abs(2 * clampedWinRate - 1) * (0.5 + spreadFactor * 0.5);
    const nFloor = Math.min(1, effectiveN / 10);
    const confidence = rawConfidence * nFloor;

    const mcP95_DD = stats.drawdown?.p95 || 0.5;

    // Determine action
    let action: ResolvedDir = 'NEUTRAL';
    if (confidence > 0.08 && meanReturn > 0.02) action = 'BULL';
    else if (confidence > 0.08 && meanReturn < -0.02) action = 'BEAR';

    // Reliability scales with horizon
    const baseReliability = horizonDays >= 180 ? 0.85 : horizonDays >= 90 ? 0.80 : 0.75;
    const reliability = baseReliability * (1 - entropy * 0.2);

    return {
      key: horizonKey,
      label: config.label,
      action,
      expectedReturn: meanReturn,
      confidence,
      reliability,
      phase,
      entropy,
      tailP95DD: mcP95_DD,
    };
  } catch (err) {
    console.error(`[Regime] Error computing ${horizonKey}:`, err);
    return defaultData;
  }
}

function computeResolvedBias(horizonData: RegimeHorizonData[]): ResolvedBias {
  // Weighted score calculation
  let totalScore = 0;
  let totalWeight = 0;
  const explain: string[] = [];

  for (const h of horizonData) {
    const weight = REGIME_WEIGHTS[h.key] || 0;
    if (weight === 0) continue;

    const dirSign = h.action === 'BULL' ? 1 : h.action === 'BEAR' ? -1 : 0;
    const contribution = dirSign * h.confidence * h.reliability * weight;

    totalScore += contribution;
    totalWeight += weight;

    if (Math.abs(contribution) > 0.05) {
      const pct = (h.confidence * 100).toFixed(0);
      const relPct = (h.reliability * 100).toFixed(0);
      explain.push(`${h.label}=${h.action} (conf ${pct}%, rel ${relPct}%)`);
    }
  }

  const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  const strength = Math.min(1, Math.abs(normalizedScore) * 2);

  let bias: ResolvedDir = 'NEUTRAL';
  if (normalizedScore > 0.1) bias = 'BULL';
  else if (normalizedScore < -0.1) bias = 'BEAR';

  // Dominant horizon explanation
  const dominant = horizonData.find(h => h.key === '365d') || horizonData[horizonData.length - 1];
  if (dominant && dominant.action !== 'NEUTRAL') {
    explain.push(`${dominant.label} dominates bias`);
  }

  // Counter-trend explanation
  const month = horizonData.find(h => h.key === '30d');
  if (month && month.action !== bias && month.action !== 'NEUTRAL') {
    explain.push(`${month.label} ${month.action} signal treated as counter-trend timing`);
  }

  return {
    bias,
    strength,
    rule: 'LONG_HORIZON_DOMINANCE',
    explain,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function fractalRegimeRoutes(fastify: FastifyInstance): Promise<void> {
  
  fastify.get('/api/fractal/v2.1/regime', async (
    req: FastifyRequest<{ Querystring: { symbol?: string } }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();

    if (symbol !== 'BTC') {
      return reply.code(400).send({
        error: 'BTC_ONLY',
        message: 'Regime endpoint is BTC-only',
      });
    }

    try {
      // Load candles
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

      const asof = new Date().toISOString().slice(0, 10);

      // Compute regime for each horizon
      const horizonData: RegimeHorizonData[] = [];

      for (const key of REGIME_HORIZONS) {
        const data = await computeRegimeData(candles, key);
        horizonData.push(data);
      }

      // Compute resolved bias
      const resolvedBias = computeResolvedBias(horizonData);

      const response: RegimeResponse = {
        symbol,
        tf: '1D',
        asof,
        horizons: horizonData,
        resolvedBias,
      };

      return reply.send(response);
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Regime] Error');
      return reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  fastify.log.info('[Fractal] BLOCK 59.1: Global Regime Panel routes registered');
}
