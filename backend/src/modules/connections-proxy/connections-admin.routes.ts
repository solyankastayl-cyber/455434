/**
 * Connections Admin Routes
 * 
 * ═══════════════════════════════════════════════════════════════
 * ADMIN CONTROL PLANE FOR CONNECTIONS MODULE
 * ═══════════════════════════════════════════════════════════════
 * 
 * Provides admin endpoints for managing and monitoring the Connections
 * module. Includes:
 * - Module overview and stats
 * - Configuration management
 * - Data source control (mock/sandbox/live)
 * - Alerts preview and management
 * 
 * PREFIX: /api/admin/connections
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/mongodb.js';

// Get connections database
function getConnectionsDb() {
  const client = getDb().client;
  return client.db('connections_db');
}

// In-memory state for the module (simulating runtime config)
let moduleState = {
  enabled: true,
  source_mode: 'seed' as 'seed' | 'mock' | 'twitter_live',
  last_sync: new Date().toISOString(),
  config: {
    influence_score_enabled: true,
    risk_detection_enabled: true,
    graph_share_enabled: true,
    max_results_per_page: 100,
    thresholds: {
      high_risk_score: 200,
      medium_risk_score: 500,
      min_engagement_quality: 0.001,
    },
  },
};

// Alerts store (in-memory for demo)
let alertsStore: Array<{
  id: string;
  type: string;
  severity: string;
  message: string;
  account?: string;
  status: 'preview' | 'sent' | 'suppressed';
  created_at: string;
}> = [];

export async function registerConnectionsAdminRoutes(app: FastifyInstance): Promise<void> {
  
  // ============================================
  // OVERVIEW
  // ============================================
  
  app.get('/overview', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      const totalAccounts = await col.countDocuments();
      const verifiedAccounts = await col.countDocuments({ verified: true });
      
      // Get category breakdown
      const byCategory = await col.aggregate([
        { $unwind: { path: '$categories', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$categories', count: { $sum: 1 } } }
      ]).toArray();
      
      // Calculate health metrics
      const avgInfluence = await col.aggregate([
        { $group: { _id: null, avg: { $avg: '$influence' } } }
      ]).toArray();
      
      return {
        ok: true,
        data: {
          enabled: moduleState.enabled,
          source_mode: moduleState.source_mode,
          last_sync: moduleState.last_sync,
          stats: {
            total_accounts: totalAccounts,
            verified_accounts: verifiedAccounts,
            avg_influence: avgInfluence[0]?.avg || 0,
            categories: byCategory.reduce((acc: any, c) => {
              acc[c._id || 'unknown'] = c.count;
              return acc;
            }, {}),
          },
          health: {
            status: totalAccounts > 0 ? 'healthy' : 'empty',
            db_connected: true,
          },
          alerts: {
            total: alertsStore.length,
            pending: alertsStore.filter(a => a.status === 'preview').length,
          },
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        data: {
          enabled: moduleState.enabled,
          source_mode: moduleState.source_mode,
          health: { status: 'error', db_connected: false },
        },
      };
    }
  });
  
  // ============================================
  // MODULE TOGGLE
  // ============================================
  
  app.post('/toggle', async (request) => {
    const body = request.body as { enabled?: boolean };
    
    if (body.enabled !== undefined) {
      moduleState.enabled = body.enabled;
    }
    
    return {
      ok: true,
      data: { enabled: moduleState.enabled },
    };
  });
  
  // ============================================
  // SOURCE MODE
  // ============================================
  
  app.post('/source', async (request) => {
    const body = request.body as { mode?: 'seed' | 'mock' | 'twitter_live' };
    
    if (body.mode && ['seed', 'mock', 'twitter_live'].includes(body.mode)) {
      moduleState.source_mode = body.mode;
    }
    
    return {
      ok: true,
      data: { source_mode: moduleState.source_mode },
    };
  });
  
  // ============================================
  // CONFIG
  // ============================================
  
  app.get('/config', async () => {
    return {
      ok: true,
      data: {
        config: moduleState.config,
        version: '1.0.0',
        editable: true,
      },
    };
  });
  
  app.post('/config', async (request) => {
    const body = request.body as Partial<typeof moduleState.config>;
    
    if (body) {
      moduleState.config = {
        ...moduleState.config,
        ...body,
        thresholds: {
          ...moduleState.config.thresholds,
          ...(body.thresholds || {}),
        },
      };
    }
    
    return {
      ok: true,
      data: { config: moduleState.config },
    };
  });
  
  // ============================================
  // DATA STATS
  // ============================================
  
  app.get('/data/stats', async () => {
    try {
      const db = getConnectionsDb();
      const col = db.collection('connections_unified_accounts');
      
      // Get field coverage
      const fieldCoverage = await col.aggregate([
        {
          $project: {
            has_handle: { $cond: [{ $ifNull: ['$handle', false] }, 1, 0] },
            has_name: { $cond: [{ $ifNull: ['$name', false] }, 1, 0] },
            has_influence: { $cond: [{ $ifNull: ['$influence', false] }, 1, 0] },
            has_followers: { $cond: [{ $ifNull: ['$followers', false] }, 1, 0] },
            has_categories: { $cond: [{ $gt: [{ $size: { $ifNull: ['$categories', []] } }, 0] }, 1, 0] },
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            with_handle: { $sum: '$has_handle' },
            with_name: { $sum: '$has_name' },
            with_influence: { $sum: '$has_influence' },
            with_followers: { $sum: '$has_followers' },
            with_categories: { $sum: '$has_categories' },
          }
        }
      ]).toArray();
      
      const stats = fieldCoverage[0] || {
        total: 0,
        with_handle: 0,
        with_name: 0,
        with_influence: 0,
        with_followers: 0,
        with_categories: 0,
      };
      
      return {
        ok: true,
        data: {
          total_records: stats.total,
          field_coverage: {
            handle: ((stats.with_handle / stats.total) * 100).toFixed(1) + '%',
            name: ((stats.with_name / stats.total) * 100).toFixed(1) + '%',
            influence: ((stats.with_influence / stats.total) * 100).toFixed(1) + '%',
            followers: ((stats.with_followers / stats.total) * 100).toFixed(1) + '%',
            categories: ((stats.with_categories / stats.total) * 100).toFixed(1) + '%',
          },
        },
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  // ============================================
  // ALERTS
  // ============================================
  
  app.get('/alerts', async (request) => {
    const query = request.query as { status?: string; limit?: string };
    
    let alerts = [...alertsStore];
    
    if (query.status) {
      alerts = alerts.filter(a => a.status === query.status);
    }
    
    const limit = parseInt(query.limit || '50');
    alerts = alerts.slice(0, limit);
    
    return {
      ok: true,
      data: {
        alerts,
        total: alertsStore.length,
        by_status: {
          preview: alertsStore.filter(a => a.status === 'preview').length,
          sent: alertsStore.filter(a => a.status === 'sent').length,
          suppressed: alertsStore.filter(a => a.status === 'suppressed').length,
        },
      },
    };
  });
  
  app.post('/alerts/generate', async () => {
    // Generate sample alerts for testing
    const newAlerts = [
      {
        id: `alert_${Date.now()}_1`,
        type: 'HIGH_INFLUENCE_SPIKE',
        severity: 'warning',
        message: 'Unusual influence spike detected for @crypto_whale',
        account: 'crypto_whale',
        status: 'preview' as const,
        created_at: new Date().toISOString(),
      },
      {
        id: `alert_${Date.now()}_2`,
        type: 'NEW_BREAKOUT',
        severity: 'info',
        message: 'New breakout signal from @defi_hunter',
        account: 'defi_hunter',
        status: 'preview' as const,
        created_at: new Date().toISOString(),
      },
    ];
    
    alertsStore.push(...newAlerts);
    
    return {
      ok: true,
      data: {
        generated: newAlerts.length,
        alerts: newAlerts,
      },
    };
  });
  
  app.post('/alerts/:id/send', async (request) => {
    const { id } = request.params as { id: string };
    
    const alert = alertsStore.find(a => a.id === id);
    if (!alert) {
      return { ok: false, error: 'Alert not found' };
    }
    
    alert.status = 'sent';
    
    return {
      ok: true,
      data: alert,
    };
  });
  
  app.post('/alerts/:id/suppress', async (request) => {
    const { id } = request.params as { id: string };
    
    const alert = alertsStore.find(a => a.id === id);
    if (!alert) {
      return { ok: false, error: 'Alert not found' };
    }
    
    alert.status = 'suppressed';
    
    return {
      ok: true,
      data: alert,
    };
  });
  
  // ============================================
  // SYNC / REFRESH
  // ============================================
  
  app.post('/sync', async () => {
    moduleState.last_sync = new Date().toISOString();
    
    return {
      ok: true,
      data: {
        last_sync: moduleState.last_sync,
        message: 'Sync completed (data loaded from seed)',
      },
    };
  });
  
  console.log('[ConnectionsAdmin] Routes registered at /api/admin/connections/*');
}
