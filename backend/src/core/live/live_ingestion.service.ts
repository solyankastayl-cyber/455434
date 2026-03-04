/**
 * Live Ingestion Service
 * 
 * Core service for LIVE data ingestion control plane.
 * 
 * Responsibilities:
 * - Check Kill Switch (ENV + DB)
 * - Toggle ingestion on/off
 * - Get status
 * - Run-once for testing
 * - Auto-kill on threshold breach
 */
import { LiveRuntimeConfigModel, ensureLiveDefaultConfig, type ILiveRuntimeConfig } from './live_runtime_config.model.js';
import { LiveIngestionCursorModel } from './live_ingestion_cursor.model.js';
import { LiveEventRawModel } from './live_event_raw.model.js';
import {
  CANARY_TOKENS,
  CHAIN_CONFIG,
  KILL_SWITCH_THRESHOLDS,
  type LiveIngestionStatus,
  type ToggleResult,
} from './live_ingestion.types.js';

// ==================== CACHE ====================

let configCache: ILiveRuntimeConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

// ==================== KILL SWITCH ====================

/**
 * Check if ingestion is disabled via environment variable.
 * ENV has highest priority.
 */
function checkEnvKillSwitch(): boolean {
  const envValue = process.env.LIVE_INGESTION_ENABLED;
  if (envValue === 'false') {
    return true; // Kill switch active
  }
  return false;
}

/**
 * Get live runtime config (with caching)
 */
export async function getLiveRuntimeConfig(): Promise<ILiveRuntimeConfig> {
  const now = Date.now();
  
  // Return cached if fresh
  if (configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return configCache;
  }
  
  // Ensure default config exists
  await ensureLiveDefaultConfig();
  
  // Fetch from DB
  const config = await LiveRuntimeConfigModel.findOne();
  
  if (!config) {
    // Fallback to safe defaults (should not happen after ensureDefault)
    return {
      enabled: false,
      mode: 'OFF',
      killSwitchArmed: false,
      metrics: {
        eventsIngested24h: 0,
        duplicates24h: 0,
        errors24h: 0,
      },
      updatedAt: new Date(),
      updatedBy: 'system',
    } as ILiveRuntimeConfig;
  }
  
  // Update cache
  configCache = config;
  cacheTimestamp = now;
  
  return config;
}

/**
 * Invalidate config cache
 */
export function invalidateLiveConfigCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}

/**
 * Check if ingestion is enabled (considering all kill switches)
 */
export async function isIngestionEnabled(): Promise<boolean> {
  // 1. Check ENV kill switch (highest priority)
  if (checkEnvKillSwitch()) {
    return false;
  }
  
  // 2. Check DB runtime config
  const config = await getLiveRuntimeConfig();
  return config.enabled && !config.killSwitchArmed;
}

// ==================== STATUS ====================

/**
 * Get comprehensive ingestion status
 */
export async function getLiveIngestionStatus(): Promise<LiveIngestionStatus> {
  const config = await getLiveRuntimeConfig();
  
  // Get cursors for backlog calculation
  const cursors = await LiveIngestionCursorModel.find({ chainId: CHAIN_CONFIG.CHAIN_ID });
  
  // Calculate min cursor (most behind)
  let minCursor = 0;
  if (cursors.length > 0) {
    minCursor = Math.min(...cursors.map(c => c.lastProcessedBlock));
  }
  
  // Get 24h metrics
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const eventsCount = await LiveEventRawModel.countDocuments({
    ingestedAt: { $gte: twentyFourHoursAgo },
  });
  
  // Calculate rates
  const dupRate = config.metrics.duplicates24h > 0
    ? config.metrics.duplicates24h / (config.metrics.eventsIngested24h + config.metrics.duplicates24h)
    : 0;
    
  const errRate = config.metrics.errors24h > 0
    ? config.metrics.errors24h / (config.metrics.eventsIngested24h + config.metrics.errors24h + 1)
    : 0;
  
  return {
    enabled: config.enabled && !config.killSwitchArmed && !checkEnvKillSwitch(),
    mode: config.mode,
    lastBlock: config.lastBlock ?? null,
    safeHead: null, // Will be populated by RPC fetcher
    backlog: config.lastBlock && minCursor > 0 ? config.lastBlock - minCursor : null,
    provider: config.lastProvider ?? null,
    killSwitchArmed: config.killSwitchArmed || checkEnvKillSwitch(),
    killReason: checkEnvKillSwitch() ? 'ENV kill switch active' : config.killReason,
    lastRun: config.lastRun ?? null,
    metrics: {
      eventsIngested24h: eventsCount,
      duplicateRate: dupRate,
      errorRate: errRate,
      approvalPassRate: config.metrics.approvalPassRate,
    },
    canaryTokens: CANARY_TOKENS.map(t => t.symbol),
  };
}

