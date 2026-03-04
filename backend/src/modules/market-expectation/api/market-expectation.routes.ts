/**
 * MARKET EXPECTATION API ROUTES
 * =============================
 * 
 * Isolated module — does NOT touch trading or Connections.
 * Only subscribes to verdicts and evaluates outcomes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  buildExpectationFromVerdict,
  buildExpectationsForMultipleHorizons,
  type VerdictForExpectation,
} from '../services/expectation.builder.js';
import {
  initExpectationStore,
  getStorageMode,
  saveExpectation,
  getExpectations,
  getExpectationById,
  getExpectationStats,
  getOutcomes,
  getOutcomeStats,
  expireOldExpectations,
} from '../services/expectation.store.js';
import {
  evaluateExpectation,
  evaluatePendingExpectations,
  evaluateWithPrice,
} from '../services/expectation.evaluator.js';
import {
  generateFeedbackSignal,
  queueFeedbackForML,
  getFeedbackQueue,
  aggregateFeedback,
} from '../services/expectation.feedback.js';
import type { ExpectationFilters } from '../contracts/expectation.types.js';

export async function registerMarketExpectationRoutes(app: FastifyInstance): Promise<void> {
  
  // Initialize MongoDB store
  await initExpectationStore();
  
  // ═══════════════════════════════════════════════════════════════
  // STORAGE INFO
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/health
   * Returns storage mode and health status
   */
  app.get('/api/v10/market-expectation/health', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      module: 'market-expectation',
      storageMode: getStorageMode(),
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // EMIT EXPECTATION (from verdict)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/v10/market-expectation/emit
   * Creates an expectation from a Meta-Brain verdict
   */
  app.post('/api/v10/market-expectation/emit', async (
    request: FastifyRequest<{ Body: VerdictForExpectation }>,
    reply: FastifyReply
  ) => {
    try {
      const verdict = request.body;
      
      // Validate
      if (!verdict.symbol || !verdict.direction) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_VERDICT',
          message: 'Symbol and direction are required',
        });
      }
      
      // Build expectation
      const expectation = buildExpectationFromVerdict(verdict);
      
      if (!expectation) {
        return reply.send({
          ok: true,
          emitted: false,
          reason: 'Confidence below threshold',
        });
      }
      
      // Save
      await saveExpectation(expectation);
      
      return reply.send({
        ok: true,
        emitted: true,
        expectation: {
          id: expectation.id,
          direction: expectation.direction,
          horizon: expectation.horizon,
          confidence: expectation.confidence,
          evaluateAt: new Date(expectation.evaluateAt).toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'EMIT_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET EXPECTATIONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/list
   * Returns list of expectations with filters
   */
  app.get('/api/v10/market-expectation/list', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
        horizon?: '1D' | '3D' | '7D';
        status?: 'PENDING' | 'EVALUATED' | 'EXPIRED';
        limit?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const filters: ExpectationFilters = {
        asset: request.query.asset,
        horizon: request.query.horizon,
        status: request.query.status,
        limit: request.query.limit ? parseInt(request.query.limit) : 50,
      };
      
      const expectations = await getExpectations(filters);
      
      return reply.send({
        ok: true,
        count: expectations.length,
        expectations: expectations.map(e => ({
          id: e.id,
          asset: e.asset,
          direction: e.direction,
          horizon: e.horizon,
          confidence: e.confidence,
          status: e.status,
          macroRegime: e.macroRegime,
          issuedAt: new Date(e.issuedAt).toISOString(),
          evaluateAt: new Date(e.evaluateAt).toISOString(),
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'LIST_FAILED',
        message,
      });
    }
  });
  
  /**
   * GET /api/v10/market-expectation/:id
   * Returns single expectation with outcome if evaluated
   */
  app.get('/api/v10/market-expectation/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const expectation = await getExpectationById(request.params.id);
      
      if (!expectation) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'Expectation not found',
        });
      }
      
      return reply.send({
        ok: true,
        expectation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'GET_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // EVALUATE OUTCOMES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/v10/market-expectation/evaluate
   * Evaluates pending expectations that have reached their horizon
   */
  app.post('/api/v10/market-expectation/evaluate', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await evaluatePendingExpectations();
      
      // Generate feedback for ML
      for (const outcome of result.outcomes) {
        const signal = await generateFeedbackSignal(outcome);
        if (signal) {
          await queueFeedbackForML(signal);
        }
      }
      
      return reply.send({
        ok: true,
        evaluated: result.evaluated,
        hits: result.hits,
        misses: result.misses,
        hitRate: result.evaluated > 0 
          ? `${(result.hits / result.evaluated * 100).toFixed(1)}%`
          : 'N/A',
        feedbackQueued: result.outcomes.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'EVALUATE_FAILED',
        message,
      });
    }
  });
  
  /**
   * POST /api/v10/market-expectation/evaluate/:id
   * Manually evaluate a specific expectation with given price
   */
  app.post('/api/v10/market-expectation/evaluate/:id', async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { currentPrice: number; currentMacroRegime: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { currentPrice, currentMacroRegime } = request.body;
      
      if (!currentPrice || !currentMacroRegime) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'currentPrice and currentMacroRegime are required',
        });
      }
      
      const outcome = await evaluateWithPrice(
        request.params.id,
        currentPrice,
        currentMacroRegime
      );
      
      if (!outcome) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'Expectation not found or already evaluated',
        });
      }
      
      // Generate feedback
      const signal = await generateFeedbackSignal(outcome);
      if (signal) {
        await queueFeedbackForML(signal);
      }
      
      return reply.send({
        ok: true,
        outcome: {
          realizedMove: `${outcome.realizedMove.toFixed(2)}%`,
          realizedDirection: outcome.realizedDirection,
          directionHit: outcome.directionHit,
          error: outcome.error,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'EVALUATE_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // OUTCOMES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/outcomes
   * Returns evaluated outcomes
   */
  app.get('/api/v10/market-expectation/outcomes', async (
    request: FastifyRequest<{
      Querystring: { limit?: string; hitsOnly?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const outcomes = await getOutcomes({
        limit: request.query.limit ? parseInt(request.query.limit) : 50,
        directionHit: request.query.hitsOnly === 'true' ? true : undefined,
      });
      
      return reply.send({
        ok: true,
        count: outcomes.length,
        outcomes: outcomes.map(o => ({
          expectationId: o.expectationId,
          realizedMove: `${o.realizedMove.toFixed(2)}%`,
          realizedDirection: o.realizedDirection,
          directionHit: o.directionHit,
          magnitudeHit: o.magnitudeHit,
          error: o.error,
          regimeChanged: o.regimeChanged,
          evaluatedAt: new Date(o.evaluatedAt).toISOString(),
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'OUTCOMES_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/stats
   * Returns expectation and outcome statistics
   */
  app.get('/api/v10/market-expectation/stats', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const [expectationStats, outcomeStats] = await Promise.all([
        getExpectationStats(),
        getOutcomeStats(),
      ]);
      
      return reply.send({
        ok: true,
        expectations: expectationStats,
        outcomes: {
          ...outcomeStats,
          hitRate: `${(outcomeStats.hitRate * 100).toFixed(1)}%`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'STATS_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // FEEDBACK (for ML)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/feedback/queue
   * Returns pending feedback signals for ML
   */
  app.get('/api/v10/market-expectation/feedback/queue', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const queue = await getFeedbackQueue();
      const aggregated = await aggregateFeedback(queue);
      
      return reply.send({
        ok: true,
        queueSize: queue.length,
        aggregated,
        signals: queue.slice(0, 20), // Return last 20
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'FEEDBACK_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // MAINTENANCE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/v10/market-expectation/cleanup
   * Expires old pending expectations
   */
  app.post('/api/v10/market-expectation/cleanup', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const expired = await expireOldExpectations();
      
      return reply.send({
        ok: true,
        expired,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CLEANUP_FAILED',
        message,
      });
    }
  });
  
  app.log.info('[MarketExpectation] Routes registered at /api/v10/market-expectation');
  
  // ═══════════════════════════════════════════════════════════════
  // P1.2 — CURRENT MARKET EXPECTATION PANEL
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/market-expectation/current
   * Returns current market expectation derived from macro context
   */
  app.get('/api/v10/market-expectation/current', async (
    request: FastifyRequest<{ Querystring: { asset?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const asset = request.query.asset || 'BTC';
      
      // Get current macro context
      const { getCurrentMacroIntelSnapshot } = await import('../../macro-intel/index.js');
      const snapshot = await getCurrentMacroIntelSnapshot();
      
      // Extract values from snapshot
      const raw = snapshot?.raw || {};
      const context = snapshot?.context || {};
      const state = snapshot?.state || {};
      
      const btcDom = raw.btcDominance || context.btcDominance || 50;
      const stableDom = raw.stableDominance || context.stableDominance || 10;
      const fearGreed = raw.fearGreedIndex || context.fearGreed || 50;
      const regime = state.regime || context.regime || 'NEUTRAL';
      
      // Calculate expectation based on macro drivers
      let expectation: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' = 'NEUTRAL';
      let confidence = 0.5;
      const drivers: string[] = [];
      
      // Stablecoin dominance rising = risk off
      if (stableDom > 12) {
        expectation = 'RISK_OFF';
        confidence += 0.15;
        drivers.push(`STABLE_DOM↑ (${stableDom.toFixed(1)}%)`);
      }
      
      // BTC dominance rising = risk off (flight to safety)
      if (btcDom > 55 && regime === 'BTC_FLIGHT_TO_SAFETY') {
        expectation = 'RISK_OFF';
        confidence += 0.1;
        drivers.push(`BTC_DOM↑ (${btcDom.toFixed(1)}%)`);
      }
      
      // Fear is extreme = risk off
      if (fearGreed < 25) {
        expectation = 'RISK_OFF';
        confidence += 0.2;
        drivers.push(`FEAR=EXTREME (${fearGreed})`);
      }
      
      // Greed is extreme = potential risk on
      if (fearGreed > 75) {
        expectation = 'RISK_ON';
        confidence = 0.6;
        drivers.push(`GREED=EXTREME (${fearGreed})`);
      }
      
      // Alt rotation = risk on for alts
      if (regime === 'ALT_ROTATION' || regime === 'ALT_SEASON') {
        expectation = 'RISK_ON';
        confidence += 0.15;
        drivers.push(`REGIME=${regime}`);
      }
      
      // Panic regimes = risk off
      if (regime === 'PANIC_SELL_OFF' || regime === 'CAPITAL_EXIT' || regime === 'FULL_RISK_OFF') {
        expectation = 'RISK_OFF';
        confidence = 0.8;
        drivers.push(`REGIME=${regime}`);
      }
      
      // Clamp confidence
      confidence = Math.min(0.95, Math.max(0.3, confidence));
      
      // Generate explanation text
      const explanations = {
        RISK_OFF: 'Capital is moving into BTC and stablecoins. Caution advised.',
        RISK_ON: 'Risk appetite is elevated. Alts may outperform.',
        NEUTRAL: 'No strong directional bias detected.',
      };
      
      return reply.send({
        ok: true,
        data: {
          expectation,
          confidence: Math.round(confidence * 100) / 100,
          drivers,
          macroRegime: regime,
          explanation: explanations[expectation],
          metrics: {
            btcDominance: btcDom,
            stableDominance: stableDom,
            fearGreedIndex: fearGreed,
          },
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CURRENT_FAILED',
        message,
      });
    }
  });
}

console.log('[MarketExpectation] Routes module loaded');
