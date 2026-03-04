/**
 * P0: Model Config Routes
 * 
 * Runtime config management endpoints.
 * Connects Governance UI → Mongo → Engine chain.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { ModelConfigStore } from '../config/model-config.store.js';
import { getRuntimeDebugInfo, getRuntimeEngineConfig } from '../config/runtime-config.service.js';
import { AssetKey, ModelConfigDoc } from '../config/model-config.contract.js';

interface ConfigQuery {
  asset?: string;
}

interface ConfigUpdateBody {
  asset?: string;  // P3-A: Accept asset in body
  windowLen?: number;
  topK?: number;
  similarityMode?: 'zscore' | 'raw_returns';
  minGapDays?: number;
  ageDecayLambda?: number;
  regimeConditioning?: boolean;
  horizonWeights?: Record<string, number>;
  tierWeights?: Record<string, number>;
  // P3-A: SPX-specific
  consensusThreshold?: number;
  divergencePenalty?: number;
  // P3-B: DXY-specific  
  syntheticWeight?: number;
  replayWeight?: number;
  macroWeight?: number;
}

export async function modelConfigRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/governance/runtime-debug
   * 
   * Debug: shows which config source is active and current values
   */
  fastify.get('/api/fractal/v2.1/admin/governance/runtime-debug', async (
    request: FastifyRequest<{ Querystring: ConfigQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      const debug = await getRuntimeDebugInfo(asset);
      return {
        ok: true,
        ...debug,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/governance/model-config
   * 
   * Get current model config for asset
   */
  fastify.get('/api/fractal/v2.1/admin/governance/model-config', async (
    request: FastifyRequest<{ Querystring: ConfigQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      const runtime = await getRuntimeEngineConfig(asset);
      return {
        ok: true,
        asset,
        config: runtime,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/governance/model-config
   * 
   * Update model config for asset (writes to MongoDB)
   * This is the KEY endpoint that makes Governance UI affect Engine.
   * 
   * P5-FINAL: Governance Freeze - blocked if health is CRITICAL
   */
  fastify.post('/api/fractal/v2.1/admin/governance/model-config', async (
    request: FastifyRequest<{ 
      Querystring: ConfigQuery;
      Body: ConfigUpdateBody;
    }>
  ) => {
    // P3-A: Accept asset from body or query string
    const asset = ((request.body as any)?.asset ?? request.query.asset ?? 'BTC') as AssetKey;
    const body = request.body || {};
    const forceOverride = (body as any).force === true;
    
    try {
      // P5-FINAL: Check governance freeze
      if (!forceOverride) {
        try {
          const { isGovernanceFrozen } = await import('../../health/model_health.service.js');
          const freezeCheck = await isGovernanceFrozen(asset as any);
          if (freezeCheck.frozen) {
            return { 
              ok: false, 
              error: 'FROZEN_BY_HEALTH', 
              reason: freezeCheck.reason,
              hint: 'Use force=true to override (will be logged)'
            };
          }
        } catch (e) {
          // Health service not initialized yet - allow operation
        }
      } else {
        console.log(`[Governance] FORCE OVERRIDE: config update for ${asset} despite health state`);
      }
      
      // Validate inputs
      if (body.windowLen !== undefined && (body.windowLen < 10 || body.windowLen > 365)) {
        return { ok: false, error: 'windowLen must be between 10 and 365' };
      }
      if (body.topK !== undefined && (body.topK < 3 || body.topK > 100)) {
        return { ok: false, error: 'topK must be between 3 and 100' };
      }
      if (body.similarityMode !== undefined && !['zscore', 'raw_returns'].includes(body.similarityMode)) {
        return { ok: false, error: 'similarityMode must be zscore or raw_returns' };
      }
      if (body.ageDecayLambda !== undefined && (body.ageDecayLambda < 0 || body.ageDecayLambda > 0.1)) {
        return { ok: false, error: 'ageDecayLambda must be between 0 and 0.1' };
      }
      
      // Build update payload
      const patch: Partial<ModelConfigDoc> = {};
      if (body.windowLen !== undefined) patch.windowLen = body.windowLen;
      if (body.topK !== undefined) patch.topK = body.topK;
      if (body.similarityMode !== undefined) patch.similarityMode = body.similarityMode;
      if (body.minGapDays !== undefined) patch.minGapDays = body.minGapDays;
      if (body.ageDecayLambda !== undefined) patch.ageDecayLambda = body.ageDecayLambda;
      if (body.regimeConditioning !== undefined) patch.regimeConditioning = body.regimeConditioning;
      if (body.horizonWeights !== undefined) patch.horizonWeights = body.horizonWeights;
      if (body.tierWeights !== undefined) patch.tierWeights = body.tierWeights;
      // P3-A: SPX-specific
      if ((body as any).consensusThreshold !== undefined) (patch as any).consensusThreshold = (body as any).consensusThreshold;
      if ((body as any).divergencePenalty !== undefined) (patch as any).divergencePenalty = (body as any).divergencePenalty;
      // P3-B: DXY-specific
      if ((body as any).syntheticWeight !== undefined) (patch as any).syntheticWeight = (body as any).syntheticWeight;
      if ((body as any).replayWeight !== undefined) (patch as any).replayWeight = (body as any).replayWeight;
      if ((body as any).macroWeight !== undefined) (patch as any).macroWeight = (body as any).macroWeight;
      
      // Upsert to MongoDB
      const result = await ModelConfigStore.upsert(asset, patch, 'admin:governance');
      
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      
      // Return updated config
      const updated = await getRuntimeEngineConfig(asset);
      
      console.log(`[ModelConfig] Updated ${asset} config:`, patch);
      
      return {
        ok: true,
        asset,
        message: 'Config updated successfully. Changes will affect next focus-pack build.',
        config: updated,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/governance/model-config/initialize
   * 
   * Initialize default config for asset (if not exists)
   */
  fastify.post('/api/fractal/v2.1/admin/governance/model-config/initialize', async (
    request: FastifyRequest<{ Querystring: ConfigQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      const created = await ModelConfigStore.initializeIfMissing(asset);
      
      if (created) {
        return {
          ok: true,
          message: `Initialized default config for ${asset}`,
          created: true,
        };
      } else {
        return {
          ok: true,
          message: `Config for ${asset} already exists`,
          created: false,
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/governance/model-config/all
   * 
   * List all model configs
   */
  fastify.get('/api/fractal/v2.1/admin/governance/model-config/all', async () => {
    try {
      const configs = await ModelConfigStore.listAll();
      return {
        ok: true,
        count: configs.length,
        configs,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });

  console.log('[Fractal] P0: Model Config routes registered (/api/fractal/v2.1/admin/governance/model-config/*)');
  console.log('[Fractal] P0: Runtime debug endpoint: /api/fractal/v2.1/admin/governance/runtime-debug');
}

export default modelConfigRoutes;
