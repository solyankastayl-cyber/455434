/**
 * Market Request Executor (P1.5.B)
 * 
 * Unified HTTP executor with failover, retry, and rate limit handling.
 * Automatically switches sources on 429 errors.
 */

import { IMarketApiSourceDocument, MarketProvider } from '../storage/market_api_source.model.js';
import { marketSourcePool } from './market_source_pool.js';
import { marketSourceRegistry } from './market_source_registry.js';

// ============================================
// Types
// ============================================

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  timeout?: number;
  body?: any;
}

export interface ExecuteResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  sourceId: string;
  provider: MarketProvider;
  latencyMs: number;
  attempts: number;
}

export type AdapterRequestFn<T> = (source: IMarketApiSourceDocument) => Promise<T>;

// ============================================
// Executor
// ============================================

export class MarketRequestExecutor {
  private defaultTimeout = 12000; // 12 seconds
  private maxRetries = 2;
  
  /**
   * Execute request with automatic source selection and failover
   */
  async execute<T>(
    provider: MarketProvider,
    requestFn: AdapterRequestFn<T>,
    options?: { maxAttempts?: number }
  ): Promise<ExecuteResult<T>> {
    const maxAttempts = options?.maxAttempts || 3;
    const startTime = Date.now();
    let attempts = 0;
    let lastError = '';
    let lastSourceId = '';
    
    // Get all active sources for provider
    const sources = await marketSourceRegistry.getActiveSources(provider);
    
    if (sources.length === 0) {
      return {
        ok: false,
        error: `No active sources for ${provider}`,
        sourceId: '',
        provider,
        latencyMs: Date.now() - startTime,
        attempts: 0
      };
    }
    
    // Try each source up to maxAttempts total
    const triedSourceIds = new Set<string>();
    
    while (attempts < Math.min(maxAttempts, sources.length)) {
      attempts++;
      
      try {
        // Pick a source
        const { source } = await marketSourcePool.pick(provider);
        lastSourceId = source._id.toString();
        
        // Skip if already tried
        if (triedSourceIds.has(lastSourceId)) {
          continue;
        }
        triedSourceIds.add(lastSourceId);
        
        // Execute request
        const requestStart = Date.now();
        const data = await requestFn(source);
        const latencyMs = Date.now() - requestStart;
        
        // Report success
        await marketSourcePool.reportSuccess(lastSourceId, latencyMs);
        
        return {
          ok: true,
          data,
          sourceId: lastSourceId,
          provider,
          latencyMs: Date.now() - startTime,
          attempts
        };
        
      } catch (err: any) {
        lastError = err.message || String(err);
        
        // Check if rate limit
        if (this.isRateLimitError(err)) {
          if (lastSourceId) {
            await marketSourcePool.reportRateLimit(lastSourceId);
          }
          // Continue to next source
          continue;
        }
        
        // Check if retryable error
        if (this.isRetryableError(err) && attempts < maxAttempts) {
          if (lastSourceId) {
            await marketSourcePool.reportError(lastSourceId, lastError);
          }
          continue;
        }
        
        // Non-retryable error
        if (lastSourceId) {
          await marketSourcePool.reportError(lastSourceId, lastError);
        }
        break;
      }
    }
    
    return {
      ok: false,
      error: lastError || 'All sources exhausted',
      sourceId: lastSourceId,
      provider,
      latencyMs: Date.now() - startTime,
      attempts
    };
  }
  
  /**
   * Simple HTTP fetch with timeout
   */
  async fetch(url: string, options: {
    headers?: Record<string, string>;
    timeout?: number;
  } = {}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeout || this.defaultTimeout
    );
    
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: controller.signal
      });
      
      if (!response.ok) {
        const error: any = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      
      return await response.json();
      
    } finally {
      clearTimeout(timeout);
    }
  }
  
  // ============================================
  // Error Classification
  // ============================================
  
  private isRateLimitError(err: any): boolean {
    return err.status === 429 || 
           err.message?.includes('429') ||
           err.message?.includes('rate limit') ||
           err.message?.includes('too many requests');
  }
  
  private isRetryableError(err: any): boolean {
    // 5xx errors
    if (err.status >= 500 && err.status < 600) return true;
    
    // Timeout
    if (err.name === 'AbortError') return true;
    if (err.message?.includes('timeout')) return true;
    
    // Network errors
    if (err.code === 'ECONNRESET') return true;
    if (err.code === 'ENOTFOUND') return true;
    
    return false;
  }
}

// Singleton
export const marketRequestExecutor = new MarketRequestExecutor();
