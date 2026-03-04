/**
 * System Alerts V2 - Routes
 * 
 * API Endpoints:
 * - GET /api/system-alerts - List alerts with filters
 * - GET /api/system-alerts/summary - Stats for dashboard
 * - POST /api/system-alerts/:alertId/ack - Acknowledge alert
 */
import { FastifyInstance } from 'fastify';
import { systemAlertService } from './system_alert.service.js';
import type { AlertStatus, AlertSeverity, AlertCategory, SystemAlertType } from './system_alert.model.js';

export async function registerSystemAlertRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/system-alerts
   * Get list of system alerts with optional filters
   */
  app.get('/api/system-alerts', async (request, reply) => {
    try {
      const {
        status,
        severity,
        category,
        type,
        source,
        chain,
        limit = 100,
        offset = 0,
      } = request.query as {
        status?: AlertStatus;
        severity?: AlertSeverity;
        category?: AlertCategory;
        type?: SystemAlertType;
        source?: string;
        chain?: string;
        limit?: number;
        offset?: number;
      };

      const alerts = await systemAlertService.getAlerts({
        status,
        severity,
        category,
        type,
        source,
        chain,
        limit: Number(limit),
        offset: Number(offset),
      });

      return reply.code(200).send({
        success: true,
        count: alerts.length,
        alerts,
      });
    } catch (error: any) {
      console.error('[SystemAlerts] Get alerts error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/system-alerts/summary
   * Get alert summary stats for dashboard header cards
   */
  app.get('/api/system-alerts/summary', async (request, reply) => {
    try {
      const summary = await systemAlertService.getSummary();

      return reply.code(200).send({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      console.error('[SystemAlerts] Get summary error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/system-alerts/:alertId/ack
   * Acknowledge an alert
   */
  app.post('/api/system-alerts/:alertId/ack', async (request, reply) => {
    try {
      const { alertId } = request.params as { alertId: string };
      const { ackedBy = 'user' } = request.body as { ackedBy?: string };

      const success = await systemAlertService.acknowledgeAlert(alertId, ackedBy);

      if (!success) {
        return reply.code(404).send({
          success: false,
          error: 'Alert not found or already acknowledged',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'Alert acknowledged',
        alertId,
      });
    } catch (error: any) {
      console.error('[SystemAlerts] Acknowledge error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/system-alerts/:alertId/resolve
   * Resolve an alert
   */
  app.post('/api/system-alerts/:alertId/resolve', async (request, reply) => {
    try {
      const { alertId } = request.params as { alertId: string };
      const { resolvedBy = 'user' } = request.body as { resolvedBy?: string };

      const success = await systemAlertService.resolveAlert(alertId, resolvedBy);

      if (!success) {
        return reply.code(404).send({
          success: false,
          error: 'Alert not found or already resolved',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'Alert resolved',
        alertId,
      });
    } catch (error: any) {
      console.error('[SystemAlerts] Resolve error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/system-alerts/test
   * Create a test alert (for development)
   */
  app.post('/api/system-alerts/test', async (request, reply) => {
    try {
      const { type = 'ML_MODE_CHANGE', severity = 'MEDIUM' } = request.body as {
        type?: SystemAlertType;
        severity?: AlertSeverity;
      };

      // Create test alert based on type
      let alert;
      
      switch (type) {
        case 'ML_KILL_SWITCH':
          alert = await systemAlertService.onMLKillSwitch({
            reason: 'Test: Flip Rate exceeded threshold',
            triggeredBy: 'test',
            flipRate: 0.08,
            ece: 0.12,
          });
          break;
          
        case 'ML_MODE_CHANGE':
          alert = await systemAlertService.onMLModeChange({
            fromMode: 'ADVISOR',
            toMode: 'ASSIST',
            triggeredBy: 'test',
          });
          break;
          
        case 'ML_DRIFT_HIGH':
          alert = await systemAlertService.onMLDriftHigh({
            driftLevel: 'HIGH',
            metrics: { featureDrift: 0.23, labelDrift: 0.18 },
          });
          break;
          
        case 'RPC_DEGRADED':
          alert = await systemAlertService.onRPCDegraded({
            provider: 'Ankr',
            chain: 'ETH',
            errorRate: 0.15,
          });
          break;
          
        case 'BRIDGE_ACTIVITY_SPIKE':
          alert = await systemAlertService.onBridgeSpike({
            bridge: 'Stargate',
            fromChain: 'ETH',
            toChain: 'ARB',
            volumeUSD: 15_000_000,
            changePercent: 340,
          });
          break;
          
        case 'RPC_RECOVERED':
          // Auto-resolve related RPC_DEGRADED alerts
          const resolvedCount = await systemAlertService.autoResolveRelated('RPC_RECOVERED');
          alert = await systemAlertService.createAlert({
            type: 'RPC_RECOVERED',
            title: 'RPC Service Recovered: Ankr',
            message: 'RPC provider Ankr has recovered and is operating normally.',
            metadata: { provider: 'Ankr', autoResolved: resolvedCount },
            severity: 'INFO',
          });
          break;
          
        default:
          alert = await systemAlertService.onMLModeChange({
            fromMode: 'OFF',
            toMode: 'ADVISOR',
            triggeredBy: 'test',
          });
      }

      return reply.code(201).send({
        success: true,
        message: 'Test alert created',
        alert: {
          alertId: alert.alertId,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
        },
      });
    } catch (error: any) {
      console.error('[SystemAlerts] Test alert error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[SystemAlerts] Routes registered');
}
