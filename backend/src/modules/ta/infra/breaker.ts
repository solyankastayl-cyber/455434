/**
 * Phase S2.3: Circuit Breaker
 * Fail-fast pattern for external dependencies
 */

import { getConfig } from './config.js';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerStats {
  failures: number;
  successes: number;
  lastFailure: number;
  lastSuccess: number;
  lastStateChange: number;
}

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private stats: BreakerStats = {
    failures: 0,
    successes: 0,
    lastFailure: 0,
    lastSuccess: 0,
    lastStateChange: Date.now(),
  };
  
  private failThreshold: number;
  private resetMs: number;
  private halfOpenAttempts: number;
  private halfOpenSuccesses: number = 0;
  
  // Metrics
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRejected = 0;
  
  constructor(
    failThreshold?: number,
    resetMs?: number,
    halfOpenAttempts?: number
  ) {
    const config = getConfig();
    this.failThreshold = failThreshold ?? config.breakerFailThreshold;
    this.resetMs = resetMs ?? config.breakerResetMs;
    this.halfOpenAttempts = halfOpenAttempts ?? config.breakerHalfOpenMaxAttempts;
  }
  
  /**
   * Check if circuit is allowing requests
   */
  isAllowed(): boolean {
    this.checkStateTransition();
    
    if (this.state === 'OPEN') {
      this.totalRejected++;
      return false;
    }
    
    return true;
  }
  
  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAllowed()) {
      throw new CircuitOpenError(this.getTimeUntilReset());
    }
    
    this.totalCalls++;
    
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  /**
   * Record successful call
   */
  recordSuccess(): void {
    this.stats.successes++;
    this.stats.lastSuccess = Date.now();
    this.totalSuccesses++;
    
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenAttempts) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Reset consecutive failures on success
      this.stats.failures = 0;
    }
  }
  
  /**
   * Record failed call
   */
  recordFailure(): void {
    this.stats.failures++;
    this.stats.lastFailure = Date.now();
    this.totalFailures++;
    
    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open goes back to open
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      if (this.stats.failures >= this.failThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }
  
  /**
   * Get current state
   */
  getState(): BreakerState {
    this.checkStateTransition();
    return this.state;
  }
  
  /**
   * Get time until reset (when OPEN)
   */
  getTimeUntilReset(): number {
    if (this.state !== 'OPEN') return 0;
    
    const elapsed = Date.now() - this.stats.lastStateChange;
    return Math.max(0, this.resetMs - elapsed);
  }
  
  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: BreakerState;
    consecutiveFailures: number;
    totalCalls: number;
    totalSuccesses: number;
    totalFailures: number;
    totalRejected: number;
    timeUntilReset: number;
    lastFailure: number;
    lastSuccess: number;
  } {
    return {
      state: this.getState(),
      consecutiveFailures: this.stats.failures,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRejected: this.totalRejected,
      timeUntilReset: this.getTimeUntilReset(),
      lastFailure: this.stats.lastFailure,
      lastSuccess: this.stats.lastSuccess,
    };
  }
  
  /**
   * Force state (for testing/admin)
   */
  forceState(state: BreakerState): void {
    this.transitionTo(state);
  }
  
  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.stats = {
      failures: 0,
      successes: 0,
      lastFailure: 0,
      lastSuccess: 0,
      lastStateChange: Date.now(),
    };
    this.halfOpenSuccesses = 0;
    this.totalCalls = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.totalRejected = 0;
  }
  
  private checkStateTransition(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.stats.lastStateChange;
      if (elapsed >= this.resetMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
  }
  
  private transitionTo(newState: BreakerState): void {
    if (this.state === newState) return;
    
    console.log(`[CircuitBreaker] ${this.state} → ${newState}`);
    
    this.state = newState;
    this.stats.lastStateChange = Date.now();
    
    if (newState === 'HALF_OPEN') {
      this.halfOpenSuccesses = 0;
    } else if (newState === 'CLOSED') {
      this.stats.failures = 0;
    }
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(public timeUntilReset: number) {
    super(`Circuit breaker is OPEN. Retry after ${timeUntilReset}ms`);
    this.name = 'CircuitOpenError';
  }
}

// Singleton instances per service
const breakers: Map<string, CircuitBreaker> = new Map();

export function getCircuitBreaker(service: string = 'default'): CircuitBreaker {
  let breaker = breakers.get(service);
  if (!breaker) {
    breaker = new CircuitBreaker();
    breakers.set(service, breaker);
  }
  return breaker;
}

export function getAllBreakers(): Map<string, CircuitBreaker> {
  return breakers;
}