// ==================== TOGGLE ====================

/**
 * Toggle ingestion on/off
 */
export async function toggleLiveIngestion(enabled: boolean): Promise<ToggleResult> {
  // Check ENV kill switch
  if (enabled && checkEnvKillSwitch()) {
    throw new Error('Cannot enable: ENV kill switch is active (LIVE_INGESTION_ENABLED=false)');
  }
  
  // Check if armed kill switch blocks re-enable
  const config = await getLiveRuntimeConfig();
  if (enabled && config.killSwitchArmed) {
    throw new Error(`Cannot enable: Kill switch armed. Reason: ${config.killReason || 'Unknown'}`);
  }
  
  const updatedAt = new Date();
  
  await LiveRuntimeConfigModel.findOneAndUpdate(
    {},
    {
      $set: {
        enabled,
        mode: enabled ? 'CANARY' : 'OFF',
        updatedAt,
        updatedBy: 'operator',
        // Clear kill reason if enabling
        ...(enabled ? { killReason: undefined } : {}),
      },
    },
    { upsert: true }
  );
  
  // Invalidate cache
  invalidateLiveConfigCache();
  
  console.log(`[Live Ingestion] ${enabled ? 'ENABLED' : 'DISABLED'} by operator`);
  
  return {
    ok: true,
    enabled,
    updatedBy: 'operator',
    updatedAt,
  };
}

// ==================== KILL SWITCH TRIGGER ====================

/**
 * Trigger kill switch (called when thresholds are breached)
 */
export async function triggerKillSwitch(reason: string): Promise<void> {
  await LiveRuntimeConfigModel.findOneAndUpdate(
    {},
    {
      $set: {
        enabled: false,
        mode: 'OFF',
        killSwitchArmed: true,
        killReason: reason,
        updatedAt: new Date(),
        updatedBy: 'system',
      },
    },
    { upsert: true }
  );
  
  // Invalidate cache
  invalidateLiveConfigCache();
  
  console.error(`[Live Ingestion] KILL SWITCH TRIGGERED: ${reason}`);
  
  // TODO: Send notification (Telegram, etc.)
}

/**
 * Reset kill switch (manual recovery)
 */
export async function resetKillSwitch(): Promise<void> {
  await LiveRuntimeConfigModel.findOneAndUpdate(
    {},
    {
      $set: {
        killSwitchArmed: false,
        killReason: undefined,
        updatedAt: new Date(),
        updatedBy: 'operator',
      },
    },
    { upsert: true }
  );
  
  // Invalidate cache
  invalidateLiveConfigCache();
  
  console.log('[Live Ingestion] Kill switch reset by operator');
}

// ==================== METRICS UPDATE ====================

/**
 * Update runtime metrics after a cycle
 */
export async function updateCycleMetrics(metrics: {
  eventsIngested?: number;
  duplicates?: number;
  errors?: number;
  lastBlock?: number;
  provider?: 'infura' | 'ankr';
  error?: string;
}): Promise<void> {
  const update: any = {
    lastRun: new Date(),
    updatedAt: new Date(),
  };
  
  if (metrics.lastBlock !== undefined) {
    update.lastBlock = metrics.lastBlock;
  }
  
  if (metrics.provider) {
    update.lastProvider = metrics.provider;
  }
  
  const increment: any = {};
  
  if (metrics.eventsIngested) {
    increment['metrics.eventsIngested24h'] = metrics.eventsIngested;
  }
  
  if (metrics.duplicates) {
    increment['metrics.duplicates24h'] = metrics.duplicates;
  }
  
  if (metrics.errors) {
    increment['metrics.errors24h'] = metrics.errors;
    update['metrics.lastErrorAt'] = new Date();
    if (metrics.error) {
      update['metrics.lastError'] = metrics.error;
    }
  }
  
  await LiveRuntimeConfigModel.findOneAndUpdate(
    {},
    {
      $set: update,
      ...(Object.keys(increment).length > 0 ? { $inc: increment } : {}),
    },
    { upsert: true }
  );
  
  // Invalidate cache
  invalidateLiveConfigCache();
}

