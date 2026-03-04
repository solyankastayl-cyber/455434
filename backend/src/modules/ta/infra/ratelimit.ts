/**
 * Phase S2.2: Rate Limiter (Token Bucket)
 * For external API rate limiting
 */

import { getConfig } from './config.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private rps: number;
  private burstSize: number;
  private queueTimeoutMs: number;
  
  // Metrics
  private allowed = 0;
  private rejected = 0;
  private queued = 0;
  
  constructor(rps?: number, burstSize?: number, queueTimeoutMs?: number) {
    const config = getConfig();
    this.rps = rps ?? config.rateLimitRps;
    this.burstSize = burstSize ?? config.rateLimitBurstSize;
    this.queueTimeoutMs = queueTimeoutMs ?? config.rateLimitQueueTimeoutMs;
  }
  
  /**
   * Check if request is allowed (immediate)
   */
  tryAcquire(host: string = 'default'): boolean {
    const bucket = this.getOrCreateBucket(host);
    this.refillBucket(bucket);
    
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.allowed++;
      return true;
    }
    
    this.rejected++;
    return false;
  }
  
  /**
   * Acquire with queue (waits up to queueTimeoutMs)
   */
  async acquire(host: string = 'default'): Promise<boolean> {
    if (this.tryAcquire(host)) {
      return true;
    }
    
    // Try queuing
    this.queued++;
    const start = Date.now();
    
    while (Date.now() - start < this.queueTimeoutMs) {
      await this.sleep(10);
      if (this.tryAcquire(host)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get current tokens for a host
   */
  getTokens(host: string = 'default'): number {
    const bucket = this.buckets.get(host);
    if (!bucket) return this.burstSize;
    
    this.refillBucket(bucket);
    return bucket.tokens;
  }
  
  /**
   * Get rate limiter statistics
   */
  getStats(): {
    hosts: number;
    allowed: number;
    rejected: number;
    queued: number;
    rps: number;
    burstSize: number;
  } {
    return {
      hosts: this.buckets.size,
      allowed: this.allowed,
      rejected: this.rejected,
      queued: this.queued,
      rps: this.rps,
      burstSize: this.burstSize,
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats(): void {
    this.allowed = 0;
    this.rejected = 0;
    this.queued = 0;
  }
  
  private getOrCreateBucket(host: string): TokenBucket {
    let bucket = this.buckets.get(host);
    if (!bucket) {
      bucket = {
        tokens: this.burstSize,
        lastRefill: Date.now(),
      };
      this.buckets.set(host, bucket);
    }
    return bucket;
  }
  
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refill = elapsed * this.rps;
    
    bucket.tokens = Math.min(this.burstSize, bucket.tokens + refill);
    bucket.lastRefill = now;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let rateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RateLimiter();
  }
  return rateLimiter;
}
