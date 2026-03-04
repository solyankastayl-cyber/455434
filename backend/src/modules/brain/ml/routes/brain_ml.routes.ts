/**
 * P8.0 — Brain ML Routes
 * 
 * Endpoints:
 * - GET /api/brain/v2/features — Feature vector for ML
 * - GET /api/brain/v2/forecast — Quantile forecasts (P8.0-B)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFeatureBuilderService } from '../services/feature_builder.service.js';
import {
  FEATURES_VERSION,
  FEATURE_COUNT,
  FEATURE_NAMES,
  validateFeatureVector,
} from '../contracts/feature_vector.contract.js';

export async function brainMlRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/features — Feature vector for asset
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/features', async (
    request: FastifyRequest<{
      Querystring: {
        asset?: string;
        asOf?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      const featureService = getFeatureBuilderService();
      const result = await featureService.buildFeatures(asset, asOf);
      
      // Validate
      const validation = validateFeatureVector(result.vector);
      
      if (!validation.valid) {
        return reply.status(500).send({
          ok: false,
          error: 'FEATURE_VALIDATION_FAILED',
          errors: validation.errors,
        });
      }
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'FEATURE_BUILD_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/features/schema — Feature names and metadata
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/features/schema', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: FEATURES_VERSION,
      featureCount: FEATURE_COUNT,
      features: FEATURE_NAMES.map((name, index) => ({
        index,
        name,
        range: '[-1, +1]',
        group: getFeatureGroup(index),
      })),
      groups: [
        { name: 'macro', indices: [0, 3], description: 'Macro score and weights' },
        { name: 'regime', indices: [4, 10], description: 'Regime probabilities' },
        { name: 'liquidity', indices: [11, 15], description: 'Liquidity state' },
        { name: 'guard', indices: [16, 22], description: 'Guard levels' },
        { name: 'returns', indices: [23, 26], description: 'Price returns' },
        { name: 'volatility', indices: [27, 29], description: 'Realized volatility' },
        { name: 'trend', indices: [30, 32], description: 'Trend indicators' },
        { name: 'drawdown', indices: [33, 35], description: 'Drawdown metrics' },
        { name: 'cross_asset', indices: [36, 40], description: 'Cross-asset correlations' },
        { name: 'drivers', indices: [41, 52], description: 'Top 3 macro drivers' },
      ],
    });
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/features/validate — Validate feature vector
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/brain/v2/features/validate', async (
    request: FastifyRequest<{
      Body: {
        vector: number[];
      };
    }>,
    reply: FastifyReply
  ) => {
    const { vector } = request.body || {};
    
    if (!vector || !Array.isArray(vector)) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_VECTOR',
      });
    }
    
    const validation = validateFeatureVector(vector);
    
    return reply.send({
      ok: validation.valid,
      ...validation,
    });
  });
  
  console.log('[Brain ML] Routes registered at /api/brain/v2/features');
}

// Helper to get feature group
function getFeatureGroup(index: number): string {
  if (index <= 3) return 'macro';
  if (index <= 10) return 'regime';
  if (index <= 15) return 'liquidity';
  if (index <= 22) return 'guard';
  if (index <= 26) return 'returns';
  if (index <= 29) return 'volatility';
  if (index <= 32) return 'trend';
  if (index <= 35) return 'drawdown';
  if (index <= 40) return 'cross_asset';
  return 'drivers';
}
