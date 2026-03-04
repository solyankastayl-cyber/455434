/**
 * P0.1 ML Python Client
 * 
 * Wrapper for Python ML service calls with:
 * - Configurable timeout
 * - Retry logic
 * - Circuit-breaker integration
 * - Latency tracking
 */

import {
  getPolicy,
  shouldUsePython,
  recordMLSuccess,
  recordMLError,
  setModelVersion,
} from './ml_policy.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8002';

// ============================================
// TYPES
// ============================================

export interface MarketPredictRequest {
  network: string;
  features: {
    exchangePressure: number;
    accZoneStrength: number;
    distZoneStrength: number;
    corridorsEntropy: number;
  };
  timeBucket?: number;
}

export interface MarketPredictResponse {
  network: string;
  timeBucket: number;
  pUp: number;
  pDown: number;
  confidence: number;
  mlSignal: 'BUY' | 'SELL' | 'NEUTRAL';
  modelVersion: string;
}

export interface ActorPredictRequest {
  network: string;
  actorId: string;
  features: {
    netFlowUsd: number;
    inflowUsd: number;
    outflowUsd: number;
    hubScore: number;
    pagerank: number;
    brokerScore: number;
    kCore: number;
    entropyOut: number;
    exchangeExposure: number;
    corridorDensity: number;
  };
}

export interface ActorPredictResponse {
  network: string;
  actorId: string;
  label: 'SMART' | 'NEUTRAL' | 'NOISY';
  probabilities: Record<string, number>;
  confidence: number;
  modelVersion: string;
}

export interface MLCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  latencyMs: number;
  usedFallback: boolean;
}

// ============================================
// CORE FETCH WITH TIMEOUT
// ============================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// RETRY WRAPPER
// ============================================

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      
      // Only retry on network errors
      const isNetworkError = 
        err.name === 'AbortError' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.message?.includes('fetch failed');
      
      if (!isNetworkError || attempt >= maxRetries) {
        throw err;
      }
      
      console.log(`[MLClient] Retry ${attempt + 1}/${maxRetries} after error: ${err.message}`);
      // Small delay before retry
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  throw lastError;
}

// ============================================
// MARKET PREDICTION
// ============================================

export async function callMarketPredict(
  request: MarketPredictRequest
): Promise<MLCallResult<MarketPredictResponse>> {
  const startTs = Date.now();
  const policy = getPolicy();
  
  // Check circuit-breaker
  if (!shouldUsePython()) {
    return {
      success: false,
      error: 'Circuit breaker open or Python disabled',
      latencyMs: Date.now() - startTs,
      usedFallback: true,
    };
  }
  
  try {
    const response = await callWithRetry(async () => {
      return fetchWithTimeout(
        `${ML_SERVICE_URL}/api/p35/predict/market`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
        policy.timeoutMs
      );
    }, policy.retry);
    
    const latencyMs = Date.now() - startTs;
    
    if (!response.ok) {
      recordMLError();
      return {
        success: false,
        error: `HTTP ${response.status}`,
        latencyMs,
        usedFallback: true,
      };
    }
    
    const data: MarketPredictResponse = await response.json();
    
    // Record success
    recordMLSuccess(latencyMs);
    setModelVersion('market', data.modelVersion);
    
    return {
      success: true,
      data,
      latencyMs,
      usedFallback: false,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTs;
    recordMLError();
    
    console.log(`[MLClient] Market predict failed: ${err.message}`);
    
    return {
      success: false,
      error: err.message,
      latencyMs,
      usedFallback: true,
    };
  }
}

// ============================================
// ACTOR PREDICTION
// ============================================

export async function callActorPredict(
  request: ActorPredictRequest
): Promise<MLCallResult<ActorPredictResponse>> {
  const startTs = Date.now();
  const policy = getPolicy();
  
  // Check circuit-breaker
  if (!shouldUsePython()) {
    return {
      success: false,
      error: 'Circuit breaker open or Python disabled',
      latencyMs: Date.now() - startTs,
      usedFallback: true,
    };
  }
  
  try {
    const response = await callWithRetry(async () => {
      return fetchWithTimeout(
        `${ML_SERVICE_URL}/api/p35/predict/actor`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
        policy.timeoutMs
      );
    }, policy.retry);
    
    const latencyMs = Date.now() - startTs;
    
    if (!response.ok) {
      recordMLError();
      return {
        success: false,
        error: `HTTP ${response.status}`,
        latencyMs,
        usedFallback: true,
      };
    }
    
    const data: ActorPredictResponse = await response.json();
    
    // Record success
    recordMLSuccess(latencyMs);
    setModelVersion('actor', data.modelVersion);
    
    return {
      success: true,
      data,
      latencyMs,
      usedFallback: false,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTs;
    recordMLError();
    
    console.log(`[MLClient] Actor predict failed: ${err.message}`);
    
    return {
      success: false,
      error: err.message,
      latencyMs,
      usedFallback: true,
    };
  }
}

// ============================================
// HEALTH CHECK
// ============================================

export async function checkPythonHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${ML_SERVICE_URL}/api/p35/status`,
      { method: 'GET' },
      2000
    );
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  callMarketPredict,
  callActorPredict,
  checkPythonHealth,
};
