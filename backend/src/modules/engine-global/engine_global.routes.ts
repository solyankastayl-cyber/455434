/**
 * ENGINE GLOBAL ROUTES — P5.0 + P5.2 + P7.0 (Brain Integration)
 * 
 * Single entry point for world view.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildEngineGlobal, ENGINE_VERSION } from './engine_global.service.js';
import { getEngineGlobalWithBrain, BrainMode } from './engine_global_brain_bridge.service.js';
import { engineCache } from './engine_cache.js';
import { POLICY_VERSION } from './allocation_policy.service.js';

export async function registerEngineGlobalRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/engine';
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/engine/health
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/health`, async () => {
    return {
      ok: true,
      module: 'engine-global',
      version: ENGINE_VERSION,
      policyVersion: POLICY_VERSION,
      phase: 'P7.0',
      brainIntegration: true,
      cache: engineCache.stats(),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/engine/global — Main endpoint (with brain support)
  // Query params:
  //   - asOf: date string
  //   - brain: 1 or true to enable brain
  //   - brainMode: on | off | shadow
  //   - optimizer: 1 or true to enable optimizer (P11)
  //   - capital: 1 or true to enable capital scaling (v2.3)
  //   - capitalMode: on | off | shadow (v2.3)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/global`, async (
    req: FastifyRequest<{
      Querystring: {
        asOf?: string;
        brain?: string;
        brainMode?: string;
        optimizer?: string;  // P11
        capital?: string;    // v2.3
        capitalMode?: string; // v2.3
      };
    }>
  ) => {
    const { asOf, brain, brainMode, optimizer, capital, capitalMode } = req.query;
    
    try {
      // Check if brain is enabled
      const brainEnabled = brain === '1' || brain === 'true';
      const optimizerEnabled = optimizer === '1' || optimizer === 'true';
      const capitalEnabled = capital === '1' || capital === 'true';
      
      // Default mode: 'on' when brain enabled, 'off' otherwise
      const mode: BrainMode = brainMode 
        ? (brainMode as BrainMode) 
        : (brainEnabled ? 'on' : 'off');
      
      // Capital mode: defaults to 'on' after P13 validation (v2.3 production)
      const capMode = capitalMode 
        ? (capitalMode as 'on' | 'off' | 'shadow') 
        : 'on';
      
      // Use brain bridge if enabled
      if (brainEnabled) {
        const result = await getEngineGlobalWithBrain({
          asOf,
          brain: true,
          brainMode: mode,
          optimizer: optimizerEnabled,
          capital: capitalEnabled,
          capitalMode: capMode,
        });
        return result;
      }
      
      // Default: base engine without brain
      const result = await buildEngineGlobal(asOf);
      return {
        ...result,
        brain: { mode: 'off' },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        version: ENGINE_VERSION,
      };
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/engine/global/summary — Quick summary
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/global/summary`, async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>
  ) => {
    const { asOf } = req.query;
    
    try {
      const result = await buildEngineGlobal(asOf);
      
      return {
        ok: true,
        asOf: result.meta.asOf,
        global: {
          riskMode: result.global.riskMode,
          confidence: result.global.confidence,
          guardLevel: result.global.guardLevel,
        },
        allocations: result.allocations,
        headline: result.evidence.headline,
        policyRules: result.policy.appliedRules,
        latencyMs: result.meta.latencyMs,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/engine/global/evidence — Full evidence pack
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/global/evidence`, async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>
  ) => {
    const { asOf } = req.query;
    
    try {
      const result = await buildEngineGlobal(asOf);
      
      return {
        ok: true,
        asOf: result.meta.asOf,
        global: result.global,
        allocations: result.allocations,
        evidence: result.evidence,
        policy: result.policy,
        latencyMs: result.meta.latencyMs,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // P5.2: GET /api/engine/global/policy — Policy breakdown only
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/global/policy`, async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>
  ) => {
    const { asOf } = req.query;
    
    try {
      const result = await buildEngineGlobal(asOf);
      
      return {
        ok: true,
        asOf: result.meta.asOf,
        allocations: result.allocations,
        policy: result.policy,
        latencyMs: result.meta.latencyMs,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/engine/admin/cache/clear — Clear cache
  // ─────────────────────────────────────────────────────────────
  
  fastify.post(`${prefix}/admin/cache/clear`, async (
    req: FastifyRequest<{ Body: { pattern?: string } }>
  ) => {
    const body = req.body || {};
    const cleared = engineCache.invalidate(body.pattern);
    
    return {
      ok: true,
      cleared,
      stats: engineCache.stats(),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/engine/admin/cache/stats — Cache stats
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/admin/cache/stats`, async () => {
    return {
      ok: true,
      stats: engineCache.stats(),
    };
  });
  
  fastify.log.info(`[Engine Global P5.2] Routes registered at ${prefix}/*`);
}

export default registerEngineGlobalRoutes;
