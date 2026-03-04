/**
 * PHASE 4 — Decision Routes
 * ==========================
 * API for final Buy/Sell/Avoid decisions
 */

import { FastifyInstance } from 'fastify';
import { finalDecisionService } from '../services/finalDecision.service.js';
import { buildDecisionContext } from '../services/context.builder.js';
import { DecisionContext, DECISION_THRESHOLDS } from '../contracts/decision.types.js';

export async function registerDecisionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN DECISION ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/decision/final — Get final decision for symbol
  fastify.post<{
    Body: { symbol?: string; save?: boolean };
  }>('/api/v10/decision/final', async (request) => {
    const symbol = (request.body?.symbol || 'BTCUSDT').toUpperCase();
    const save = request.body?.save ?? true;
    
    try {
      // Build context from current system state
      const context = await buildDecisionContext(symbol);
      
      // Make decision
      const decision = finalDecisionService.decide(context);
      
      // Save if requested
      if (save) {
        await finalDecisionService.saveDecision(decision);
      }
      
      return {
        ok: true,
        ...decision,
        context: {
          verdict: context.verdict,
          rawConfidence: context.rawConfidence,
          mlAdjustedConfidence: context.mlAdjustedConfidence,
          dataMode: context.dataMode,
          mlReady: context.mlReady,
          risk: context.risk,
          drivers: context.drivers,
          risks: context.risks,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
        action: 'AVOID',
        reason: 'SYSTEM_ERROR',
      };
    }
  });
  
  // POST /api/v10/decision/simulate — Simulate decision without saving
  fastify.post<{
    Body: DecisionContext;
  }>('/api/v10/decision/simulate', async (request) => {
    const context = request.body;
    
    if (!context || !context.symbol) {
      return { ok: false, error: 'Invalid context' };
    }
    
    const decision = finalDecisionService.decide(context);
    
    return {
      ok: true,
      simulated: true,
      ...decision,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HISTORY & STATS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/decision/latest/:symbol — Get latest decision
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/decision/latest/:symbol',
    async (request) => {
      const symbol = request.params.symbol.toUpperCase();
      const decision = await finalDecisionService.getLatestDecision(symbol);
      
      if (!decision) {
        return { ok: false, error: 'No decision found' };
      }
      
      return { ok: true, ...decision };
    }
  );
  
  // GET /api/v10/decision/history/:symbol — Decision history
  fastify.get<{
    Params: { symbol: string };
    Querystring: { limit?: string };
  }>('/api/v10/decision/history/:symbol', async (request) => {
    const symbol = request.params.symbol.toUpperCase();
    const limit = request.query.limit ? parseInt(request.query.limit) : 50;
    
    const history = await finalDecisionService.getDecisionHistory(symbol, limit);
    
    return {
      ok: true,
      symbol,
      count: history.length,
      decisions: history,
    };
  });
  
  // GET /api/v10/decision/stats — Decision statistics
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/v10/decision/stats',
    async (request) => {
      const symbol = request.query.symbol?.toUpperCase();
      const stats = await finalDecisionService.getDecisionStats(symbol);
      
      return {
        ok: true,
        symbol: symbol || 'ALL',
        ...stats,
        thresholds: DECISION_THRESHOLDS,
      };
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // POLICY INFO
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/decision/policy — Current policy rules
  fastify.get('/api/v10/decision/policy', async () => {
    return {
      ok: true,
      version: 'v1.0.0',
      frozen: true,
      thresholds: DECISION_THRESHOLDS,
      rules: {
        dataMode: 'Must be LIVE',
        mlReady: 'ML must be ready',
        riskOverrides: ['WHALE_RISK_HIGH', 'MARKET_STRESS_EXTREME', 'CONTRADICTION'],
        buyCondition: `BULLISH + confidence >= ${DECISION_THRESHOLDS.BUY}`,
        sellCondition: `BEARISH + confidence >= ${DECISION_THRESHOLDS.SELL}`,
        avoidCondition: 'Everything else',
      },
      explainability: {
        enabled: true,
        fields: ['verdict', 'rawConfidence', 'mlAdjustedConfidence', 'appliedRules', 'blockedBy', 'riskFlags'],
      },
    };
  });
  
  console.log('[Phase 4] Decision Routes registered');
}
