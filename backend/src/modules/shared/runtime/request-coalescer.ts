/**
 * REQUEST COALESCER
 * =================
 * 
 * P3: Smart Caching Layer - Block 3
 * Anti-stampede pattern: coalesce multiple concurrent requests into one.
 * 
 * If 10 users request the same data simultaneously:
 * - Only 1 actual computation happens
 * - All 10 users wait for the same promise
 */

export class RequestCoalescer {
  private inflight = new Map<string, Promise<any>>();

  /**
   * Run a function with coalescing
   * If same key is already running, return existing promise
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const p = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  /**
   * Check if a request is in flight
   */
  isInFlight(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Get number of in-flight requests
   */
  size(): number {
    return this.inflight.size;
  }

  /**
   * Get all in-flight keys
   */
  keys(): string[] {
    return Array.from(this.inflight.keys());
  }
}

// Singleton instance
export const requestCoalescer = new RequestCoalescer();

console.log('[RequestCoalescer] Module loaded');
