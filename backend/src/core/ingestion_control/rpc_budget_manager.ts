/**
 * RPC Budget Manager (P0.1)
 * 
 * Rate limiting and backpressure for RPC calls.
 * Prevents overwhelming RPC providers.
 */

// ============================================
// Configuration
// ============================================

interface ChainRpcConfig {
  maxRequestsPerMinute: number;
  maxConcurrent: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  errorThreshold: number;  // Errors before reducing rate
}

const DEFAULT_CONFIG: ChainRpcConfig = {
  maxRequestsPerMinute: 100,
  maxConcurrent: 5,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
  errorThreshold: 3
};

const CHAIN_RPC_CONFIG: Record<string, Partial<ChainRpcConfig>> = {
  ETH: { maxRequestsPerMinute: 60, maxConcurrent: 3 },   // Most expensive
  ARB: { maxRequestsPerMinute: 120, maxConcurrent: 5 },
  OP: { maxRequestsPerMinute: 120, maxConcurrent: 5 },
  BASE: { maxRequestsPerMinute: 120, maxConcurrent: 5 },
  POLY: { maxRequestsPerMinute: 100, maxConcurrent: 5 },
  BNB: { maxRequestsPerMinute: 100, maxConcurrent: 5 },
  AVAX: { maxRequestsPerMinute: 100, maxConcurrent: 5 },
  ZKSYNC: { maxRequestsPerMinute: 60, maxConcurrent: 3 },
  SCROLL: { maxRequestsPerMinute: 60, maxConcurrent: 3 },
  LINEA: { maxRequestsPerMinute: 60, maxConcurrent: 3 }
};

// ============================================
// Types
// ============================================

interface ChainBudgetState {
  chain: string;
  requestsThisMinute: number;
  currentConcurrent: number;
  lastRequestAt: number;
  minuteStartedAt: number;
  consecutiveErrors: number;
  currentBackoffMs: number;
  isPaused: boolean;
  pausedUntil: number;
}

type RpcErrorType = 'RATE_LIMIT' | 'TIMEOUT' | 'SERVER_ERROR' | 'NETWORK' | 'UNKNOWN';

// ============================================
// State Management
// ============================================

const chainStates = new Map<string, ChainBudgetState>();

function getChainConfig(chain: string): ChainRpcConfig {
  const override = CHAIN_RPC_CONFIG[chain.toUpperCase()] || {};
  return { ...DEFAULT_CONFIG, ...override };
}

function getOrCreateState(chain: string): ChainBudgetState {
  const chainUpper = chain.toUpperCase();
  
  if (!chainStates.has(chainUpper)) {
    chainStates.set(chainUpper, {
      chain: chainUpper,
      requestsThisMinute: 0,
      currentConcurrent: 0,
      lastRequestAt: 0,
      minuteStartedAt: Date.now(),
      consecutiveErrors: 0,
      currentBackoffMs: 0,
      isPaused: false,
      pausedUntil: 0
    });
  }
  
  return chainStates.get(chainUpper)!;
}

// ============================================
// Core Functions
// ============================================

/**
 * Try to acquire a request slot
 * Returns wait time in ms if should wait, 0 if can proceed, -1 if paused
 */
export function acquireSlot(chain: string): { canProceed: boolean; waitMs: number; reason?: string } {
  const state = getOrCreateState(chain);
  const config = getChainConfig(chain);
  const now = Date.now();
  
  // Check if paused
  if (state.isPaused) {
    if (now < state.pausedUntil) {
      return { 
        canProceed: false, 
        waitMs: state.pausedUntil - now,
        reason: 'Chain is paused due to errors'
      };
    }
    // Unpause
    state.isPaused = false;
    state.pausedUntil = 0;
    state.consecutiveErrors = 0;
  }
  
  // Check backoff
  if (state.currentBackoffMs > 0 && now < state.lastRequestAt + state.currentBackoffMs) {
    const waitMs = (state.lastRequestAt + state.currentBackoffMs) - now;
    return { 
      canProceed: false, 
      waitMs,
      reason: `Backoff active: ${waitMs}ms remaining`
    };
  }
  
  // Reset minute counter if needed
  if (now - state.minuteStartedAt > 60000) {
    state.requestsThisMinute = 0;
    state.minuteStartedAt = now;
  }
  
  // Check rate limit
  if (state.requestsThisMinute >= config.maxRequestsPerMinute) {
    const waitMs = 60000 - (now - state.minuteStartedAt);
    return { 
      canProceed: false, 
      waitMs,
      reason: `Rate limit reached: ${state.requestsThisMinute}/${config.maxRequestsPerMinute} per minute`
    };
  }
  
  // Check concurrent limit
  if (state.currentConcurrent >= config.maxConcurrent) {
    return { 
      canProceed: false, 
      waitMs: 100, // Short wait, will retry
      reason: `Concurrent limit: ${state.currentConcurrent}/${config.maxConcurrent}`
    };
  }
  
  // Acquire slot
  state.requestsThisMinute++;
  state.currentConcurrent++;
  state.lastRequestAt = now;
  
  return { canProceed: true, waitMs: 0 };
}

