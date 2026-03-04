/**
 * Admin ML Models Routes
 * 
 * BATCH 1: API для просмотра реестра моделей.
 * 
 * Endpoints:
 * - GET /api/admin/ml/registry - List all models in registry
 * - GET /api/admin/ml/registry/active - Get active models
 * - GET /api/admin/ml/registry/shadow - Get shadow models
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MlModelRegistryModel, ModelStatus } from './ml_model_registry.model.js';
import { requireAdminAuth } from '../admin/admin.middleware.js';

interface ModelsQuery {
  modelType?: 'market' | 'actor';
  network?: string;
  status?: ModelStatus;
  limit?: number;
}

export async function adminMlModelsRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /ml/registry
   * List all models with optional filters
   */
  app.get<{ Querystring: ModelsQuery }>(
    '/ml/registry',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Querystring: ModelsQuery }>, reply: FastifyReply) => {
      const { modelType, network, status, limit = 50 } = request.query;

      const filter: any = {};
      if (modelType) filter.modelType = modelType;
      if (network) filter.network = network;
      if (status) filter.status = status;

      const models = await MlModelRegistryModel
        .find(filter)
        .sort({ trainedAt: -1 })
        .limit(Math.min(limit, 100))
        .lean();

      const summary = {
        total: models.length,
        active: models.filter(m => m.status === 'ACTIVE').length,
        shadow: models.filter(m => m.status === 'SHADOW').length,
        archived: models.filter(m => m.status === 'ARCHIVED').length,
      };

      return reply.send({
        ok: true,
        summary,
        models
      });
    }
  );

  /**
   * GET /ml/registry/active
   * Get currently active models (for inference)
   */
  app.get(
    '/ml/registry/active',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const activeModels = await MlModelRegistryModel
        .find({ status: 'ACTIVE' })
        .sort({ trainedAt: -1 })
        .lean();

      // Group by modelType + network
      const grouped: Record<string, any> = {};
      for (const model of activeModels) {
        const key = `${model.modelType}/${model.network}`;
        if (!grouped[key]) {
          grouped[key] = model;
        }
      }

      return reply.send({
        ok: true,
        count: Object.keys(grouped).length,
        models: grouped
      });
    }
  );

  /**
   * GET /ml/registry/shadow
   * Get shadow models (candidates for promotion)
   */
  app.get(
    '/ml/registry/shadow',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const shadowModels = await MlModelRegistryModel
        .find({ status: 'SHADOW' })
        .sort({ trainedAt: -1 })
        .lean();

      return reply.send({
        ok: true,
        count: shadowModels.length,
        models: shadowModels
      });
    }
  );

  app.log.info('[BATCH 1] Admin ML Models (Registry) routes registered');
}
