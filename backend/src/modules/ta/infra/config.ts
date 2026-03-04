/**
 * Phase S1: TA Module Configuration
 * Single source of truth for all config values
 */

export type TAConfig = {
  // Environment
  env: 'development' | 'production' | 'test';
  
  // Freeze guard
  freezeEnabled: boolean;
  freezeWhitelist: string[]; // endpoints allowed during freeze
  
  // Provider settings
  provider: 'BINANCE' | 'MOCK';
  providerBaseUrl: string;
  
  // Cache settings
  cacheTtlSec: number;
  cacheTtlSecDaily: number;
  cacheMaxKeys: number;
  
  // Rate limiting
  rateLimitRps: number;
  rateLimitBurstSize: number;
  rateLimitQueueTimeoutMs: number;
  
  // Circuit breaker
  breakerFailThreshold: number;
  breakerResetMs: number;
  breakerHalfOpenMaxAttempts: number;
  
  // Determinism
  seed: number;
  ransacIterations: number;
  
  // Observability
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'json' | 'text';
  metricsWindowSec: number;
  
  // Degradation
  staleCacheMaxSec: number;
  minCandlesRequired: number;
};

const DEFAULT_CONFIG: TAConfig = {
  env: 'development',
  freezeEnabled: false,
  freezeWhitelist: ['GET /api/ta/health', 'GET /api/ta/analyze', 'GET /api/ta/metrics'],
  provider: 'MOCK',
  providerBaseUrl: 'https://api.binance.com',
  cacheTtlSec: 60,
  cacheTtlSecDaily: 300,
  cacheMaxKeys: 1000,
  rateLimitRps: 10,
  rateLimitBurstSize: 20,
  rateLimitQueueTimeoutMs: 200,
  breakerFailThreshold: 5,
  breakerResetMs: 30000,
  breakerHalfOpenMaxAttempts: 3,
  seed: 42,
  ransacIterations: 100,
  logLevel: 'info',
  logFormat: 'json',
  metricsWindowSec: 300,
  staleCacheMaxSec: 600,
  minCandlesRequired: 50,
};

let config: TAConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from environment variables
 */
export function getConfigFromEnv(): TAConfig {
  const env = process.env.NODE_ENV as TAConfig['env'] || 'development';
  
  return {
    env,
    freezeEnabled: process.env.TA_FREEZE_ENABLED === 'true',
    freezeWhitelist: DEFAULT_CONFIG.freezeWhitelist,
    provider: (process.env.TA_PROVIDER as TAConfig['provider']) || 'MOCK',
    providerBaseUrl: process.env.TA_PROVIDER_URL || DEFAULT_CONFIG.providerBaseUrl,
    cacheTtlSec: parseInt(process.env.TA_CACHE_TTL_SEC || '60', 10),
    cacheTtlSecDaily: parseInt(process.env.TA_CACHE_TTL_SEC_DAILY || '300', 10),
    cacheMaxKeys: parseInt(process.env.TA_CACHE_MAX_KEYS || '1000', 10),
    rateLimitRps: parseInt(process.env.TA_RATE_LIMIT_RPS || '10', 10),
    rateLimitBurstSize: parseInt(process.env.TA_RATE_LIMIT_BURST || '20', 10),
    rateLimitQueueTimeoutMs: parseInt(process.env.TA_RATE_LIMIT_QUEUE_MS || '200', 10),
    breakerFailThreshold: parseInt(process.env.TA_BREAKER_FAIL_THRESHOLD || '5', 10),
    breakerResetMs: parseInt(process.env.TA_BREAKER_RESET_MS || '30000', 10),
    breakerHalfOpenMaxAttempts: parseInt(process.env.TA_BREAKER_HALF_OPEN_ATTEMPTS || '3', 10),
    seed: parseInt(process.env.TA_SEED || '42', 10),
    ransacIterations: parseInt(process.env.TA_RANSAC_ITERATIONS || '100', 10),
    logLevel: (process.env.TA_LOG_LEVEL as TAConfig['logLevel']) || 'info',
    logFormat: (process.env.TA_LOG_FORMAT as TAConfig['logFormat']) || 'json',
    metricsWindowSec: parseInt(process.env.TA_METRICS_WINDOW_SEC || '300', 10),
    staleCacheMaxSec: parseInt(process.env.TA_STALE_CACHE_MAX_SEC || '600', 10),
    minCandlesRequired: parseInt(process.env.TA_MIN_CANDLES || '50', 10),
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(cfg: TAConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (cfg.cacheTtlSec < 1) errors.push('cacheTtlSec must be >= 1');
  if (cfg.cacheMaxKeys < 10) errors.push('cacheMaxKeys must be >= 10');
  if (cfg.rateLimitRps < 1) errors.push('rateLimitRps must be >= 1');
  if (cfg.breakerFailThreshold < 1) errors.push('breakerFailThreshold must be >= 1');
  if (cfg.breakerResetMs < 1000) errors.push('breakerResetMs must be >= 1000');
  if (cfg.minCandlesRequired < 10) errors.push('minCandlesRequired must be >= 10');
  
  return { valid: errors.length === 0, errors };
}

/**
 * Initialize module configuration
 */
export function initConfig(): TAConfig {
  config = getConfigFromEnv();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    console.error('[TA Config] Validation errors:', validation.errors);
    // Use defaults for invalid values
    config = { ...DEFAULT_CONFIG, ...config };
  }
  
  console.log(`[TA Config] Initialized: env=${config.env}, provider=${config.provider}, freeze=${config.freezeEnabled}`);
  return config;
}

/**
 * Get current configuration (read-only)
 */
export function getConfig(): Readonly<TAConfig> {
  return Object.freeze({ ...config });
}

/**
 * Update configuration at runtime (for admin endpoints)
 */
export function updateConfig(partial: Partial<TAConfig>): TAConfig {
  if (config.freezeEnabled && partial.freezeEnabled !== false) {
    throw new Error('Cannot update config while freeze is enabled');
  }
  
  config = { ...config, ...partial };
  return config;
}

/**
 * Check if freeze is enabled
 */
export function isFrozen(): boolean {
  return config.freezeEnabled;
}

/**
 * Check if endpoint is allowed during freeze
 */
export function isAllowedDuringFreeze(method: string, path: string): boolean {
  const key = `${method} ${path}`;
  return config.freezeWhitelist.some(w => key.startsWith(w));
}
