/**
 * P0.1 ML Runtime Policy
 * 
 * Central configuration for ML service behavior:
 * - Timeouts, retries, circuit-breaker
 * - Model enablement flags
 * - Runtime state tracking
 */

export interface MLPolicyConfig {
  pythonEnabled: boolean;
  marketModelEnabled: boolean;
  actorModelEnabled: boolean;
  timeoutMs: number;
  retry: number;
  circuitBreaker: {
    enabled: boolean;
    maxErrors: number;
    resetAfterSec: number;
  };
}

export interface CircuitBreakerState {
  open: boolean;
  errorCount: number;
  lastErrorTs: number;
  openedAtTs: number;
}

export interface PythonServiceHealth {
  enabled: boolean;
  healthy: boolean;
  lastSuccessTs: number;
  lastErrorTs: number;
  latencyMsP95: number;
  latencyHistory: number[];
}

// Default policy (can be overridden via env/DB)
const defaultPolicy: MLPolicyConfig = {
  pythonEnabled: process.env.ML_PYTHON_ENABLED !== 'false',
  marketModelEnabled: process.env.ML_MARKET_ENABLED !== 'false',
  actorModelEnabled: process.env.ML_ACTOR_ENABLED !== 'false',
  timeoutMs: parseInt(process.env.ML_TIMEOUT_MS || '1200', 10),
  retry: parseInt(process.env.ML_RETRY || '1', 10),
  circuitBreaker: {
    enabled: process.env.ML_CIRCUIT_BREAKER !== 'false',
    maxErrors: parseInt(process.env.ML_CB_MAX_ERRORS || '5', 10),
    resetAfterSec: parseInt(process.env.ML_CB_RESET_SEC || '60', 10),
  },
};

// Runtime state (in-memory)
let policy: MLPolicyConfig = { ...defaultPolicy };

let circuitBreaker: CircuitBreakerState = {
  open: false,
  errorCount: 0,
  lastErrorTs: 0,
  openedAtTs: 0,
};

let pythonHealth: PythonServiceHealth = {
  enabled: policy.pythonEnabled,
  healthy: true,
  lastSuccessTs: 0,
  lastErrorTs: 0,
  latencyMsP95: 0,
  latencyHistory: [],
};

// ============================================
// POLICY ACCESSORS
// ============================================

export function getPolicy(): MLPolicyConfig {
  return { ...policy };
}

export function updatePolicy(updates: Partial<MLPolicyConfig>): void {
  policy = { ...policy, ...updates };
  if (updates.circuitBreaker) {
    policy.circuitBreaker = { ...policy.circuitBreaker, ...updates.circuitBreaker };
  }
  console.log('[MLPolicy] Updated:', JSON.stringify(policy));
}

// ============================================
// CIRCUIT BREAKER
// ============================================

export function getCircuitBreakerState(): CircuitBreakerState {
  // Auto-reset if time elapsed
  if (circuitBreaker.open) {
    const elapsed = (Date.now() - circuitBreaker.openedAtTs) / 1000;
    if (elapsed >= policy.circuitBreaker.resetAfterSec) {
      resetCircuitBreaker();
    }
  }
  return { ...circuitBreaker };
}

export function recordMLSuccess(latencyMs: number): void {
  pythonHealth.healthy = true;
  pythonHealth.lastSuccessTs = Date.now();
  
  // Track latency (keep last 100)
  pythonHealth.latencyHistory.push(latencyMs);
  if (pythonHealth.latencyHistory.length > 100) {
    pythonHealth.latencyHistory.shift();
  }
  
  // Calculate P95
  if (pythonHealth.latencyHistory.length > 0) {
    const sorted = [...pythonHealth.latencyHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    pythonHealth.latencyMsP95 = sorted[p95Index] || sorted[sorted.length - 1];
  }
  
  // Reset error count on success
  if (circuitBreaker.errorCount > 0) {
    circuitBreaker.errorCount = Math.max(0, circuitBreaker.errorCount - 1);
  }
}

export function recordMLError(): void {
  pythonHealth.healthy = false;
  pythonHealth.lastErrorTs = Date.now();
  
  circuitBreaker.errorCount++;
  circuitBreaker.lastErrorTs = Date.now();
  
  // Open circuit if threshold reached
  if (
    policy.circuitBreaker.enabled &&
    circuitBreaker.errorCount >= policy.circuitBreaker.maxErrors &&
    !circuitBreaker.open
  ) {
    circuitBreaker.open = true;
    circuitBreaker.openedAtTs = Date.now();
    console.log(`[MLPolicy] Circuit breaker OPEN after ${circuitBreaker.errorCount} errors`);
  }
}

export function resetCircuitBreaker(): void {
  circuitBreaker.open = false;
  circuitBreaker.errorCount = 0;
  circuitBreaker.openedAtTs = 0;
  console.log('[MLPolicy] Circuit breaker RESET');
}

export function isCircuitOpen(): boolean {
  // Check and auto-reset
  getCircuitBreakerState();
  return circuitBreaker.open;
}

// ============================================
// PYTHON SERVICE HEALTH
// ============================================

export function getPythonHealth(): PythonServiceHealth {
  return {
    ...pythonHealth,
    enabled: policy.pythonEnabled,
    latencyHistory: [], // Don't expose full history
  };
}

export function shouldUsePython(): boolean {
  if (!policy.pythonEnabled) return false;
  if (isCircuitOpen()) return false;
  return true;
}

// ============================================
// MODEL STATUS
// ============================================

export interface ModelStatus {
  version: string;
  enabled: boolean;
  fallback: boolean;
}

let modelVersions = {
  market: 'baseline_v1',
  actor: 'baseline_v1',
};

export function setModelVersion(model: 'market' | 'actor', version: string): void {
  modelVersions[model] = version;
}

export function getModelStatus(model: 'market' | 'actor'): ModelStatus {
  const enabled = model === 'market' ? policy.marketModelEnabled : policy.actorModelEnabled;
  return {
    version: modelVersions[model],
    enabled,
    fallback: !shouldUsePython(),
  };
}

// ============================================
// FULL STATUS EXPORT
// ============================================

export interface MLStatus {
  apiVersion: string;
  dataVersion: string;
  ml: {
    pythonService: PythonServiceHealth;
    models: {
      market: ModelStatus;
      actor: ModelStatus;
    };
    policy: {
      timeoutMs: number;
      retry: number;
      circuitBreaker: {
        enabled: boolean;
        open: boolean;
        errorCount: number;
      };
    };
  };
}

export function getMLStatus(): MLStatus {
  const cbState = getCircuitBreakerState();
  
  return {
    apiVersion: '2.1',
    dataVersion: '2.1',
    ml: {
      pythonService: getPythonHealth(),
      models: {
        market: getModelStatus('market'),
        actor: getModelStatus('actor'),
      },
      policy: {
        timeoutMs: policy.timeoutMs,
        retry: policy.retry,
        circuitBreaker: {
          enabled: policy.circuitBreaker.enabled,
          open: cbState.open,
          errorCount: cbState.errorCount,
        },
      },
    },
  };
}

export default {
  getPolicy,
  updatePolicy,
  getCircuitBreakerState,
  recordMLSuccess,
  recordMLError,
  resetCircuitBreaker,
  isCircuitOpen,
  getPythonHealth,
  shouldUsePython,
  getModelStatus,
  setModelVersion,
  getMLStatus,
};
