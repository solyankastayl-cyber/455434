/**
 * ASSETS API ROUTES
 * =================
 * 
 * /api/v10/assets/* — Asset universe and truth resolution
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getAllAssets,
  getTrackedAssets,
  getAsset,
  getAssetsByVenue,
  getActiveVenues,
  buildAssetUniverse,
} from '../services/assets.registry.js';
import {
  resolveAssetState,
  resolveMultipleAssets,
  getVenueMLFeatures,
} from '../services/truth.resolver.js';
import { checkBinanceHealth } from '../adapters/binance.adapter.js';
import { checkBybitHealth } from '../adapters/bybit.adapter.js';
import { checkCoinbaseHealth } from '../adapters/coinbase.adapter.js';
import type { VenueId } from '../contracts/assets.types.js';

export async function registerAssetsRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // UNIVERSE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/assets/universe
   * Returns the full asset universe
   */
  app.get('/api/v10/assets/universe', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const universe = buildAssetUniverse();
    return reply.send({
      ok: true,
      ...universe,
    });
  });
  
  /**
   * GET /api/v10/assets/tracked
   * Returns only tracked assets (for selectors)
   */
  app.get('/api/v10/assets/tracked', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const assets = getTrackedAssets();
    return reply.send({
      ok: true,
      count: assets.length,
      assets: assets.map(a => ({
        assetId: a.assetId,
        symbol: a.symbol,
        name: a.name,
        liquidityProfile: a.liquidityProfile,
        venues: Object.keys(a.venues).filter(v => a.venues[v as VenueId]?.status === 'ACTIVE'),
      })),
    });
  });
  
  /**
   * GET /api/v10/assets/universe/:assetId
   * Returns details for a specific asset
   */
  app.get('/api/v10/assets/universe/:assetId', async (
    request: FastifyRequest<{ Params: { assetId: string } }>,
    reply: FastifyReply
  ) => {
    const asset = getAsset(request.params.assetId);
    
    if (!asset) {
      return reply.status(404).send({
        ok: false,
        error: 'ASSET_NOT_FOUND',
        message: `Unknown asset: ${request.params.assetId}`,
      });
    }
    
    const activeVenues = getActiveVenues(asset.assetId);
    
    return reply.send({
      ok: true,
      asset,
      activeVenues,
    });
  });
  
  /**
   * GET /api/v10/assets/by-venue/:venue
   * Returns assets available on a specific venue
   */
  app.get('/api/v10/assets/by-venue/:venue', async (
    request: FastifyRequest<{ Params: { venue: string } }>,
    reply: FastifyReply
  ) => {
    const venue = request.params.venue.toUpperCase() as VenueId;
    const assets = getAssetsByVenue(venue);
    
    return reply.send({
      ok: true,
      venue,
      count: assets.length,
      assets: assets.map(a => a.assetId),
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TRUTH RESOLUTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/assets/state/:assetId
   * Returns resolved (truth) state for an asset
   */
  app.get('/api/v10/assets/state/:assetId', async (
    request: FastifyRequest<{ Params: { assetId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const state = await resolveAssetState(request.params.assetId);
      
      if (!state) {
        return reply.status(404).send({
          ok: false,
          error: 'RESOLUTION_FAILED',
          message: `Could not resolve state for: ${request.params.assetId}`,
        });
      }
      
      return reply.send({
        ok: true,
        state,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'RESOLUTION_ERROR',
        message,
      });
    }
  });
  
  /**
   * POST /api/v10/assets/state/batch
   * Resolves state for multiple assets
   */
  app.post('/api/v10/assets/state/batch', async (
    request: FastifyRequest<{ Body: { assets: string[] } }>,
    reply: FastifyReply
  ) => {
    try {
      const { assets } = request.body;
      
      if (!assets || !Array.isArray(assets)) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'assets array is required',
        });
      }
      
      const results = await resolveMultipleAssets(assets);
      
      return reply.send({
        ok: true,
        count: results.size,
        states: Object.fromEntries(results),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'BATCH_RESOLUTION_ERROR',
        message,
      });
    }
  });
  
  /**
   * GET /api/v10/assets/ml-features/:assetId
   * Returns ML features derived from multi-venue data
   */
  app.get('/api/v10/assets/ml-features/:assetId', async (
    request: FastifyRequest<{ Params: { assetId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const features = await getVenueMLFeatures(request.params.assetId);
      
      if (!features) {
        return reply.status(404).send({
          ok: false,
          error: 'FEATURES_UNAVAILABLE',
          message: `Could not compute ML features for: ${request.params.assetId}`,
        });
      }
      
      return reply.send({
        ok: true,
        assetId: request.params.assetId,
        features,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'FEATURES_ERROR',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // VENUE HEALTH
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/v10/assets/venues/health
   * Returns health status of all venues
   */
  app.get('/api/v10/assets/venues/health', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const [binance, bybit, coinbase] = await Promise.all([
        checkBinanceHealth(),
        checkBybitHealth(),
        checkCoinbaseHealth(),
      ]);
      
      return reply.send({
        ok: true,
        venues: {
          BINANCE: {
            status: binance.ok ? 'HEALTHY' : 'DOWN',
            latencyMs: binance.latencyMs,
          },
          BYBIT: {
            status: bybit.ok ? 'HEALTHY' : 'DOWN',
            latencyMs: bybit.latencyMs,
          },
          COINBASE: {
            status: coinbase.ok ? 'HEALTHY' : 'DOWN',
            latencyMs: coinbase.latencyMs,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_CHECK_ERROR',
        message,
      });
    }
  });
  
  app.log.info('[Assets] Routes registered at /api/v10/assets');
}

console.log('[Assets] Routes module loaded');
