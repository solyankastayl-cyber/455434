/**
 * Temporal Features API Routes
 * 
 * EPIC 7: Endpoints for temporal feature monitoring (SHADOW only)
 * 
 * NO training endpoints
 * NO decision endpoints
 */

import type { FastifyPluginAsync } from 'fastify';
import { 
  getShadowStats, 
  getRecentShadowFeatures,
  getShadowFeatures 
} from './temporal/shadow_feature.store.js';
import { 
  getRecentAuditEvents, 
  countEventsByType,
  getAuditEventsByToken 
} from '../ml_audit/temporal_audit.log.js';
import { getTemporalFeatureNames } from './temporal/temporal_builder.service.js';

export const temporalFeaturesRoutes: FastifyPluginAsync = async (app) => {
  // Get shadow feature statistics
  app.get('/stats', async (_req, reply) => {
    const stats = await getShadowStats();
    return reply.send({ ok: true, data: stats });
  });
  
  // Get recent shadow features (for monitoring)
  app.get('/recent', async (req, reply) => {
    const query = req.query as { hours?: string; limit?: string };
    const hours = parseInt(query.hours || '24', 10);
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const features = await getRecentShadowFeatures(hours, limit);
    
    return reply.send({
      ok: true,
      data: features,
      count: features.length,
    });
  });
  
  // Get features for specific token
  app.get('/token/:address', async (req, reply) => {
    const params = req.params as { address: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    
    const features = await getShadowFeatures(params.address, limit);
    
    return reply.send({
      ok: true,
      data: features,
      count: features.length,
    });
  });
  
  // Get feature schema (list of all feature names)
  app.get('/schema', async (_req, reply) => {
    const featureNames = getTemporalFeatureNames();
    
    return reply.send({
      ok: true,
      data: {
        featureCount: featureNames.length,
        features: featureNames,
        version: 'EPIC_7',
      }
    });
  });
  
  // Get audit events
  app.get('/audit', async (req, reply) => {
    const query = req.query as { hours?: string; limit?: string };
    const hours = parseInt(query.hours || '24', 10);
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const events = await getRecentAuditEvents(hours, limit);
    
    return reply.send({
      ok: true,
      data: events,
      count: events.length,
    });
  });
  
  // Get audit event counts by type
  app.get('/audit/counts', async (req, reply) => {
    const query = req.query as { hours?: string };
    const hours = parseInt(query.hours || '24', 10);
    
    const counts = await countEventsByType(hours);
    
    return reply.send({
      ok: true,
      data: counts,
    });
  });
  
  // Get audit events for specific token
  app.get('/audit/token/:address', async (req, reply) => {
    const params = req.params as { address: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    
    const events = await getAuditEventsByToken(params.address, limit);
    
    return reply.send({
      ok: true,
      data: events,
      count: events.length,
    });
  });
};
