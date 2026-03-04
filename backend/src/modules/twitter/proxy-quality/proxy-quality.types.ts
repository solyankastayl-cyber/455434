// P1: Proxy Quality Types

export interface ProxyQualityMetrics {
  slotId: string;
  successRate24h: number;    // 0-1
  timeoutRate24h: number;    // 0-1
  rateLimitRate24h: number;  // 0-1
  latencyP50: number;        // ms
  latencyP95: number;        // ms
  totalRequests24h: number;
  score: number;             // 0-100 (100 = excellent)
}

export interface ProxyQualityConfig {
  // Weight for success rate in score
  successWeight: number;
  // Weight for timeout rate
  timeoutWeight: number;
  // Weight for rate limit rate
  rateLimitWeight: number;
  // Weight for latency
  latencyWeight: number;
  // Latency threshold for penalty (ms)
  latencyThresholdMs: number;
}

export const DEFAULT_PROXY_QUALITY_CONFIG: ProxyQualityConfig = {
  successWeight: 0.40,
  timeoutWeight: 0.25,
  rateLimitWeight: 0.20,
  latencyWeight: 0.15,
  latencyThresholdMs: 2000,
};
