/**
 * ML v2.3 - Admin Routes
 * 
 * API endpoints for v2.3 feature pruning + weighting.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { trainV23Shadow, type V23TrainOptions } from './v23_train_orchestrator.service.js';
import { 
  DEFAULT_V23_SETTINGS,
  type V23Settings,
  type MlTask
} from './ml_v23.config.js';
import { pyV23Health } from './python_v23.client.js';
import { MlModelRegistryModel } from '../ml_model_registry.model.js';

interface TrainParams {
  task: MlTask;
  network: string;
}

interface TrainBody {
  datasetPath?: string;
  pruning?: Record<string, any>;
  weighting?: Record<string, any>;
}

interface SettingsBody {
  settings: V23Settings;
}

/**
 * Register v2.3 admin routes
 */
export async function adminMlV23Routes(app: FastifyInstance) {
  
  // Helper to get db connection
  const getDb = () => mongoose.connection.db;
  
  // ============================================
  // TRAINING
  // ============================================
  
  /**
   * POST /api/admin/ml/v23/train/:task/:network
   * 
   * Train v2.3 SHADOW model with feature pruning + weighting.
   */
  app.post<{ Params: TrainParams; Body: TrainBody }>(
    '/api/admin/ml/v23/train/:task/:network',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            task: { type: 'string', enum: ['market', 'actor'] },
            network: { type: 'string' }
          },
          required: ['task', 'network']
        }
      }
    },
    async (request, reply) => {
      const { task, network } = request.params;
      const { datasetPath, pruning, weighting } = request.body || {};
      
      try {
        const result = await trainV23Shadow(app, {
          task,
          network,
          datasetPath,
          pruning,
          weighting,
        });
        
        return reply.send({
          ok: true,
          message: `v2.3 SHADOW model trained: ${result.modelVersion}`,
          data: result
        });
      } catch (error: any) {
        console.error(`[v2.3] Train error:`, error);
        return reply.status(500).send({
          ok: false,
          error: error.message || 'Training failed'
        });
      }
    }
  );
  
  // ============================================
  // SETTINGS
  // ============================================
  
  /**
   * GET /api/admin/ml/v23/settings
   * 
   * Get v2.3 configuration.
   */
  app.get('/api/admin/ml/v23/settings', async (request, reply) => {
    try {
      const db = getDb();
      if (!db) {
        return reply.send({
          ok: true,
          settings: DEFAULT_V23_SETTINGS,
          defaults: DEFAULT_V23_SETTINGS,
          note: 'Using defaults (database not connected)'
        });
      }
      
      const doc = await db.collection('admin_settings').findOne({
        category: 'ml_v23'
      });
      
      const settings = doc?.settings as V23Settings || DEFAULT_V23_SETTINGS;
      
      return reply.send({
        ok: true,
        settings,
        defaults: DEFAULT_V23_SETTINGS
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ml/v23/settings
   * 
   * Update v2.3 configuration.
   */
  app.post<{ Body: SettingsBody }>(
    '/api/admin/ml/v23/settings',
    async (request, reply) => {
      try {
        const { settings } = request.body;
        
        if (!settings) {
          return reply.status(400).send({
            ok: false,
            error: 'Settings required'
          });
        }
        
        const db = getDb();
        if (!db) {
          return reply.status(500).send({ ok: false, error: 'Database not available' });
        }
        
        await db.collection('admin_settings').updateOne(
          { category: 'ml_v23' },
          { 
            $set: { 
              settings,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
        
        return reply.send({
          ok: true,
          message: 'v2.3 settings updated',
          settings
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );
  
  // ============================================
  // STATUS
  // ============================================
  
  /**
   * GET /api/admin/ml/v23/status
   * 
   * Get v2.3 system status.
   */
  app.get('/api/admin/ml/v23/status', async (request, reply) => {
    try {
      // Check Python service health
      const pyHealthy = await pyV23Health();
      
      // Get recent v2.3 models using Mongoose
      const recentModels = await MlModelRegistryModel.find({
        version: { $regex: /^v2\.3\./ }
      })
        .sort({ trainedAt: -1 })
        .limit(5)
        .lean();
      
      // Get settings
      const db = getDb();
      const settingsDoc = db ? await db.collection('admin_settings')
        .findOne({ category: 'ml_v23' }) : null;
      
      return reply.send({
        ok: true,
        status: {
          pythonService: pyHealthy ? 'healthy' : 'unavailable',
          configured: !!settingsDoc,
          recentModels: recentModels.map(m => ({
            version: m.version,
            task: m.modelType,
            network: m.network,
            status: m.status,
            metrics: m.metrics,
            trainedAt: m.trainedAt
          }))
        }
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message
      });
    }
  });
  
  /**
   * GET /api/admin/ml/v23/features/:task/:network
   * 
   * Get feature analysis for task/network.
   */
  app.get<{ Params: TrainParams }>(
    '/api/admin/ml/v23/features/:task/:network',
    async (request, reply) => {
      const { task, network } = request.params;
      
      try {
        // Get latest v2.3 model for this task/network using Mongoose
        const model = await MlModelRegistryModel.findOne({
          version: { $regex: /^v2\.3\./ },
          modelType: task,
          network
        })
          .sort({ trainedAt: -1 })
          .lean();
        
        if (!model) {
          return reply.send({
            ok: true,
            message: 'No v2.3 model found for this task/network',
            features: null
          });
        }
        
        const featureMeta = model.featureMeta || {};
        
        return reply.send({
          ok: true,
          modelVersion: model.version,
          features: {
            kept: featureMeta.keptFeatures || [],
            dropped: featureMeta.droppedFeatures || [],
            importances: featureMeta.importances || {},
            pruningConfig: featureMeta.pruning || {},
            weightingConfig: featureMeta.weighting || {}
          }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );
}
