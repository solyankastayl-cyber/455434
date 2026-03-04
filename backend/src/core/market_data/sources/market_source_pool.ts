/**
 * Market Source Pool (P1.5.B)
 * 
 * Rate-limit aware source selection with weighted round-robin.
 * Automatically handles failover between sources.
 */

import {
  MarketApiSourceModel,
  IMarketApiSourceDocument,
  MarketProvider,
  MarketCapability,
  getMinuteKey
} from '../storage/market_api_source.model.js';
import { marketSourceRegistry } from './market_source_registry.js';

// ============================================
// Types
// ============================================

export interface PickResult {
  source: IMarketApiSourceDocument;
  attemptsUsed: number;
}

export interface SourcePoolStats {
  provider: MarketProvider;
  activeSources: number;
  totalRpm: number;
  usedRpm: number;
  exhaustedSources: number;
}

// ============================================
// Custom Errors
// ============================================

export class MarketSourceUnavailableError extends Error {
  public provider: MarketProvider;
  public capability?: string;
  
  constructor(provider: MarketProvider, capability?: string) {
    const msg = capability
      ? `No active ${provider} sources with capability: ${capability}`
      : `No active sources for provider: ${provider}`;
    super(msg);
    this.name = 'MarketSourceUnavailableError';
    this.provider = provider;
    this.capability = capability;
  }
}

export class AllSourcesExhaustedError extends Error {
  public provider: MarketProvider;
  public sourcesChecked: number;
  
  constructor(provider: MarketProvider, sourcesChecked: number) {
    super(`All ${provider} sources exhausted (${sourcesChecked} checked)`);
    this.name = 'AllSourcesExhaustedError';
    this.provider = provider;
    this.sourcesChecked = sourcesChecked;
  }
}

// ============================================
// Source Pool
// ============================================

export class MarketSourcePool {
  
  /**
   * Pick best available source for provider
   */
  async pick(provider: MarketProvider): Promise<PickResult> {
    const sources = await marketSourceRegistry.getActiveSources(provider);
    
    if (sources.length === 0) {
      throw new Error(`No active sources for provider: ${provider}`);
    }
    
    const currentWindow = getMinuteKey();
    let attemptsUsed = 0;
    
    // Filter eligible sources (not exhausted in current window)
    const eligible: IMarketApiSourceDocument[] = [];
    
    for (const source of sources) {
      attemptsUsed++;
      
      // Reset minute counter if window changed
      if (source.stats.windowKey !== currentWindow) {
        await this.resetWindow(source._id.toString(), currentWindow);
        source.stats.windowKey = currentWindow;
        source.stats.requestsMinute = 0;
      }
      
      // Check if within RPM limit (0 = unlimited)
      if (source.limits.rpm === 0 || source.stats.requestsMinute < source.limits.rpm) {
        eligible.push(source);
      }
    }
    
    if (eligible.length === 0) {
      throw new Error(`All ${provider} sources exhausted (${sources.length} checked)`);
    }
    
    // Weighted selection
    const selected = this.weightedPick(eligible);
    
    // Increment request counter
    await this.incrementRequests(selected._id.toString());
    
    return { source: selected, attemptsUsed };
  }
  
  /**
   * Report successful request
   */
  async reportSuccess(sourceId: string, latencyMs: number): Promise<void> {
    // Get current avgLatencyMs for proper calculation
    const source = await MarketApiSourceModel.findById(sourceId);
    const currentAvg = source?.stats?.avgLatencyMs || latencyMs;
    const newAvg = Math.round((currentAvg * 0.9) + (latencyMs * 0.1)); // Rolling average
    
    await MarketApiSourceModel.updateOne(
      { _id: sourceId },
      {
        $set: { 
          'stats.lastUsedAt': Date.now(),
          'stats.avgLatencyMs': newAvg,
          updatedAt: Date.now()
        }
      }
    );
  }
  
  /**
   * Report rate limit hit (429)
   */
  async reportRateLimit(sourceId: string): Promise<void> {
    await MarketApiSourceModel.updateOne(
      { _id: sourceId },
      {
        $set: {
          'stats.lastErrorAt': Date.now(),
          'stats.lastError': 'Rate limit exceeded (429)',
          updatedAt: Date.now()
        },
        $inc: { 'stats.rateLimitHits': 1 }
      }
    );
    
    // Invalidate cache to re-evaluate sources
    marketSourceRegistry.invalidateCache();
  }
  
  /**
   * Report error
   */
  async reportError(sourceId: string, error: string): Promise<void> {
    await MarketApiSourceModel.updateOne(
      { _id: sourceId },
      {
        $set: {
          'stats.lastErrorAt': Date.now(),
          'stats.lastError': error.slice(0, 200),
          updatedAt: Date.now()
        },
        $inc: { 'stats.errorCount': 1 }
      }
    );
  }
  
  /**
   * Get pool stats for provider
   */
  async getStats(provider: MarketProvider): Promise<SourcePoolStats> {
    const sources = await marketSourceRegistry.getActiveSources(provider);
    const currentWindow = getMinuteKey();
    
    let totalRpm = 0;
    let usedRpm = 0;
    let exhaustedSources = 0;
    
    for (const source of sources) {
      totalRpm += source.limits.rpm || 0;
      
      if (source.stats.windowKey === currentWindow) {
        usedRpm += source.stats.requestsMinute;
        
        if (source.limits.rpm > 0 && source.stats.requestsMinute >= source.limits.rpm) {
          exhaustedSources++;
        }
      }
    }
    
    return {
      provider,
      activeSources: sources.length,
      totalRpm,
      usedRpm,
      exhaustedSources
    };
  }
  
  // ============================================
  // Private Methods
  // ============================================
  
  /**
   * Reset minute window for source
   */
  private async resetWindow(sourceId: string, windowKey: number): Promise<void> {
    await MarketApiSourceModel.updateOne(
      { _id: sourceId },
      {
        $set: {
          'stats.windowKey': windowKey,
          'stats.requestsMinute': 0
        }
      }
    );
  }
  
  /**
   * Increment request counter
   */
  private async incrementRequests(sourceId: string): Promise<void> {
    await MarketApiSourceModel.updateOne(
      { _id: sourceId },
      {
        $inc: { 'stats.requestsMinute': 1 },
        $set: { 'stats.lastUsedAt': Date.now() }
      }
    );
  }
  
  /**
   * Weighted random selection
   */
  private weightedPick(sources: IMarketApiSourceDocument[]): IMarketApiSourceDocument {
    if (sources.length === 1) return sources[0];
    
    // Calculate total weight
    const totalWeight = sources.reduce((sum, s) => sum + Math.max(1, s.weight), 0);
    
    // Random selection
    let r = Math.random() * totalWeight;
    
    for (const source of sources) {
      r -= Math.max(1, source.weight);
      if (r <= 0) return source;
    }
    
    return sources[sources.length - 1];
  }
}

// Singleton instance
export const marketSourcePool = new MarketSourcePool();
