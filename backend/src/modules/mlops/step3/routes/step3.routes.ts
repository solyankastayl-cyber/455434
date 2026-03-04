/**
 * Step 3 Routes
 * P0.1: Accelerated validation APIs
 */

import { FastifyInstance } from 'fastify';
import { step3ConfigService } from '../services/step3.config.service.js';
import { step3WindowService } from '../services/step3.window.service.js';

export async function step3Routes(fastify: FastifyInstance) {
  fastify.get('/api/mlops/step3/config', async () => {
    return {
      ok: true,
      config: step3ConfigService.getConfig(),
    };
  });

  fastify.get('/api/mlops/step3/window', async () => {
    return {
      ok: true,
      validationWindowMs: step3WindowService.getValidationWindowMs(),
      acceleratedWindowMs: step3WindowService.getAcceleratedWindowMs(),
    };
  });

  console.log('[Step3Routes] Registered');
}

export default step3Routes;
