/**
 * S10 — Base Exchange Provider
 * 
 * Abstract base class with common functionality:
 * - Rate limiting
 * - Caching
 * - Health tracking
 * - Error handling
 */

import {
  ExchangeProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderStatus,
  InternalSymbol,
  SymbolInfo,
  MarketSnapshot,
  OrderBookSnapshot,
  Trade,
  OpenInterestSnapshot,
  FundingSnapshot,
  LiquidationEvent,
  Candle,
} from './provider.types.js';

// ═══════════════════════════════════════════════════════════════
// RATE LIMITER
// ═══════════════════════════════════════════════════════════════

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;
  
  constructor(config: RateLimitConfig) {
    this.config = config;
  }
  
  async acquire(): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Clean old requests
    this.requests = this.requests.filter(t => t > windowStart);
    
    if (this.requests.length >= this.config.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }
  
  getRemaining(): number {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    this.requests = this.requests.filter(t => t > windowStart);
    return Math.max(0, this.config.maxRequests - this.requests.length);
  }
  
  getResetAt(): number {
    if (this.requests.length === 0) return Date.now();
    return this.requests[0] + this.config.windowMs;
  }
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return entry.data as T;
  }
  
  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }
  
  getHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }
  
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// BASE PROVIDER
// ═══════════════════════════════════════════════════════════════

export abstract class BaseExchangeProvider implements ExchangeProvider {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;
  
  protected rateLimiter: RateLimiter;
  protected cache: MemoryCache;
  protected health: ProviderHealth;
  protected wsConnections: Map<string, any> = new Map();
  protected callbacks: Map<string, Set<Function>> = new Map();
  
  // Error tracking for circuit breaker
  protected consecutiveErrors = 0;
  protected maxConsecutiveErrors = 5;
  
  // Cache TTLs (ms)
  protected cacheTTL = {
    ticker: 2000,
    orderBook: 1000,
    trades: 5000,
    openInterest: 30000,
    funding: 60000,
    candles: 60000,
    symbols: 300000,
  };
  
  constructor(rateLimitConfig: RateLimitConfig = { maxRequests: 100, windowMs: 60000 }) {
    this.rateLimiter = new RateLimiter(rateLimitConfig);
    this.cache = new MemoryCache();
    this.health = {
      status: 'INITIALIZING',
      lastSuccessfulFetch: 0,
      lastError: null,
      errorCount: 0,
      rateLimitRemaining: rateLimitConfig.maxRequests,
      rateLimitResetAt: Date.now(),
      wsConnected: false,
      cacheHitRate: 0,
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // Health & Status
  // ─────────────────────────────────────────────────────────────
  
  getHealth(): ProviderHealth {
    return {
      ...this.health,
      rateLimitRemaining: this.rateLimiter.getRemaining(),
      rateLimitResetAt: this.rateLimiter.getResetAt(),
      cacheHitRate: this.cache.getHitRate(),
    };
  }
  
  protected updateHealthSuccess(): void {
    this.health.lastSuccessfulFetch = Date.now();
    this.consecutiveErrors = 0;
    
    if (this.health.status === 'DEGRADED' || this.health.status === 'INITIALIZING') {
      this.health.status = 'STABLE';
    }
  }
  
  protected updateHealthError(error: string): void {
    this.health.lastError = error;
    this.health.errorCount++;
    this.consecutiveErrors++;
    
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.health.status = 'DOWN';
    } else if (this.consecutiveErrors >= 3) {
      this.health.status = 'DEGRADED';
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Rate-limited fetch wrapper
  // ─────────────────────────────────────────────────────────────
  
  protected async rateLimitedFetch<T>(
    key: string,
    ttl: number,
    fetcher: () => Promise<T>
  ): Promise<T | null> {
    // Check cache first
    const cached = this.cache.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    // Check rate limit
    const canProceed = await this.rateLimiter.acquire();
    if (!canProceed) {
      console.warn(`[${this.name}] Rate limit exceeded for ${key}`);
      this.health.status = 'DEGRADED';
      return null;
    }
    
    try {
      const result = await fetcher();
      this.cache.set(key, result, ttl);
      this.updateHealthSuccess();
      return result;
    } catch (error: any) {
      this.updateHealthError(error.message || 'Unknown error');
      
      // Exponential backoff
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, this.consecutiveErrors));
      console.error(`[${this.name}] Error fetching ${key}: ${error.message}. Backoff: ${backoffMs}ms`);
      
      return null;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Symbol normalization (to be implemented by each provider)
  // ─────────────────────────────────────────────────────────────
  
  abstract normalizeSymbol(internal: InternalSymbol): string;
  abstract denormalizeSymbol(provider: string): InternalSymbol;
  abstract getSymbolInfo(symbol: InternalSymbol): Promise<SymbolInfo | null>;
  abstract getAvailableSymbols(): Promise<InternalSymbol[]>;
  
  // ─────────────────────────────────────────────────────────────
  // Market data (to be implemented by each provider)
  // ─────────────────────────────────────────────────────────────
  
  abstract getTicker(symbol: InternalSymbol): Promise<MarketSnapshot | null>;
  abstract getOrderBook(symbol: InternalSymbol, depth?: number): Promise<OrderBookSnapshot | null>;
  abstract getTrades(symbol: InternalSymbol, since?: number, limit?: number): Promise<Trade[]>;
  abstract getOpenInterest(symbol: InternalSymbol): Promise<OpenInterestSnapshot | null>;
  abstract getFunding(symbol: InternalSymbol): Promise<FundingSnapshot | null>;
  abstract getLiquidations(symbol: InternalSymbol, since?: number): Promise<LiquidationEvent[]>;
  abstract getCandles(symbol: InternalSymbol, timeframe: string, since?: number, limit?: number): Promise<Candle[]>;
  
  // ─────────────────────────────────────────────────────────────
  // WebSocket (base implementation)
  // ─────────────────────────────────────────────────────────────
  
  subscribeToTicker(symbol: InternalSymbol, callback: (data: MarketSnapshot) => void): void {
    this.addCallback(`ticker:${symbol}`, callback);
  }
  
  subscribeToOrderBook(symbol: InternalSymbol, callback: (data: OrderBookSnapshot) => void): void {
    this.addCallback(`orderbook:${symbol}`, callback);
  }
  
  subscribeToTrades(symbol: InternalSymbol, callback: (data: Trade) => void): void {
    this.addCallback(`trades:${symbol}`, callback);
  }
  
  subscribeToLiquidations(symbol: InternalSymbol, callback: (data: LiquidationEvent) => void): void {
    this.addCallback(`liquidations:${symbol}`, callback);
  }
  
  unsubscribe(symbol: InternalSymbol, channel: string): void {
    const key = `${channel}:${symbol}`;
    this.callbacks.delete(key);
  }
  
  protected addCallback(key: string, callback: Function): void {
    if (!this.callbacks.has(key)) {
      this.callbacks.set(key, new Set());
    }
    this.callbacks.get(key)!.add(callback);
  }
  
  protected emitCallback(key: string, data: any): void {
    const cbs = this.callbacks.get(key);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[${this.name}] Callback error for ${key}:`, e);
        }
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────
  
  async connect(): Promise<void> {
    this.health.status = 'STABLE';
    console.log(`[${this.name}] Provider connected`);
  }
  
  async disconnect(): Promise<void> {
    this.cache.clear();
    this.callbacks.clear();
    this.health.status = 'DOWN';
    console.log(`[${this.name}] Provider disconnected`);
  }
}

console.log('[S10.P0] Base Exchange Provider loaded');
