/**
 * S1 - Strategy API Routes
 * 
 * Endpoints for strategy evaluation, backtesting, and verdicts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StrategyEvaluationService } from '../services/strategy_evaluation.service.js';
import { StrategyBacktestService } from '../services/strategy_backtest.service.js';
import { StrategyVerdictService } from '../services/strategy_verdict.service.js';
import { SignalDriversService } from '../../signals/services/signal_drivers.service.js';
import { STRATEGY_CATALOG } from '../types/strategy.catalog.js';
import type { BacktestWindow } from '../types/strategy_backtest.types.js';

export async function strategyRoutes(app: FastifyInstance) {
  const signalService = new SignalDriversService();
  const backtestService = new StrategyBacktestService();

  /**
   * GET /api/v3/strategy/catalog
   * List all available strategies
   */
  app.get('/catalog', async (_request, reply) => {
    const strategies = STRATEGY_CATALOG.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version,
      networks: s.networks,
      active: s.active,
      rulesCount: s.rules.length,
    }));

    return {
      ok: true,
      data: {
        strategies,
        count: strategies.length,
      },
    };
  });

  /**
   * POST /api/v3/strategy/evaluate
   * Evaluate strategies for given network
   */
  app.post<{
    Body: { network?: string; asset?: string };
  }>('/evaluate', async (request, reply) => {
    const { network = 'ethereum', asset } = request.body || {};

    try {
      // Get current signals
      const signals = await signalService.resolveForMarket(
        asset || network.toUpperCase(),
        network
      );

      // Convert drivers to evaluation input
      const input = {
        network,
        quality: signals.quality,
        drivers: Object.fromEntries(
          Object.entries(signals.drivers).map(([code, driver]) => [
            code,
            { state: driver.state, strength: driver.strength },
          ])
        ),
      };

      // Evaluate strategies
      const result = StrategyEvaluationService.evaluate(input);

      return {
        ok: true,
        data: {
          network,
          signalQuality: signals.quality,
          signalDecision: signals.decision,
          guardrails: signals.guardrails,
          ...result,
        },
      };
    } catch (err) {
      app.log.error('[Strategy] Evaluation failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'EVALUATION_FAILED',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/v3/strategy/evaluate/:network
   * Evaluate strategies for network (GET version)
   */
  app.get<{
    Params: { network: string };
  }>('/evaluate/:network', async (request, reply) => {
    const { network } = request.params;

    try {
      // Get current signals
      const signals = await signalService.resolveForMarket(
        network.toUpperCase(),
        network
      );

      // Convert drivers to evaluation input
      const input = {
        network,
        quality: signals.quality,
        drivers: Object.fromEntries(
          Object.entries(signals.drivers).map(([code, driver]) => [
            code,
            { state: driver.state, strength: driver.strength },
          ])
        ),
      };

      // Evaluate strategies
      const result = StrategyEvaluationService.evaluate(input);

      return {
        ok: true,
        data: {
          network,
          signalQuality: signals.quality,
          signalDecision: signals.decision,
          guardrails: signals.guardrails,
          primaryVerdict: result.primaryVerdict,
          strategies: result.strategies,
          timestamp: result.timestamp,
        },
      };
    } catch (err) {
      app.log.error('[Strategy] Evaluation failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'EVALUATION_FAILED',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/v3/strategy/:id
   * Get strategy details
   */
  app.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const strategy = STRATEGY_CATALOG.find(s => s.id === id);

    if (!strategy) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: `Strategy ${id} not found`,
      });
    }

    return {
      ok: true,
      data: strategy,
    };
  });

  // ========== S1.2 - BACKTESTING ==========

  /**
   * POST /api/v3/strategy/backtest
   * Run backtest for a strategy
   */
  app.post<{
    Body: { strategyId: string; network?: string; window?: BacktestWindow };
  }>('/backtest', async (request, reply) => {
    const { strategyId, network = 'ethereum', window = '14d' } = request.body || {};

    if (!strategyId) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'strategyId is required',
      });
    }

    try {
      const result = await backtestService.runBacktest({
        strategyId,
        network: network as 'ethereum' | 'bnb',
        window: window as BacktestWindow,
      });

      return { ok: true, data: result };
    } catch (err) {
      app.log.error('[Backtest] Failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'BACKTEST_FAILED',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/v3/strategy/backtest/:strategyId
   * Get backtest history for a strategy
   */
  app.get<{
    Params: { strategyId: string };
    Querystring: { network?: string; limit?: string };
  }>('/backtest/:strategyId', async (request, reply) => {
    const { strategyId } = request.params;
    const { network, limit = '10' } = request.query;

    try {
      const results = await backtestService.getBacktestHistory(
        strategyId,
        network,
        parseInt(limit, 10)
      );

      return { ok: true, data: { results, count: results.length } };
    } catch (err) {
      app.log.error('[Backtest] Failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'BACKTEST_QUERY_FAILED',
        message: (err as Error).message,
      });
    }
  });

  /**
   * POST /api/v3/strategy/backtest/all
   * Run backtest for all strategies on a network
   */
  app.post<{
    Body: { network?: string; window?: BacktestWindow };
  }>('/backtest/all', async (request, reply) => {
    const { network = 'ethereum', window = '14d' } = request.body || {};

    try {
      const results = await backtestService.runAllBacktests(
        network as 'ethereum' | 'bnb',
        window as BacktestWindow
      );

      return {
        ok: true,
        data: {
          network,
          window,
          results,
          count: results.length,
        },
      };
    } catch (err) {
      app.log.error('[Backtest] All failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'BACKTEST_ALL_FAILED',
        message: (err as Error).message,
      });
    }
  });

  // ========== S1.3 - VERDICT ==========

  /**
   * POST /api/v3/strategy/verdict
   * Get final verdict for a strategy
   */
  app.post<{
    Body: {
      strategyId: string;
      network?: string;
      backtestVerdict?: string;
      stabilityVerdict?: string;
      signalQuality?: string;
      guardrailBlocked?: boolean;
      guardrailReasons?: string[];
    };
  }>('/verdict', async (request, reply) => {
    const {
      strategyId,
      network = 'ethereum',
      backtestVerdict = 'MIXED',
      stabilityVerdict,
      signalQuality = 'MEDIUM',
      guardrailBlocked = false,
      guardrailReasons,
    } = request.body || {};

    if (!strategyId) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'strategyId is required',
      });
    }

    try {
      const result = StrategyVerdictService.evaluate({
        strategyId,
        network: network as 'ethereum' | 'bnb',
        backtestVerdict: backtestVerdict as any,
        stabilityVerdict: stabilityVerdict as any,
        signalQuality: signalQuality as any,
        guardrailBlocked,
        guardrailReasons,
      });

      return { ok: true, data: result };
    } catch (err) {
      app.log.error('[Verdict] Failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'VERDICT_FAILED',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/v3/strategy/full/:network
   * Full strategy evaluation with backtest and verdict
   */
  app.get<{
    Params: { network: string };
  }>('/full/:network', async (request, reply) => {
    const { network } = request.params;

    try {
      // 1. Get current signals
      const signals = await signalService.resolveForMarket(
        network.toUpperCase(),
        network
      );

      // 2. Evaluate strategies
      const input = {
        network,
        quality: signals.quality,
        drivers: Object.fromEntries(
          Object.entries(signals.drivers).map(([code, driver]) => [
            code,
            { state: driver.state, strength: driver.strength },
          ])
        ),
      };
      const evaluation = StrategyEvaluationService.evaluate(input);

      // 3. Run backtests for all strategies
      const backtests = await backtestService.runAllBacktests(
        network as 'ethereum' | 'bnb',
        '14d'
      );

      // 4. Get verdicts for each strategy
      const strategiesWithVerdicts = evaluation.strategies.map(strat => {
        const backtest = backtests.find(b => b.strategyId === strat.strategyId);
        
        const verdictResult = StrategyVerdictService.evaluate({
          strategyId: strat.strategyId,
          network: network as 'ethereum' | 'bnb',
          backtestVerdict: backtest?.verdict || 'INSUFFICIENT_DATA',
          signalQuality: signals.quality,
          guardrailBlocked: signals.guardrails?.blocked || false,
          guardrailReasons: signals.guardrails?.blockedBy,
        });

        return {
          ...strat,
          backtest: backtest ? {
            verdict: backtest.verdict,
            metrics: backtest.metrics,
          } : null,
          finalVerdict: verdictResult.verdict,
          verdictReasons: verdictResult.reasons,
          uiConfig: verdictResult.uiConfig,
        };
      });

      return {
        ok: true,
        data: {
          network,
          signalQuality: signals.quality,
          signalDecision: signals.decision,
          guardrails: signals.guardrails,
          strategies: strategiesWithVerdicts,
          timestamp: Date.now(),
        },
      };
    } catch (err) {
      app.log.error('[Strategy Full] Failed:', err);
      return reply.code(500).send({
        ok: false,
        error: 'FULL_EVALUATION_FAILED',
        message: (err as Error).message,
      });
    }
  });

  app.log.info('[Strategy] Routes registered: /api/v3/strategy/*');
}

export default strategyRoutes;
