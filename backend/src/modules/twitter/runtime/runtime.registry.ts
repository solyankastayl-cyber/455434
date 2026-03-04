// B3.2 - Runtime Registry
// Manages runtime instances and caches health status

import { RuntimeHealthSnapshot } from './runtime.health.js';
import { TwitterRuntime } from './runtime.interface.js';

interface RuntimeEntry {
  runtime: TwitterRuntime;
  health?: RuntimeHealthSnapshot;
  createdAt: number;
}

export class RuntimeRegistry {
  private map = new Map<string, RuntimeEntry>();

  /**
   * Register a runtime for a slot
   */
  register(slotId: string, runtime: TwitterRuntime): void {
    this.map.set(slotId, {
      runtime,
      createdAt: Date.now(),
    });
  }

  /**
   * Unregister a runtime
   */
  unregister(slotId: string): void {
    this.map.delete(slotId);
  }

  /**
   * Get runtime for a slot
   */
  getRuntime(slotId: string): TwitterRuntime | undefined {
    return this.map.get(slotId)?.runtime;
  }

  /**
   * Check if slot has registered runtime
   */
  has(slotId: string): boolean {
    return this.map.has(slotId);
  }

  /**
   * Update health for a slot
   */
  setHealth(slotId: string, health: RuntimeHealthSnapshot): void {
    const entry = this.map.get(slotId);
    if (entry) {
      entry.health = health;
    }
  }

  /**
   * Get health for a slot
   */
  getHealth(slotId: string): RuntimeHealthSnapshot | undefined {
    return this.map.get(slotId)?.health;
  }

  /**
   * Get all entries
   */
  getAll(): Map<string, RuntimeEntry> {
    return new Map(this.map);
  }

  /**
   * Get all slot IDs
   */
  getSlotIds(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get count
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Get summary for monitoring
   */
  getSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    error: number;
    unknown: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let error = 0;
    let unknown = 0;

    for (const entry of this.map.values()) {
      if (!entry.health) {
        unknown++;
        continue;
      }

      switch (entry.health.status) {
        case 'OK':
          healthy++;
          break;
        case 'RATE_LIMITED':
        case 'AUTH_REQUIRED':
          degraded++;
          break;
        case 'ERROR':
        case 'DOWN':
          error++;
          break;
        default:
          unknown++;
      }
    }

    return {
      total: this.map.size,
      healthy,
      degraded,
      error,
      unknown,
    };
  }
}

// Singleton instance
export const runtimeRegistry = new RuntimeRegistry();