/**
 * Release a request slot after completion
 */
export function releaseSlot(chain: string): void {
  const state = getOrCreateState(chain);
  state.currentConcurrent = Math.max(0, state.currentConcurrent - 1);
}

/**
 * Handle RPC error - applies backoff and may pause chain
 */
export function onRpcError(
  chain: string, 
  error: Error | string
): { shouldPause: boolean; backoffMs: number } {
  const state = getOrCreateState(chain);
  const config = getChainConfig(chain);
  const errorMsg = typeof error === 'string' ? error : error.message;
  
  // Classify error
  const errorType = classifyError(errorMsg);
  
  // Release slot on error
  releaseSlot(chain);
  
  // Increment error count
  state.consecutiveErrors++;
  
  // Calculate backoff (exponential)
  if (errorType === 'RATE_LIMIT') {
    // Rate limit - longer backoff
    state.currentBackoffMs = Math.min(
      config.maxBackoffMs,
      config.baseBackoffMs * Math.pow(2, state.consecutiveErrors)
    );
  } else {
    // Other errors - standard backoff
    state.currentBackoffMs = Math.min(
      config.maxBackoffMs,
      config.baseBackoffMs * state.consecutiveErrors
    );
  }
  
  // Check if we should pause
  const shouldPause = state.consecutiveErrors >= config.errorThreshold;
  
  if (shouldPause) {
    state.isPaused = true;
    state.pausedUntil = Date.now() + config.maxBackoffMs;
    console.log(`[RpcBudget] PAUSED ${chain} until ${new Date(state.pausedUntil).toISOString()}`);
  }
  
  console.log(`[RpcBudget] Error on ${chain}: ${errorType}, backoff: ${state.currentBackoffMs}ms, consecutive: ${state.consecutiveErrors}`);
  
  return { shouldPause, backoffMs: state.currentBackoffMs };
}

/**
 * Handle successful RPC call - resets error state
 */
export function onRpcSuccess(chain: string): void {
  const state = getOrCreateState(chain);
  state.consecutiveErrors = 0;
  state.currentBackoffMs = 0;
}

/**
 * Check if chain should be paused
 */
export function shouldPause(chain: string): boolean {
  const state = getOrCreateState(chain);
  const config = getChainConfig(chain);
  return state.consecutiveErrors >= config.errorThreshold;
}

/**
 * Force pause a chain
 */
export function forcePause(chain: string, durationMs: number): void {
  const state = getOrCreateState(chain);
  state.isPaused = true;
  state.pausedUntil = Date.now() + durationMs;
}

/**
 * Force unpause a chain
 */
export function forceUnpause(chain: string): void {
  const state = getOrCreateState(chain);
  state.isPaused = false;
  state.pausedUntil = 0;
  state.consecutiveErrors = 0;
  state.currentBackoffMs = 0;
}

// ============================================
// Status & Metrics
// ============================================

/**
 * Get current budget status for a chain
 */
export function getBudgetStatus(chain: string): {
  chain: string;
  requestsThisMinute: number;
  maxRequestsPerMinute: number;
  currentConcurrent: number;
  maxConcurrent: number;
  consecutiveErrors: number;
  currentBackoffMs: number;
  isPaused: boolean;
  pausedUntil?: Date;
} {
  const state = getOrCreateState(chain);
  const config = getChainConfig(chain);
  
  return {
    chain: state.chain,
    requestsThisMinute: state.requestsThisMinute,
    maxRequestsPerMinute: config.maxRequestsPerMinute,
    currentConcurrent: state.currentConcurrent,
    maxConcurrent: config.maxConcurrent,
    consecutiveErrors: state.consecutiveErrors,
    currentBackoffMs: state.currentBackoffMs,
    isPaused: state.isPaused,
    pausedUntil: state.isPaused ? new Date(state.pausedUntil) : undefined
  };
}

/**
 * Get status for all chains
 */
export function getAllBudgetStatus(): ReturnType<typeof getBudgetStatus>[] {
  const chains = ['ETH', 'ARB', 'OP', 'BASE', 'POLY', 'BNB', 'AVAX', 'ZKSYNC', 'SCROLL', 'LINEA'];
  return chains.map(chain => getBudgetStatus(chain));
}

// ============================================
// Helpers
// ============================================

function classifyError(errorMsg: string): RpcErrorType {
  const msg = errorMsg.toLowerCase();
  
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
    return 'RATE_LIMIT';
  }
  
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'TIMEOUT';
  }
  
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server')) {
    return 'SERVER_ERROR';
  }
  
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'NETWORK';
  }
  
  return 'UNKNOWN';
}

/**
 * Wait helper with jitter
 */
export async function waitWithJitter(baseMs: number): Promise<void> {
  const jitter = Math.random() * 0.2 * baseMs; // 0-20% jitter
  const waitTime = baseMs + jitter;
  await new Promise(resolve => setTimeout(resolve, waitTime));
}
