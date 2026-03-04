/**
 * Market Sources Settings Routes (P1.5.B)
 * 
 * CRUD API for managing market API sources from Settings UI.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  MarketApiSourceModel,
  createSource,
  updateSource,
  deleteSource,
  getSourceById,
  getAllSources,
  toSafeSourceDTO,
  MarketProvider,
  IMarketApiSource
} from '../storage/market_api_source.model.js';
import { marketSourceRegistry } from './market_source_registry.js';
import { marketSourcePool } from './market_source_pool.js';
import { seedMarketSources, resetToDefaults } from './seed_market_sources.js';

// ============================================
// Types
// ============================================

interface CreateSourceBody {
  provider: MarketProvider;
  label: string;
  apiKey?: string;
  apiSecret?: string;
  rpm?: number;
  rpd?: number;
  weight?: number;
  enabled?: boolean;
}

interface UpdateSourceBody {
  label?: string;
  apiKey?: string;
  apiSecret?: string;
  rpm?: number;
  rpd?: number;
  weight?: number;
  enabled?: boolean;
}

interface SourceIdParams {
  id: string;
}

// ============================================
// Routes
// ============================================

export async function marketSourcesRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // List Sources
  // ==========================================
  
  /**
   * GET /api/settings/market-sources
   * List all market API sources (with masked keys)
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const sources = await getAllSources();
    
    return {
      ok: true,
      sources: sources.map(s => toSafeSourceDTO(s)),
      stats: await marketSourceRegistry.getRegistryStats()
    };
  });
  
  // ==========================================
  // Create Source
  // ==========================================
  
  /**
   * POST /api/settings/market-sources
   * Create a new market API source
   */
  fastify.post<{
    Body: CreateSourceBody;
  }>('/', async (request, reply) => {
    const { provider, label, apiKey, apiSecret, rpm, rpd, weight, enabled } = request.body;
    
    // Validation
    if (!provider || !['coingecko', 'binance', 'coinmarketcap'].includes(provider)) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid provider. Must be: coingecko, binance, or coinmarketcap'
      });
    }
    
    if (!label || label.length < 2) {
      return reply.status(400).send({
        ok: false,
        error: 'Label is required (min 2 characters)'
      });
    }
    
    // CMC requires API key
    if (provider === 'coinmarketcap' && !apiKey) {
      return reply.status(400).send({
        ok: false,
        error: 'CoinMarketCap requires an API key'
      });
    }
    
    const source = await createSource({
      provider,
      label,
      apiKey: apiKey || undefined,
      apiSecret: apiSecret || undefined,
      limits: {
        rpm: Math.min(Math.max(rpm || 30, 1), 1000),
        rpd: rpd || undefined
      },
      weight: Math.min(Math.max(weight || 5, 1), 10),
      enabled: enabled !== false
    });
    
    // Invalidate cache
    marketSourceRegistry.invalidateCache(provider);
    
    return {
      ok: true,
      source: toSafeSourceDTO(source)
    };
  });
  
  // ==========================================
  // Update Source
  // ==========================================
  
  /**
   * PUT /api/settings/market-sources/:id
   * Update an existing source
   */
  fastify.put<{
    Params: SourceIdParams;
    Body: UpdateSourceBody;
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { label, apiKey, apiSecret, rpm, rpd, weight, enabled } = request.body;
    
    const existing = await getSourceById(id);
    if (!existing) {
      return reply.status(404).send({
        ok: false,
        error: 'Source not found'
      });
    }
    
    const updates: Partial<IMarketApiSource> = {};
    
    if (label !== undefined) updates.label = label;
    if (apiKey !== undefined) updates.apiKey = apiKey || undefined;
    if (apiSecret !== undefined) updates.apiSecret = apiSecret || undefined;
    if (rpm !== undefined) {
      updates.limits = { ...existing.limits, rpm: Math.min(Math.max(rpm, 1), 1000) };
    }
    if (rpd !== undefined) {
      updates.limits = { ...(updates.limits || existing.limits), rpd };
    }
    if (weight !== undefined) {
      updates.weight = Math.min(Math.max(weight, 1), 10);
    }
    if (enabled !== undefined) {
      updates.enabled = enabled;
    }
    
    const updated = await updateSource(id, updates);
    
    // Invalidate cache
    marketSourceRegistry.invalidateCache(existing.provider);
    
    return {
      ok: true,
      source: updated ? toSafeSourceDTO(updated) : null
    };
  });
  
  // ==========================================
  // Delete Source
  // ==========================================
  
  /**
   * DELETE /api/settings/market-sources/:id
   * Delete a source
   */
  fastify.delete<{
    Params: SourceIdParams;
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    
    const existing = await getSourceById(id);
    if (!existing) {
      return reply.status(404).send({
        ok: false,
        error: 'Source not found'
      });
    }
    
    await deleteSource(id);
    
    // Invalidate cache
    marketSourceRegistry.invalidateCache(existing.provider);
    
    return {
      ok: true,
      deleted: id
    };
  });
  
  // ==========================================
  // Toggle Enable/Disable
  // ==========================================
  
  /**
   * POST /api/settings/market-sources/:id/toggle
   * Quick toggle enabled state
   */
  fastify.post<{
    Params: SourceIdParams;
  }>('/:id/toggle', async (request, reply) => {
    const { id } = request.params;
    
    const existing = await getSourceById(id);
    if (!existing) {
      return reply.status(404).send({
        ok: false,
        error: 'Source not found'
      });
    }
    
    const updated = await updateSource(id, { enabled: !existing.enabled });
    
    // Invalidate cache
    marketSourceRegistry.invalidateCache(existing.provider);
    
    return {
      ok: true,
      enabled: updated?.enabled
    };
  });
  
  // ==========================================
  // Test Source
  // ==========================================
  
  /**
   * POST /api/settings/market-sources/:id/test
   * Test API key by making a lightweight request
   */
  fastify.post<{
    Params: SourceIdParams;
  }>('/:id/test', async (request, reply) => {
    const { id } = request.params;
    
    const source = await getSourceById(id);
    if (!source) {
      return reply.status(404).send({
        ok: false,
        error: 'Source not found'
      });
    }
    
    const startTime = Date.now();
    
    try {
      const result = await testSourceConnection(source);
      const latencyMs = Date.now() - startTime;
      
      return {
        ok: true,
        result: {
          success: result.success,
          latencyMs,
          message: result.message,
          data: result.data
        }
      };
      
    } catch (err: any) {
      return {
        ok: false,
        result: {
          success: false,
          latencyMs: Date.now() - startTime,
          error: err.message || String(err)
        }
      };
    }
  });
  
  // ==========================================
  // Seed Defaults
  // ==========================================
  
  /**
   * POST /api/settings/market-sources/seed
   * Seed default sources if empty
   */
  fastify.post('/seed', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await seedMarketSources();
    
    if (result.seeded) {
      marketSourceRegistry.invalidateCache();
    }
    
    return {
      ok: true,
      ...result
    };
  });
  
  /**
   * POST /api/settings/market-sources/reset
   * Reset to default sources (dangerous!)
   */
  fastify.post('/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    await resetToDefaults();
    marketSourceRegistry.invalidateCache();
    
    return {
      ok: true,
      message: 'Reset to defaults'
    };
  });
  
  // ==========================================
  // Pool Stats
  // ==========================================
  
  /**
   * GET /api/settings/market-sources/stats
   * Get pool statistics for all providers
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await Promise.all([
      marketSourcePool.getStats('coingecko'),
      marketSourcePool.getStats('binance'),
      marketSourcePool.getStats('coinmarketcap')
    ]);
    
    return {
      ok: true,
      stats: {
        coingecko: stats[0],
        binance: stats[1],
        coinmarketcap: stats[2]
      }
    };
  });
}

// ============================================
// Test Connection Helper
// ============================================

interface TestResult {
  success: boolean;
  message: string;
  data?: any;
}

async function testSourceConnection(source: any): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    switch (source.provider) {
      case 'coingecko': {
        const baseUrl = source.apiKey 
          ? 'https://pro-api.coingecko.com/api/v3'
          : 'https://api.coingecko.com/api/v3';
        
        const headers: Record<string, string> = {};
        if (source.apiKey) {
          headers['x-cg-pro-api-key'] = source.apiKey;
        }
        
        const response = await fetch(`${baseUrl}/ping`, {
          headers,
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return {
          success: true,
          message: data.gecko_says || 'Connected',
          data: { isPro: !!source.apiKey }
        };
      }
      
      case 'binance': {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        return {
          success: true,
          message: 'Connected to Binance',
          data: {}
        };
      }
      
      case 'coinmarketcap': {
        if (!source.apiKey) {
          return {
            success: false,
            message: 'API key required for CoinMarketCap'
          };
        }
        
        const response = await fetch(
          'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=1',
          {
            headers: { 'X-CMC_PRO_API_KEY': source.apiKey },
            signal: controller.signal
          }
        );
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return {
          success: true,
          message: 'Connected to CoinMarketCap',
          data: { credits: data.status?.credit_count }
        };
      }
      
      default:
        return {
          success: false,
          message: 'Unknown provider'
        };
    }
    
  } finally {
    clearTimeout(timeout);
  }
}
