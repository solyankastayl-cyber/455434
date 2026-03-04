/**
 * FRACTAL FREEZE ROUTES
 * 
 * Admin endpoints for freeze status and stamp.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateFreezeStamp, getFreezeStatus } from './index.js';
import { FRACTAL_CONTRACT_VERSION, FRACTAL_CONTRACT_HASH } from '../contracts/index.js';

export async function registerFreezeRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin';

  /**
   * GET /admin/freeze-stamp
   * Returns the current freeze stamp for audit
   */
  fastify.get(`${prefix}/freeze-stamp`, async (req: FastifyRequest, reply: FastifyReply) => {
    const stamp = generateFreezeStamp();
    return stamp;
  });

  /**
   * GET /admin/freeze-status
   * Quick check of freeze state
   */
  fastify.get(`${prefix}/freeze-status`, async (req: FastifyRequest, reply: FastifyReply) => {
    const status = getFreezeStatus();
    return {
      ...status,
      contractVersion: FRACTAL_CONTRACT_VERSION,
      contractHash: FRACTAL_CONTRACT_HASH
    };
  });

  fastify.log.info('[Fractal] Freeze routes registered');
}
