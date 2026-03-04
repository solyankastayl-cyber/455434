/**
 * COMPARE + VALIDATION ROUTES
 * 
 * Institutional validation endpoints for V1 vs V2:
 * - Compare dashboard data
 * - Backtest framework
 * - Regime timeline
 * - Weight drift
 * - Router audit
 * - Promotion decision
 * - Calibration status
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCompareService } from '../compare/compare.service.js';
import { getBacktestService } from '../backtest/backtest.service.js';
import { getPromotionService } from '../promotion/promotion.service.js';
import { getRegimeStateService } from '../v2/state/regime_state.service.js';
import { getRollingCalibrationService } from '../v2/calibration/rolling_calibration.service.js';
import { getSimulationService, SimulationParams } from '../v2/simulation/simulate.service.js';
import { MacroHorizon } from '../interfaces/macro_engine.interface.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerCompareRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // 1. COMPARE ENDPOINT — Full comparison data (extended)
  // Note: Simple compare at /api/macro-engine/:asset/compare exists in macro_engine.routes.ts
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/:asset/compare-full', async (
    request: FastifyRequest<{
      Params: { asset: string };
      Querystring: { from?: string; to?: string; horizons?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset } = request.params;
    const { from, to, horizons: horizonStr } = request.query;
    
    const horizons = horizonStr
      ? horizonStr.split(',') as MacroHorizon[]
      : ['30D', '90D', '180D', '365D'] as MacroHorizon[];
    
    try {
      const compareSvc = getCompareService();
      const result = await compareSvc.getComparison({
        asset,
        from,
        to,
        horizons,
      });
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'COMPARE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 2. BACKTEST ENDPOINT
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/:asset/backtest/run', async (
    request: FastifyRequest<{
      Params: { asset: string };
      Body: {
        from: string;
        to: string;
        horizons?: string[];
        stepDays?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    const { asset } = request.params;
    const { from, to, horizons = ['30D'], stepDays = 7 } = request.body || {};
    
    if (!from || !to) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'from and to dates are required',
      });
    }
    
    try {
      const backtestSvc = getBacktestService();
      const result = await backtestSvc.runBacktest({
        asset,
        from,
        to,
        horizons: horizons as MacroHorizon[],
        stepDays,
      });
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'BACKTEST_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 3. REGIME TIMELINE
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/regime/timeline', async (
    request: FastifyRequest<{
      Querystring: { asset?: string; from?: string; to?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset = 'DXY', from, to, limit: limitStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 90;
    
    try {
      const regimeSvc = getRegimeStateService();
      const history = await regimeSvc.getHistory(asset, limit);
      
      // Convert to timeline periods
      const periods: Array<{
        regime: string;
        start: string;
        end: string;
        persistence: number;
      }> = [];
      
      if (history.length > 0) {
        let currentPeriod = {
          regime: history[history.length - 1].dominant as string,
          start: history[history.length - 1].asOf?.toISOString?.() || new Date().toISOString(),
          end: '',
          persistence: history[history.length - 1].persistence || 0,
        };
        
        for (let i = history.length - 2; i >= 0; i--) {
          const state = history[i];
          if (state.dominant !== currentPeriod.regime) {
            currentPeriod.end = state.asOf?.toISOString?.() || new Date().toISOString();
            periods.push({ ...currentPeriod });
            currentPeriod = {
              regime: state.dominant as string,
              start: state.asOf?.toISOString?.() || new Date().toISOString(),
              end: '',
              persistence: state.persistence || 0,
            };
          }
        }
        
        // Add final period
        currentPeriod.end = new Date().toISOString();
        periods.push(currentPeriod);
      }
      
      return reply.send({
        ok: true,
        data: {
          asset,
          totalStates: history.length,
          periods: periods.reverse(),
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'TIMELINE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 4. CALIBRATION DRIFT
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/drift', async (
    request: FastifyRequest<{
      Querystring: { asset?: string; from?: string; to?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset = 'DXY' } = request.query;
    
    try {
      const calibrationSvc = getRollingCalibrationService();
      const history = await calibrationSvc.getWeightsHistory(asset, 12);
      
      const versions: Array<{
        versionId: string;
        asOf: string;
        driftFromPrevious: number;
        maxComponentShift: number;
        components: Record<string, number>;
      }> = [];
      
      for (let i = 0; i < history.length; i++) {
        const curr = history[i];
        const prev = history[i + 1];
        
        let drift = 0;
        let maxShift = 0;
        const components: Record<string, number> = {};
        
        if (curr.components) {
          for (const comp of curr.components) {
            components[comp.key] = comp.weight;
            
            if (prev?.components) {
              const prevComp = prev.components.find((c: any) => c.key === comp.key);
              if (prevComp) {
                const shift = Math.abs(comp.weight - prevComp.weight);
                drift += shift;
                maxShift = Math.max(maxShift, shift);
              }
            }
          }
        }
        
        versions.push({
          versionId: (curr as any)._id?.toString() || `v${i}`,
          asOf: curr.asOf?.toISOString?.() || new Date().toISOString(),
          driftFromPrevious: Math.round(drift * 10000) / 10000,
          maxComponentShift: Math.round(maxShift * 10000) / 10000,
          components,
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          asset,
          totalVersions: versions.length,
          versions,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'DRIFT_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 5. ROUTER AUDIT
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/router/audit', async (
    request: FastifyRequest<{
      Querystring: { asset?: string; from?: string; to?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset, from, to, limit: limitStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    
    try {
      const compareSvc = getCompareService();
      const entries = compareSvc.getRouterAudit({ asset, from, to, limit });
      
      return reply.send({
        ok: true,
        data: {
          totalEntries: entries.length,
          entries,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'AUDIT_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 6. PROMOTION RECOMMENDATION
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/:asset/promotion/recommendation', async (
    request: FastifyRequest<{
      Params: { asset: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset } = request.params;
    
    try {
      const promotionSvc = getPromotionService();
      const decision = await promotionSvc.evaluatePromotion(asset);
      
      return reply.send({ ok: true, data: decision });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'PROMOTION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 7. EXECUTE PROMOTION (Admin) — Extended with validation
  // Note: Simple promote at /api/macro-engine/admin/promote exists in macro_engine.routes.ts
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/admin/promote-validated', async (
    request: FastifyRequest<{
      Body: { asset: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset } = request.body || {};
    
    if (!asset) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_ASSET',
        message: 'asset is required',
      });
    }
    
    try {
      const promotionSvc = getPromotionService();
      const result = await promotionSvc.executePromotion(asset);
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'PROMOTE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // 8. CALIBRATION STATUS
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/status', async (
    request: FastifyRequest<{
      Querystring: { asset?: string };
    }>,
    reply: FastifyReply
  ) => {
    const { asset = 'DXY' } = request.query;
    
    try {
      const calibrationSvc = getRollingCalibrationService();
      const current = await calibrationSvc.getCurrentWeights(asset);
      const needsRecal = await calibrationSvc.needsRecalibration(asset);
      
      const lastRun = current?.asOf?.toISOString?.() || null;
      let nextScheduled: string | null = null;
      
      if (lastRun) {
        const next = new Date(lastRun);
        next.setDate(next.getDate() + 30);
        nextScheduled = next.toISOString();
      }
      
      return reply.send({
        ok: true,
        data: {
          asset,
          lastRun,
          nextScheduled,
          activeVersion: current ? `weights_${asset}_${current.asOf?.toISOString?.().split('T')[0] || 'unknown'}` : null,
          needsRecalibration: needsRecal,
          health: needsRecal ? 'NEEDS_UPDATE' : 'OK',
          qualityScore: current?.qualityScore || 0,
          aggregateCorr: current?.aggregateCorr || 0,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[Compare Routes] Registered all compare/validation endpoints');
  
  // ─────────────────────────────────────────────────────────────
  // 9. WALK-FORWARD SIMULATION (P6 — Production Emulation)
  // Path: /api/macro-engine/simulation/v2/run (not /v2/simulate to avoid /:asset conflict)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/simulation/v2/run', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
        start?: string;
        end?: string;
        trainWindowYears?: string;
        stepMonths?: string;
        horizons?: string;
        mode?: string;
        seed?: string;
        forceRegime?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const {
      asset = 'dxy',
      start = '2025-01-01',
      end = '2026-02-27',
      trainWindowYears = '2',
      stepMonths = '1',
      horizons: horizonStr = '30D,90D,180D,365D',
      mode = 'regime-conditioned',
      seed = '42',
      forceRegime,
    } = request.query;
    
    try {
      const params: SimulationParams = {
        asset: asset.toLowerCase() as 'dxy',
        start,
        end,
        trainWindowYears: parseInt(trainWindowYears, 10),
        stepMonths: parseInt(stepMonths, 10),
        horizons: horizonStr.split(',') as ('30D' | '90D' | '180D' | '365D')[],
        mode: mode as 'regime-conditioned' | 'per-horizon',
        objective: 'HIT_RATE',
        seed: parseInt(seed, 10),
      };
      
      const simService = getSimulationService();
      const result = await simService.runSimulation(params);
      
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'SIMULATION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // POST version for more complex requests
  fastify.post('/api/macro-engine/simulation/v2/run', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        trainWindowYears?: number;
        stepMonths?: number;
        horizons?: string[];
        mode?: string;
        seed?: number;
        forceRegime?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const {
      asset = 'dxy',
      start = '2025-01-01',
      end = '2026-02-27',
      trainWindowYears = 2,
      stepMonths = 1,
      horizons = ['30D', '90D', '180D', '365D'],
      mode = 'regime-conditioned',
      seed = 42,
      forceRegime,
    } = request.body || {};
    
    try {
      const params: SimulationParams = {
        asset: asset.toLowerCase() as 'dxy',
        start,
        end,
        trainWindowYears,
        stepMonths,
        horizons: horizons as ('30D' | '90D' | '180D' | '365D')[],
        mode: mode as 'regime-conditioned' | 'per-horizon',
        objective: 'HIT_RATE',
        seed,
      };
      
      const simService = getSimulationService();
      const result = await simService.runSimulation(params);
      
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'SIMULATION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[Compare Routes] Simulate endpoint registered at /api/macro-engine/simulation/v2/run');
}
