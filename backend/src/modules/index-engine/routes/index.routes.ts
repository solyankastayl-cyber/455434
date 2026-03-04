/**
 * INDEX ENGINE V2 ROUTES
 * 
 * Unified API for all indices.
 */

import { FastifyInstance } from 'fastify';
import { orchestrateIndexPack } from '../services/index_orchestrator.service.js';
import { getMarkovEngine } from '../services/macro_layer/macro_markov.service.js';
import { IndexSymbol, HorizonDays } from '../contracts/index_pack.contract.js';

export async function registerIndexEngineRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/v2/index';
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v2/index/:symbol/pack — Main unified endpoint
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/:symbol/pack`, async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const query = req.query as any;
    
    const validSymbols: IndexSymbol[] = ['DXY', 'SPX', 'BTC'];
    const upperSymbol = symbol.toUpperCase() as IndexSymbol;
    
    if (!validSymbols.includes(upperSymbol)) {
      return reply.status(400).send({
        error: `Invalid symbol: ${symbol}. Valid: DXY, SPX, BTC`,
      });
    }
    
    const horizon = parseInt(query.horizon || '30') as HorizonDays;
    const validHorizons: HorizonDays[] = [7, 14, 30, 90, 180, 365];
    
    const pack = await orchestrateIndexPack({
      symbol: upperSymbol,
      horizon: validHorizons.includes(horizon) ? horizon : 30,
      view: query.view || 'full',
      asOf: query.asOf,
      includeMatches: query.includeMatches !== 'false',
      topK: parseInt(query.topK || '10'),
    });
    
    return pack;
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v2/index/:symbol/macro — Macro-only endpoint
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/:symbol/macro`, async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const query = req.query as any;
    
    const pack = await orchestrateIndexPack({
      symbol: symbol.toUpperCase() as IndexSymbol,
      horizon: parseInt(query.horizon || '30') as HorizonDays,
      view: 'macro',
    });
    
    return {
      ok: true,
      symbol: pack.symbol,
      macro: pack.macro,
      dataStatus: pack.dataStatus.macro,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v2/regime/current — Current regime state (Markov)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix.replace('/index', '')}/regime/current`, async (req, reply) => {
    const { computeMacroScore } = await import('../../dxy-macro-core/services/macro_score.service.js');
    const macroScore = await computeMacroScore();
    
    const markovEngine = getMarkovEngine();
    
    // Build score vector
    const scoreVector: Record<string, number> = {};
    if (macroScore.components) {
      for (const comp of macroScore.components) {
        scoreVector[comp.seriesId] = comp.normalizedPressure || 0;
      }
    }
    
    const confidence = macroScore.confidence === 'HIGH' ? 0.9 : macroScore.confidence === 'LOW' ? 0.4 : 0.7;
    
    const state = markovEngine.getState(
      scoreVector,
      macroScore.scoreSigned || 0,
      confidence,
      macroScore.summary?.dominantRegime as any || 'NEUTRAL'
    );
    
    return {
      ok: true,
      regime: state.regime,
      regimeProbabilities: state.regimeProbabilities,
      persistence: state.persistence,
      transitionHint: state.transitionHint,
      scoreSigned: state.scoreSigned,
      confidence: state.confidence,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v2/regime/transition-matrix — Markov transition matrix
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix.replace('/index', '')}/regime/transition-matrix`, async (req, reply) => {
    const markovEngine = getMarkovEngine();
    const matrix = markovEngine.getTransitionMatrix();
    
    return {
      ok: true,
      ...matrix,
    };
  });
  
  console.log(`[Index Engine V2] Routes registered at ${prefix}/*`);
}
