/**
 * IN-FLIGHT REGISTRY
 * ==================
 * 
 * P3: Block 16 - Concurrency Lock (Single-Flight)
 * Prevents 10 simultaneous requests from triggering 10 heavy computes.
 * 
 * First request runs the compute.
 * Other requests wait for the same Promise.
 */

export class InflightRegistry {
  private inflight = new Map<string, Promise<any>>();

  /**
   * Check if computation is in progress for key
   */
  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Get existing promise for key
   */
  get(key: string): Promise<any> | undefined {
    return this.inflight.get(key);
  }

  /**
   * Set promise for key, auto-cleanup on completion
   */
  set<T>(key: string, p: Promise<T>): Promise<T> {
    this.inflight.set(key, p);

    // Clean up after completion (success or failure)
    p.finally(() => {
      this.inflight.delete(key);
    });

    return p;
  }

  /**
   * Get number of in-flight computations
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

export const inflightRegistry = new InflightRegistry();

console.log('[InflightRegistry] Module loaded');