/**
 * Check if metrics breach kill switch thresholds
 */
export async function checkKillSwitchThresholds(): Promise<{ shouldKill: boolean; reason?: string }> {
  const config = await getLiveRuntimeConfig();
  
  // Calculate rates
  const total = config.metrics.eventsIngested24h + config.metrics.duplicates24h + config.metrics.errors24h;
  
  if (total < 100) {
    // Not enough data to assess
    return { shouldKill: false };
  }
  
  const errorRate = config.metrics.errors24h / total;
  const dupRate = config.metrics.duplicates24h / (config.metrics.eventsIngested24h + config.metrics.duplicates24h || 1);
  
  // Check thresholds
  if (errorRate > KILL_SWITCH_THRESHOLDS.ERROR_RATE_MAX) {
    return {
      shouldKill: true,
      reason: `Error rate too high: ${(errorRate * 100).toFixed(1)}% > ${KILL_SWITCH_THRESHOLDS.ERROR_RATE_MAX * 100}%`,
    };
  }
  
  if (dupRate > KILL_SWITCH_THRESHOLDS.DUP_RATE_MAX) {
    return {
      shouldKill: true,
      reason: `Duplicate rate too high: ${(dupRate * 100).toFixed(1)}% > ${KILL_SWITCH_THRESHOLDS.DUP_RATE_MAX * 100}%`,
    };
  }
  
  return { shouldKill: false };
}

// ==================== CURSOR MANAGEMENT ====================

/**
 * Get cursor for a token
 */
export async function getCursor(tokenAddress: string): Promise<{
  lastProcessedBlock: number;
  rangeHint: number;
  mode: 'bootstrap' | 'tail';
} | null> {
  const cursor = await LiveIngestionCursorModel.findOne({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
  });
  
  if (!cursor) {
    return null;
  }
  
  return {
    lastProcessedBlock: cursor.lastProcessedBlock,
    rangeHint: cursor.rangeHint,
    mode: cursor.mode,
  };
}

/**
 * Update cursor after processing
 */
export async function updateCursor(
  tokenAddress: string,
  lastProcessedBlock: number,
  updates?: {
    rangeHint?: number;
    mode?: 'bootstrap' | 'tail';
    providerUsed?: 'infura' | 'ankr';
  }
): Promise<void> {
  await LiveIngestionCursorModel.findOneAndUpdate(
    {
      chainId: CHAIN_CONFIG.CHAIN_ID,
      tokenAddress: tokenAddress.toLowerCase(),
    },
    {
      $set: {
        lastProcessedBlock,
        updatedAt: new Date(),
        ...updates,
      },
    },
    { upsert: true }
  );
}

/**
 * Initialize cursors for all canary tokens
 */
export async function initializeCursors(startBlock: number): Promise<void> {
  for (const token of CANARY_TOKENS) {
    await LiveIngestionCursorModel.findOneAndUpdate(
      {
        chainId: CHAIN_CONFIG.CHAIN_ID,
        tokenAddress: token.address.toLowerCase(),
      },
      {
        $setOnInsert: {
          chainId: CHAIN_CONFIG.CHAIN_ID,
          tokenAddress: token.address.toLowerCase(),
          lastProcessedBlock: startBlock,
          targetHeadBlock: startBlock,
          rangeHint: 1500,
          providerUsed: 'infura',
          mode: 'bootstrap',
          createdAt: new Date(),
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
  
  console.log(`[Live Ingestion] Cursors initialized for ${CANARY_TOKENS.length} tokens at block ${startBlock}`);
}

/**
 * Get minimum cursor (most behind)
 */
export async function getMinCursor(): Promise<number> {
  const result = await LiveIngestionCursorModel.aggregate([
    { $match: { chainId: CHAIN_CONFIG.CHAIN_ID } },
    { $group: { _id: null, minBlock: { $min: '$lastProcessedBlock' } } },
  ]);
  
  return result[0]?.minBlock ?? 0;
}
