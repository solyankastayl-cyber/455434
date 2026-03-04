/**
 * U1.1 - Signal Drivers API Routes
 * 
 * Product-level API for user-facing signals
 * NO ML terminology in responses
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SignalDriversService } from '../services/signal_drivers.service.js';
import { DRIVER_META } from '../types/signal_driver.types.js';

export async function signalDriversRoutes(app: FastifyInstance): Promise<void> {
  const service = new SignalDriversService();

  /**
   * GET /api/v3/signals/market/:asset
   * 
   * Returns signal drivers A-F for a market asset
   */
  app.get<{
    Params: { asset: string };
    Querystring: { network?: string };
  }>('/market/:asset', async (request, reply) => {
    const { asset } = request.params;
    const assetUpper = asset.toUpperCase();
    
    // Auto-detect network from asset if not provided
    // BNB asset → bnb network, ETHEREUM/ETH asset → ethereum network
    let network = request.query.network;
    if (!network) {
      if (assetUpper === 'BNB' || assetUpper === 'BSC') {
        network = 'bnb';
      } else {
        network = 'ethereum';
      }
    }

    try {
      const result = await service.resolveForMarket(assetUpper, network);
      
      return {
        ok: true,
        data: result,
      };
    } catch (error: any) {
      console.error(`[Signals] Failed to resolve for ${asset}: ${error.message}`);
      
      return reply.code(500).send({
        ok: false,
        error: 'SIGNAL_RESOLUTION_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v3/signals/drivers
   * 
   * Returns driver metadata (for UI tooltips)
   */
  app.get('/drivers', async () => {
    return {
      ok: true,
      data: {
        drivers: Object.values(DRIVER_META),
        version: 'v3.0',
      },
    };
  });

  /**
   * GET /api/v3/signals/health
   * 
   * Health check for signals service
   */
  app.get('/health', async () => {
    return {
      ok: true,
      data: {
        service: 'signal-drivers',
        version: 'v3.0',
        status: 'operational',
      },
    };
  });

  console.log('[Signals] Routes registered: /api/v3/signals/*');
}

export default signalDriversRoutes;
