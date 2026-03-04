/**
 * G3 AML/KYT API Routes
 * 
 * Endpoints for AML compliance and KYT risk assessment
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { G3AmlService } from './g3_aml.service.js';
import { G3BehavioralService } from './behavioral/behavioral.service.js';
import { isValidNetwork } from '../../../common/network.types.js';

export const g3Routes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const g3Service = new G3AmlService(db);
  const behavioralService = new G3BehavioralService(db);

  /**
   * GET /api/intel/g3/aml/check
   * 
   * Perform AML/KYT compliance check for an address
   * 
   * Query params:
   * - network: ethereum | arbitrum | optimism | base | polygon | bnb | zksync | scroll
   * - address: ethereum address (required)
   * - window: 7d | 30d (default: 30d)
   */
  app.get('/aml/check', async (req, reply) => {
    const query = req.query as {
      network?: string;
      address?: string;
      window?: string;
    };

    const network = query.network || 'ethereum';
    const address = query.address;
    const window = query.window === '7d' ? '7d' : '30d';

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

    try {
      const result = await g3Service.check({
        network,
        address,
        window,
      });

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'AML_CHECK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/intel/g3/aml/summary
   * 
   * Quick AML summary for an address
   */
  app.get('/aml/summary', async (req, reply) => {
    const query = req.query as {
      network?: string;
      address?: string;
      window?: string;
    };

    const network = query.network || 'ethereum';
    const address = query.address;
    const window = query.window === '7d' ? '7d' : '30d';

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
      const result = await g3Service.check({
        network,
        address,
        window,
      });

      return reply.send({
        ok: true,
        data: {
          verdict: result.verdict,
          riskScore: result.riskScore,
          isSanctioned: result.sanctions.isSanctioned,
          flagCount: result.flags.length,
          flags: result.flags,
          topRisks: result.exposure.topCounterparties
            .filter((c) => c.bucket === 'MIXER' || c.bucket === 'SANCTIONED' || c.bucket === 'HIGH_RISK')
            .slice(0, 5),
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
   * POST /api/intel/g3/aml/batch
   * 
   * Batch AML check for multiple addresses
   * 
   * Body: {
   *   addresses: [{ network: 'ethereum', address: '0x...' }, ...],
   *   window: '7d' | '30d'
   * }
   */
  app.post('/aml/batch', async (req, reply) => {
    const body = req.body as {
      addresses?: Array<{ network: string; address: string }>;
      window?: string;
    };

    const addresses = body.addresses;
    const window = body.window === '7d' ? '7d' : '30d';

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
      const results = await g3Service.checkBatch(addresses, window);

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

  /**
   * GET /api/intel/g3/behavioral
   * 
   * Behavioral AML pattern detection
   */
  app.get('/behavioral', async (req, reply) => {
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
      const result = await behavioralService.analyze({ network, address });

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'BEHAVIORAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
};
