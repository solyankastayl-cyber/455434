/**
 * SPX REGIME ENGINE — Routes
 * 
 * BLOCK B6.11 — API endpoints for regime decomposition
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxRegimeService } from './regime.service.js';
import { RegimeTag } from './regime.config.js';
import { getRegimeDescription, getRegimeRiskLevel, isModelUsefulRegime } from './regime.tagger.js';

export async function registerSpxRegimeRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/spx/v2.1/admin/regimes/recompute
   * Recompute regime tags for all data
   */
  app.post('/api/spx/v2.1/admin/regimes/recompute', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        fromIdx?: number;
        toIdx?: number;
        chunkSize?: number;
        preset?: string;
      } || {};
      
      // Ensure indexes first
      await spxRegimeService.ensureIndexes();
      
      const result = await spxRegimeService.recomputeRegimes({
        fromIdx: body.fromIdx ?? 60,
        toIdx: body.toIdx,
        chunkSize: body.chunkSize ?? 1000,
        preset: body.preset ?? 'BALANCED',
      });
      
      return reply.send({
        ok: true,
        result,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Recompute error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/regimes/summary
   * Get regime distribution summary
   */
  app.get('/api/spx/v2.1/admin/regimes/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const summary = await spxRegimeService.getRegimeSummary(preset);
      
      // Add descriptions
      const regimeDetails = Object.entries(summary.byRegime).map(([tag, count]) => ({
        tag,
        count,
        description: getRegimeDescription(tag as RegimeTag),
        riskLevel: getRegimeRiskLevel(tag as RegimeTag),
        isModelUseful: isModelUsefulRegime(tag as RegimeTag),
      }));
      
      return reply.send({
        ok: true,
        data: {
          ...summary,
          regimeDetails,
        },
      });
    } catch (err: any) {
      console.error('[SPX Regime] Summary error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/regimes/matrix
   * Get skill matrix by regime (uses V2 idx-based join)
   */
  app.get('/api/spx/v2.1/admin/regimes/matrix', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      // Use V2 method with idx-based join
      const matrix = await spxRegimeService.buildRegimeSkillMatrixV2(preset);
      
      return reply.send({
        ok: true,
        data: matrix,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Matrix error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/regimes/generate-outcomes
   * B6.12.2 — Generate outcomes from candles for matrix calculation
   */
  app.post('/api/spx/v2.1/admin/regimes/generate-outcomes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        preset?: string;
        fromIdx?: number;
        toIdx?: number;
      } || {};
      
      const result = await spxRegimeService.generateOutcomes({
        preset: body.preset ?? 'BALANCED',
        fromIdx: body.fromIdx ?? 60,
        toIdx: body.toIdx,
      });
      
      return reply.send({
        ok: true,
        result,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Generate outcomes error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/regimes/current
   * Get current regime
   */
  app.get('/api/spx/v2.1/admin/regimes/current', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const current = await spxRegimeService.getCurrentRegime(preset);
      
      if (!current) {
        return reply.send({
          ok: true,
          data: null,
          message: 'No regime data. Run recompute first.',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          date: current.date,
          regimeTag: current.regimeTag,
          description: current.description,
          riskLevel: current.riskLevel,
          features: current.features,
          isModelUseful: isModelUsefulRegime(current.regimeTag),
        },
      });
    } catch (err: any) {
      console.error('[SPX Regime] Current error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/regimes/stability
   * B6.14.1 — Decade stability analysis
   */
  app.get('/api/spx/v2.1/admin/regimes/stability', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const stability = await spxRegimeService.buildDecadeStability(preset);
      
      return reply.send({
        ok: true,
        data: stability,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Stability error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/constitution
   * B6.14.2 — Get current constitution
   */
  app.get('/api/spx/v2.1/admin/constitution', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const constitution = await spxRegimeService.getConstitution(preset);
      
      if (!constitution) {
        return reply.send({
          ok: true,
          data: null,
          message: 'No constitution generated. Run POST /constitution/generate first.',
        });
      }
      
      return reply.send({
        ok: true,
        data: constitution,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Constitution get error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/constitution/generate
   * B6.14.2 — Generate and save constitution v2
   */
  app.post('/api/spx/v2.1/admin/constitution/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { preset?: string; save?: boolean } || {};
      const preset = body.preset ?? 'BALANCED';
      const shouldSave = body.save !== false; // Default to save
      
      const constitution = await spxRegimeService.buildConstitution(preset);
      
      if (shouldSave) {
        await spxRegimeService.saveConstitution(constitution);
      }
      
      return reply.send({
        ok: true,
        data: constitution,
        saved: shouldSave,
      });
    } catch (err: any) {
      console.error('[SPX Regime] Constitution generate error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  // ===== B6.15 GOVERNANCE ROUTES =====

  /**
   * GET /api/spx/v2.1/admin/governance/versions
   * Get all constitution versions
   */
  app.get('/api/spx/v2.1/admin/governance/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const versions = await spxRegimeService.getConstitutionVersions(preset);
      
      return reply.send({
        ok: true,
        data: versions,
      });
    } catch (err: any) {
      console.error('[SPX Governance] Versions error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/governance/active
   * Get active (APPLIED) constitution
   */
  app.get('/api/spx/v2.1/admin/governance/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const active = await spxRegimeService.getActiveConstitution(preset);
      
      return reply.send({
        ok: true,
        data: active,
        message: active ? `Active constitution: ${active.hash}` : 'No active constitution',
      });
    } catch (err: any) {
      console.error('[SPX Governance] Active error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/governance/create-version
   * Create a new tracked version from current constitution
   */
  app.post('/api/spx/v2.1/admin/governance/create-version', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { preset?: string } || {};
      const preset = body.preset ?? 'BALANCED';
      
      const version = await spxRegimeService.createConstitutionVersion(preset);
      
      return reply.send({
        ok: true,
        data: version,
      });
    } catch (err: any) {
      console.error('[SPX Governance] Create version error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/governance/transition
   * Transition constitution to new status
   */
  app.post('/api/spx/v2.1/admin/governance/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { 
        hash: string;
        targetStatus: string;
        preset?: string;
        actor?: string;
      };
      
      if (!body.hash || !body.targetStatus) {
        return reply.status(400).send({ ok: false, error: 'hash and targetStatus required' });
      }
      
      const result = await spxRegimeService.transitionConstitution(
        body.hash,
        body.targetStatus as any,
        body.preset ?? 'BALANCED',
        body.actor ?? 'SYSTEM'
      );
      
      return reply.send({
        ok: result.success,
        data: result.version,
        error: result.error,
      });
    } catch (err: any) {
      console.error('[SPX Governance] Transition error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/governance/gates/:hash
   * Check APPLY gates for a specific version
   */
  app.get('/api/spx/v2.1/admin/governance/gates/:hash', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = request.params as { hash: string };
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const gates = await spxRegimeService.checkApplyGates(params.hash, preset);
      
      return reply.send({
        ok: true,
        data: gates,
      });
    } catch (err: any) {
      console.error('[SPX Governance] Gates check error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  // ===== B6.14.4 BACKTEST ROUTES =====

  /**
   * POST /api/spx/v2.1/admin/backtest/run
   * Run backtest for specific period
   */
  app.post('/api/spx/v2.1/admin/backtest/run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        startDate: string;
        endDate: string;
        preset?: string;
      };
      
      if (!body.startDate || !body.endDate) {
        return reply.status(400).send({ ok: false, error: 'startDate and endDate required' });
      }
      
      const result = await spxRegimeService.runBacktest({
        startDate: body.startDate,
        endDate: body.endDate,
        preset: body.preset ?? 'BALANCED',
        benchmarks: ['RAW_MODEL', 'CONSTITUTION_FILTERED', 'BUY_HOLD'],
      });
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: any) {
      console.error('[SPX Backtest] Run error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/backtest/full
   * Run full backtest across all standard periods
   */
  app.get('/api/spx/v2.1/admin/backtest/full', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { preset?: string };
      const preset = query.preset ?? 'BALANCED';
      
      const result = await spxRegimeService.runFullBacktest(preset);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: any) {
      console.error('[SPX Backtest] Full error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  console.log('[SPX Regime] B6.11 + B6.14 + B6.15 Routes registered');
}

export default registerSpxRegimeRoutes;
