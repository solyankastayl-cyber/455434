// In-memory cache for Twitter Parser responses

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TwitterCache {
  private store = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) + '%' : '0%',
    };
  }
}
