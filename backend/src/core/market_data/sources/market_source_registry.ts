/**
 * Market Source Registry (P1.5.B)
 * 
 * Caches and provides active sources for each provider.
 * Auto-invalidates cache on updates.
 */

import {
  MarketApiSourceModel,
  IMarketApiSourceDocument,
  MarketProvider,
  getMinuteKey
} from '../storage/market_api_source.model.js';

// ============================================
// Cache Configuration
// ============================================

const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  sources: IMarketApiSourceDocument[];
  loadedAt: number;
}

// In-memory cache
const sourceCache = new Map<MarketProvider, CacheEntry>();

// ============================================
// Registry Class
// ============================================

export class MarketSourceRegistry {
  
  /**
   * Get all active (enabled) sources for a provider
   */
  async getActiveSources(provider: MarketProvider): Promise<IMarketApiSourceDocument[]> {
    // Check cache
    const cached = sourceCache.get(provider);
    if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
      return cached.sources;
    }
    
    // Load from DB
    const sources = await MarketApiSourceModel.find({
      provider,
      enabled: true
    }).sort({ weight: -1 });
    
    // Cache
    sourceCache.set(provider, {
      sources,
      loadedAt: Date.now()
    });
    
    return sources;
  }
  
  /**
   * Get all sources for a provider (including disabled)
   */
  async getAllSources(provider: MarketProvider): Promise<IMarketApiSourceDocument[]> {
    return MarketApiSourceModel.find({ provider }).sort({ weight: -1 });
  }
  
  /**
   * Get source by ID
   */
  async getSourceById(id: string): Promise<IMarketApiSourceDocument | null> {
    return MarketApiSourceModel.findById(id);
  }
  
  /**
   * Invalidate cache for a provider
   */
  invalidateCache(provider?: MarketProvider): void {
    if (provider) {
      sourceCache.delete(provider);
    } else {
      sourceCache.clear();
    }
  }
  
  /**
   * Check if any source is available for provider
   */
  async hasActiveSource(provider: MarketProvider): Promise<boolean> {
    const sources = await this.getActiveSources(provider);
    return sources.length > 0;
  }
  
  /**
   * Get total available RPM across all sources for provider
   */
  async getTotalRpm(provider: MarketProvider): Promise<number> {
    const sources = await this.getActiveSources(provider);
    return sources.reduce((sum, s) => sum + (s.limits.rpm || 0), 0);
  }
  
  /**
   * Get stats summary for all providers
   */
  async getRegistryStats(): Promise<{
    providers: Record<MarketProvider, {
      total: number;
      enabled: number;
      totalRpm: number;
      rateLimitHits: number;
    }>;
  }> {
    const allSources = await MarketApiSourceModel.find();
    
    const providers: Record<string, any> = {
      coingecko: { total: 0, enabled: 0, totalRpm: 0, rateLimitHits: 0 },
      binance: { total: 0, enabled: 0, totalRpm: 0, rateLimitHits: 0 },
      coinmarketcap: { total: 0, enabled: 0, totalRpm: 0, rateLimitHits: 0 }
    };
    
    for (const source of allSources) {
      const p = providers[source.provider];
      if (p) {
        p.total++;
        if (source.enabled) {
          p.enabled++;
          p.totalRpm += source.limits.rpm || 0;
        }
        p.rateLimitHits += source.stats.rateLimitHits || 0;
      }
    }
    
    return { providers: providers as any };
  }
}

// Singleton instance
export const marketSourceRegistry = new MarketSourceRegistry();
