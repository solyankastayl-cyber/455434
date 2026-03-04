// B3.2 - Runtime Health Service
// Single source of truth for runtime health status

import { RuntimeStatus } from './runtime.types.js';
import { TwitterRuntime } from './runtime.interface.js';

export interface RuntimeHealthSnapshot {
  status: RuntimeStatus;
  lastCheckedAt: number;
  responseTime?: number;
  error?: string;
  parserInfo?: {
    version?: string;
    uptime?: number;
  };
}

export class RuntimeHealthService {
  private readonly timeout = 5000; // 5s health check timeout

  /**
   * Check health of a runtime instance
   */
  async check(runtime: TwitterRuntime): Promise<RuntimeHealthSnapshot> {
    const startTime = Date.now();
    
    try {
      const status = await Promise.race([
        runtime.getHealth(),
        this.timeoutPromise(),
      ]);

      return {
        status,
        lastCheckedAt: Date.now(),
        responseTime: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        lastCheckedAt: Date.now(),
        responseTime: Date.now() - startTime,
        error: err?.message || 'Unknown runtime error',
      };
    }
  }

  /**
   * Create a timeout promise
   */
  private timeoutPromise(): Promise<RuntimeStatus> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), this.timeout);
    });
  }
}

// Singleton instance
export const runtimeHealthService = new RuntimeHealthService();
