/**
 * Macro Intelligence API Routes
 * 
 * Provides Market Regime Engine endpoints
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  getMacroIntelSnapshot, 
  getCurrentMacroIntelSnapshot,
  getMacroIntelContext,
  getMacroMlFeatures 
} from './services/macro-intel.snapshot.service.js';
import { buildMacroGrid, getMacroGridWithActive, getActiveRegimeCell } from './services/macro-grid.service.js';
import { REGIME_DEFINITIONS, MACRO_INTEL_THRESHOLDS } from './contracts/macro-intel.types.js';
import {
  getRegimeHistory,
  getRegimeTransitions,
  getRegimeStats,
  trackRegimeChange,
} from './services/regime.history.service.js';

export async function macroIntelRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v10/macro-intel/health
   * Health check
   */
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const snapshot = getCurrentMacroIntelSnapshot();
    
    return reply.send({
      ok: true,
      module: 'macro-intel',
      version: 'v1.0',
      hasData: snapshot !== null,
      currentRegime: snapshot?.state.regime || null,
      quality: snapshot?.quality.mode || 'NO_DATA',
    });
  });

  /**
   * GET /api/v10/macro-intel/snapshot
   * Get full macro intelligence snapshot
   */
  fastify.get('/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh } = request.query as { refresh?: string };
    const forceRefresh = refresh === 'true' || refresh === '1';
    
    try {
      const snapshot = await getMacroIntelSnapshot(forceRefresh);
      
      return reply.send({
        ok: true,
        data: snapshot,
      });
    } catch (error: any) {
      fastify.log.error('[MacroIntel] Snapshot error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get macro intelligence snapshot',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/context
   * Get context for Meta-Brain integration
   */
  fastify.get('/context', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const context = await getMacroIntelContext();
      
      return reply.send({
        ok: true,
        data: context,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get macro context',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/regime
   * Get current market regime (simplified)
   */
  fastify.get('/regime', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const snapshot = await getMacroIntelSnapshot();
      const { state } = snapshot;
      
      return reply.send({
        ok: true,
        data: {
          regime: state.regime,
          regimeId: state.regimeId,
          regimeLabel: state.regimeLabel,
          riskLevel: state.riskLevel,
          marketBias: state.marketBias,
          confidenceMultiplier: state.confidenceMultiplier,
          blocks: state.blocks,
          flags: state.flags,
          trends: state.trends,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get market regime',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/grid
   * Get full macro grid with current regime highlighted
   */
  fastify.get('/grid', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { grid, activeRegime, activeCell } = await getMacroGridWithActive();
      
      return reply.send({
        ok: true,
        data: {
          grid,
          activeRegime,
          activeCell,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get macro grid',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/active
   * Get active regime cell only
   */
  fastify.get('/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const activeCell = await getActiveRegimeCell();
      const snapshot = await getMacroIntelSnapshot();
      
      return reply.send({
        ok: true,
        data: {
          ...activeCell,
          raw: {
            fearGreed: snapshot.raw.fearGreedIndex,
            btcDominance: snapshot.raw.btcDominance,
            stableDominance: snapshot.raw.stableDominance,
            btcPrice: snapshot.raw.btcPrice,
            btcPriceChange24h: snapshot.raw.btcPriceChange24h,
          },
          confidenceMultiplier: snapshot.state.confidenceMultiplier,
          blocks: snapshot.state.blocks,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get active regime',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/ml-features
   * Get ML features for current state
   */
  fastify.get('/ml-features', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const features = await getMacroMlFeatures();
      
      return reply.send({
        ok: true,
        data: features,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get ML features',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/definitions
   * Get regime definitions (for UI/docs)
   */
  fastify.get('/definitions', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        regimes: REGIME_DEFINITIONS,
        thresholds: MACRO_INTEL_THRESHOLDS,
        version: 'v1.0',
        locked: true,
      },
    });
  });

  /**
   * GET /api/v10/macro-intel/explain/:regime
   * Get explanation for a specific regime
   */
  fastify.get('/explain/:regime', async (request: FastifyRequest, reply: FastifyReply) => {
    const { regime } = request.params as { regime: string };
    
    const def = REGIME_DEFINITIONS[regime as keyof typeof REGIME_DEFINITIONS];
    if (!def) {
      return reply.status(404).send({
        ok: false,
        error: 'Unknown regime',
        validRegimes: Object.keys(REGIME_DEFINITIONS),
      });
    }
    
    return reply.send({
      ok: true,
      data: {
        regime: def.regime,
        title: def.title,
        description: def.description,
        interpretation: def.interpretation,
        riskLevel: def.riskLevel,
        marketBias: def.marketBias,
        confidenceMultiplier: def.confidenceMultiplier,
        blocks: def.blocks,
        labsSignals: def.labsSignals,
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // P1.1 — HISTORICAL REGIME TRANSITIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/macro-intel/regime/history
   * Get regime transition history
   */
  fastify.get('/regime/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit } = request.query as { limit?: string };
    const limitNum = parseInt(limit || '50', 10);
    
    try {
      const history = await getRegimeHistory(limitNum);
      
      return reply.send({
        ok: true,
        data: history,
        count: history.length,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get regime history',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/regime/transitions
   * Get regime transitions (from → to)
   */
  fastify.get('/regime/transitions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit } = request.query as { limit?: string };
    const limitNum = parseInt(limit || '50', 10);
    
    try {
      const transitions = await getRegimeTransitions(limitNum);
      
      return reply.send({
        ok: true,
        data: transitions,
        count: transitions.length,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get regime transitions',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro-intel/regime/stats
   * Get regime statistics
   */
  fastify.get('/regime/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getRegimeStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get regime stats',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v10/macro-intel/regime/track
   * Track regime change (called internally or for testing)
   */
  fastify.post('/regime/track', async (request: FastifyRequest, reply: FastifyReply) => {
    const { regime, riskLevel, fearGreed, btcDominance, btcPrice } = request.body as {
      regime: string;
      riskLevel: string;
      fearGreed: number;
      btcDominance: number;
      btcPrice?: number;
    };
    
    if (!regime || !riskLevel || fearGreed === undefined || btcDominance === undefined) {
      return reply.status(400).send({
        ok: false,
        error: 'Missing required fields: regime, riskLevel, fearGreed, btcDominance',
      });
    }
    
    try {
      const transition = await trackRegimeChange(regime, riskLevel, {
        fearGreed,
        btcDominance,
        btcPrice,
      });
      
      return reply.send({
        ok: true,
        transitioned: !!transition,
        data: transition,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to track regime change',
        message: error.message,
      });
    }
  });

  fastify.log.info('[MacroIntel] Routes registered at /api/v10/macro-intel');
}
