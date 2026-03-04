/**
 * Engine Runtime Config Routes
 * 
 * API endpoints for ML runtime control
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { 
  getRuntimeConfig, 
  updateRuntimeConfig,
  checkKillSwitch,
} from './engine_runtime_config.service.js';

export async function engineRuntimeRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/engine/ml/runtime
   * Get current ML runtime configuration
   */
  app.get('/engine/ml/runtime', async () => {
    try {
      const config = await getRuntimeConfig();
      const killSwitchActive = await checkKillSwitch();
      
      return {
        ok: true,
        data: {
          mlEnabled: config.mlEnabled,
          mlMode: config.mlMode,
          killSwitchActive,
          disabledBy: config.disabledBy,
          disableReason: config.disableReason,
          lastUpdate: config.updatedAt,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get runtime config',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/engine/ml/runtime
   * Update ML runtime configuration
   */
  app.post('/engine/ml/runtime', async (request: FastifyRequest) => {
    const body = request.body as {
      mlEnabled?: boolean;
      mlMode?: 'off' | 'advisor' | 'assist';
    };
    
    try {
      // Check Kill Switch first
      const killSwitchActive = await checkKillSwitch();
      
      if (killSwitchActive && body.mlEnabled) {
        return {
          ok: false,
          error: 'Cannot enable ML: Kill Switch is active',
          details: 'ML quality has degraded. Review required before re-enabling.',
        };
      }
      
      // Validate request
      if (body.mlMode && !['off', 'advisor', 'assist'].includes(body.mlMode)) {
        return {
          ok: false,
          error: 'Invalid mlMode',
          details: 'mlMode must be: off, advisor, or assist',
        };
      }
      
      // Update config
      const config = await updateRuntimeConfig({
        mlEnabled: body.mlEnabled,
        mlMode: body.mlMode,
        disabledBy: body.mlEnabled === false ? 'operator' : undefined,
        disableReason: body.mlEnabled === false ? 'Manually disabled by operator' : undefined,
        updatedBy: 'operator',
      });
      
      return {
        ok: true,
        data: {
          mlEnabled: config.mlEnabled,
          mlMode: config.mlMode,
          updatedAt: config.updatedAt,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to update runtime config',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Engine Runtime] Routes registered');
}
