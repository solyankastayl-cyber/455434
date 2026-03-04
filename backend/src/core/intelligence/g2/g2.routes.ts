/**
 * G2 Cybercrime Hunter API Routes
 * 
 * Endpoints for cybercrime intelligence
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { G2CybercrimeService } from './g2_cybercrime.service.js';
import { isValidNetwork } from '../../../common/network.types.js';

export const g2Routes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const g2Service = new G2CybercrimeService(db);

  /**
   * GET /api/intel/g2/cybercrime
   * 
   * Analyze an address for cybercrime patterns
   * 
   * Query params:
   * - network: ethereum | arbitrum | optimism | base | polygon | bnb | zksync | scroll
   * - address: ethereum address
   * - window: 24h (optional, for display only)
   * - source: auto | transfers | relations (default: auto)
   */
  app.get('/cybercrime', async (req, reply) => {
    const query = req.query as {
      network?: string;
      address?: string;
      window?: string;
      source?: string;
    };

    const network = query.network || 'ethereum';
    const address = query.address;
    const source = (query.source || 'auto') as 'auto' | 'transfers' | 'relations';

    // Validate inputs
    if (!address) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_ADDRESS',
        message: 'Address parameter is required',
      });
    }

    if (!isValidNetwork(network)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Network "${network}" is not supported`,
      });
    }

    if (!['auto', 'transfers', 'relations'].includes(source)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_SOURCE',
        message: 'Source must be one of: auto, transfers, relations',
      });
    }

    try {
      const result = await g2Service.analyze({
        network,
        address,
        source,
      });

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'ANALYSIS_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/intel/g2/cybercrime/summary
   * 
   * Quick summary of cybercrime signals
   */
  app.get('/cybercrime/summary', async (req, reply) => {
    const query = req.query as {
      network?: string;
      address?: string;
    };

    const network = query.network || 'ethereum';
    const address = query.address;

    if (!address) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_ADDRESS',
        message: 'Address parameter is required',
      });
    }

    if (!isValidNetwork(network)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Network "${network}" is not supported`,
      });
    }

    try {
      const result = await g2Service.analyze({
        network,
        address,
        source: 'auto',
      });

      return reply.send({
        ok: true,
        data: {
          hasSignals: result.signals.length > 0,
          maxSeverity: result.summary.maxSeverity,
          maxConfidence: result.summary.maxConfidence,
          signalCount: result.signals.length,
          types: Object.keys(result.summary.countsByType),
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'SUMMARY_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/intel/g2/cybercrime/batch
   * 
   * Batch analyze multiple addresses
   * 
   * Body: {
   *   addresses: [{ network: 'ethereum', address: '0x...' }, ...]
   * }
   */
  app.post('/cybercrime/batch', async (req, reply) => {
    const body = req.body as {
      addresses?: Array<{ network: string; address: string }>;
    };

    const addresses = body.addresses;

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_ADDRESSES',
        message: 'Body must contain addresses array',
      });
    }

    // Validate all addresses
    for (const addr of addresses) {
      if (!addr.network || !addr.address) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_ADDRESS',
          message: 'Each address must have network and address fields',
        });
      }

      if (!isValidNetwork(addr.network)) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_NETWORK',
          message: `Network "${addr.network}" is not supported`,
        });
      }
    }

    try {
      const results = await g2Service.analyzeBatch(addresses);

      // Convert Map to object
      const resultsObj: Record<string, any> = {};
      results.forEach((value, key) => {
        resultsObj[key] = value;
      });

      return reply.send({
        ok: true,
        data: {
          results: resultsObj,
          count: results.size,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'BATCH_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
};
