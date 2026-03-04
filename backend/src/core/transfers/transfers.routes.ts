/**
 * Transfers Routes
 * API endpoints for normalized transfers (READ ONLY)
 * 
 * Base path: /api/transfers
 * 
 * Endpoints:
 * - GET /                     - Query transfers
 * - GET /stats                - Get transfer statistics
 * - GET /address/:address     - Get transfers for address
 * - GET /asset/:asset         - Get transfers for asset
 * - GET /corridor/:from/:to   - Get transfers between two addresses
 * - GET /netflow/:address     - Get netflow for address
 * - GET /counterparties/:addr - Get counterparties for address
 * - GET /:id                  - Get transfer by ID
 */
import type { FastifyInstance } from 'fastify';
import { transfersService, formatTransfer } from './transfers.service.js';
import {
  type QueryByAddressInput,
  type QueryByAssetInput,
} from './transfers.schema.js';

/**
 * Transfers Routes
 */
export async function transfersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /stats - Get transfer statistics
   */
  app.get('/stats', async () => {
    const stats = await transfersService.getStats();
    return {
      ok: true,
      data: stats,
    };
  });

  /**
   * GET /address/:address - Get transfers for address
   */
  app.get<{ Params: { address: string }; Querystring: Omit<QueryByAddressInput, 'address'> }>(
    '/address/:address',
    async (request) => {
      const { address } = request.params;
      const query = request.query;

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid address format',
        };
      }

      const result = await transfersService.queryByAddress(address, {
        direction: query.direction as 'in' | 'out' | 'both',
        assetAddress: query.assetAddress,
        assetType: query.assetType,
        chain: query.chain,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      });

      return {
        ok: true,
        data: {
          transfers: result.transfers.map(formatTransfer),
          pagination: {
            total: result.total,
            limit: query.limit || 100,
            offset: query.offset || 0,
          },
        },
      };
    }
  );

  /**
   * GET /asset/:asset - Get transfers for asset
   */
  app.get<{ Params: { asset: string }; Querystring: Omit<QueryByAssetInput, 'asset'> }>(
    '/asset/:asset',
    async (request) => {
      const { asset } = request.params;
      const query = request.query;

      // Validate asset format
      if (!/^0x[a-fA-F0-9]{40}$/.test(asset)) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid asset address format',
        };
      }

      const result = await transfersService.queryByAsset(asset, {
        from: query.from,
        to: query.to,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        limit: query.limit,
        offset: query.offset,
      });

      return {
        ok: true,
        data: {
          transfers: result.transfers.map(formatTransfer),
          pagination: {
            total: result.total,
            limit: query.limit || 100,
            offset: query.offset || 0,
          },
        },
      };
    }
  );

  /**
   * GET /corridor/:from/:to - Get transfers between two addresses
   */
  app.get<{ Params: { from: string; to: string }; Querystring: Partial<{ assetAddress: string; since: string; until: string; limit: number }> }>(
    '/corridor/:from/:to',
    async (request) => {
      const { from, to } = request.params;
      const query = request.query;

      // Validate addresses
      if (!/^0x[a-fA-F0-9]{40}$/.test(from) || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid address format',
        };
      }

      const result = await transfersService.getCorridor(from, to, {
        assetAddress: query.assetAddress,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        limit: query.limit,
      });

      return {
        ok: true,
        data: {
          transfers: result.transfers.map(formatTransfer),
          summary: result.summary,
        },
      };
    }
  );

  /**
   * GET /netflow/:address - Get netflow for address
   */
  app.get<{ Params: { address: string }; Querystring: Partial<{ assetAddress: string; since: string; until: string }> }>(
    '/netflow/:address',
    async (request) => {
      const { address } = request.params;
      const query = request.query;

      // Validate address
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid address format',
        };
      }

      const netflow = await transfersService.getNetflow(address, {
        assetAddress: query.assetAddress,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
      });

      return {
        ok: true,
        data: netflow,
      };
    }
  );

  /**
   * GET /counterparties/:address - Get counterparties for address
   */
  app.get<{ Params: { address: string }; Querystring: Partial<{ direction: string; limit: number }> }>(
    '/counterparties/:address',
    async (request) => {
      const { address } = request.params;
      const query = request.query;

      // Validate address
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid address format',
        };
      }

      const counterparties = await transfersService.getCounterparties(address, {
        direction: query.direction as 'in' | 'out' | 'both',
        limit: query.limit,
      });

      return {
        ok: true,
        data: counterparties,
      };
    }
  );

  /**
   * GET /:id - Get transfer by ID
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const transfer = await transfersService.getById(id);

    if (!transfer) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Transfer not found',
      });
    }

    return {
      ok: true,
      data: formatTransfer(transfer),
    };
  });

  app.log.info('Transfers routes registered');
}

// Export as 'routes' for consistency
export { transfersRoutes as routes };
