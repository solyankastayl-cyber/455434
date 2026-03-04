/**
 * CAPITAL SCALING ROUTES — v2.3
 * 
 * API endpoints for Capital Scaling module:
 * - GET  /api/capital-scaling/preview - Shadow mode preview
 * - POST /api/capital-scaling/apply - Apply scaling (on mode)
 * - GET  /api/capital-scaling/config - Get current config
 * - PATCH /api/capital-scaling/config - Update config
 * - GET  /api/capital-scaling/health - Health check
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCapitalScalingService } from './capital_scaling.service.js';
import { 
  getCapitalConfig, 
  updateCapitalConfig, 
  resetCapitalConfig,
  CapitalScalingConfig 
} from './capital_scaling.config.js';
import { 
  CapitalScalingInput, 
  CapitalScalingMode,
  ScenarioType,
  GuardLevel 
} from './capital_scaling.contract.js';
import { getVersionInfo, CAPITAL_SCALING_VERSION } from '../../core/version.js';
import { runAllCapitalScalingTests } from './capital_scaling.test.js';

interface ScalingQueryParams {
  scenario?: ScenarioType;
  guardLevel?: GuardLevel;
  realizedVol?: string;
  tailRisk?: string;
  spx?: string;
  btc?: string;
  cash?: string;
  asOf?: string;
}

interface ConfigUpdateBody {
  baseRiskBudget?: number;
  targetVol?: number;
  volClampMin?: number;
  volClampMax?: number;
  tailPenaltyMax?: number;
  minRiskBudget?: number;
  maxRiskBudget?: number;
  guardCaps?: {
    BLOCK?: number;
    CRISIS?: number;
  };
}

export async function capitalScalingRoutes(fastify: FastifyInstance): Promise<void> {
  const service = getCapitalScalingService();
  
  // Health check
  fastify.get('/api/capital-scaling/health', async (_req, reply) => {
    return {
      ok: true,
      version: CAPITAL_SCALING_VERSION,
      versionInfo: getVersionInfo(),
      config: getCapitalConfig()
    };
  });
  
  // Preview scaling (shadow mode)
  fastify.get<{ Querystring: ScalingQueryParams }>(
    '/api/capital-scaling/preview',
    async (req, reply) => {
      try {
        const query = req.query;
        
        // Parse input
        const input: CapitalScalingInput = {
          allocations: {
            spx: parseFloat(query.spx || '0.35'),
            btc: parseFloat(query.btc || '0.25'),
            cash: parseFloat(query.cash || '0.40')
          },
          scenario: (query.scenario as ScenarioType) || 'BASE',
          guardLevel: (query.guardLevel as GuardLevel) || 'NORMAL',
          realizedVol: parseFloat(query.realizedVol || '0.15'),
          tailRisk: parseFloat(query.tailRisk || '0.05'),
          asOf: query.asOf || new Date().toISOString().split('T')[0]
        };
        
        // Normalize allocations if needed
        const sum = input.allocations.spx + input.allocations.btc + input.allocations.cash;
        if (Math.abs(sum - 1.0) > 0.01) {
          const adj = 1 / sum;
          input.allocations.spx *= adj;
          input.allocations.btc *= adj;
          input.allocations.cash = 1 - input.allocations.spx - input.allocations.btc;
        }
        
        const result = service.preview(input);
        
        return {
          ok: true,
          mode: 'shadow',
          input,
          result: result.pack,
          wouldApply: {
            spx: result.pack.after.spx - result.pack.before.spx,
            btc: result.pack.after.btc - result.pack.before.btc,
            cash: result.pack.after.cash - result.pack.before.cash
          }
        };
      } catch (err) {
        reply.code(500);
        return { ok: false, error: (err as Error).message };
      }
    }
  );
  
  // Apply scaling (on mode)
  fastify.post<{ Body: Partial<CapitalScalingInput> & { mode?: CapitalScalingMode } }>(
    '/api/capital-scaling/apply',
    async (req, reply) => {
      try {
        const body = req.body || {};
        const mode: CapitalScalingMode = body.mode || 'on';
        
        const input: CapitalScalingInput = {
          allocations: body.allocations || { spx: 0.35, btc: 0.25, cash: 0.40 },
          scenario: body.scenario || 'BASE',
          guardLevel: body.guardLevel || 'NORMAL',
          realizedVol: body.realizedVol || 0.15,
          tailRisk: body.tailRisk || 0.05,
          asOf: body.asOf || new Date().toISOString().split('T')[0]
        };
        
        const result = service.apply(input, mode);
        
        return {
          ok: true,
          mode,
          allocations: result.allocations,
          pack: result.pack
        };
      } catch (err) {
        reply.code(500);
        return { ok: false, error: (err as Error).message };
      }
    }
  );
  
  // Get config
  fastify.get('/api/capital-scaling/config', async (_req, reply) => {
    return {
      ok: true,
      config: getCapitalConfig(),
      version: CAPITAL_SCALING_VERSION
    };
  });
  
  // Update config
  fastify.patch<{ Body: ConfigUpdateBody }>(
    '/api/capital-scaling/config',
    async (req, reply) => {
      try {
        const updates = req.body || {};
        const newConfig = updateCapitalConfig(updates);
        
        return {
          ok: true,
          config: newConfig,
          message: 'Config updated'
        };
      } catch (err) {
        reply.code(500);
        return { ok: false, error: (err as Error).message };
      }
    }
  );
  
  // Reset config to defaults
  fastify.post('/api/capital-scaling/config/reset', async (_req, reply) => {
    const config = resetCapitalConfig();
    return {
      ok: true,
      config,
      message: 'Config reset to defaults'
    };
  });
  
  // Run tests
  fastify.get('/api/capital-scaling/test', async (_req, reply) => {
    try {
      const results = runAllCapitalScalingTests();
      return {
        ok: results.failed === 0,
        passed: results.passed,
        failed: results.failed,
        total: results.passed + results.failed,
        results: results.results,
        version: CAPITAL_SCALING_VERSION
      };
    } catch (err) {
      reply.code(500);
      return { ok: false, error: (err as Error).message };
    }
  });
  
  fastify.log.info('[Capital Scaling] v2.3 Routes registered at /api/capital-scaling/*');
}

export default capitalScalingRoutes;
