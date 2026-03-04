/**
 * Engine Runtime Config Service
 * 
 * Manages ML runtime configuration with caching
 * Cache TTL: 5 seconds (balance between responsiveness and DB load)
 */
import { EngineRuntimeConfigModel } from './engine_runtime_config.model.js';
import { EngineDecisionModel } from './engine_decision.model.js';

interface RuntimeConfig {
  mlEnabled: boolean;
  mlMode: 'off' | 'advisor' | 'assist';
  disabledBy?: 'system' | 'operator';
  disableReason?: string;
  updatedAt: Date;
}

// Cache
let configCache: RuntimeConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get current runtime config (with caching)
 */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const now = Date.now();
  
  // Return cached if fresh
  if (configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return configCache;
  }
  
  // Fetch from DB
  const config = await EngineRuntimeConfigModel.findOne();
  
  if (!config) {
    // Fallback to safe defaults
    return {
      mlEnabled: false,
      mlMode: 'off',
      updatedAt: new Date(),
    };
  }
  
  // Update cache
  configCache = {
    mlEnabled: config.mlEnabled,
    mlMode: config.mlMode,
    disabledBy: config.disabledBy,
    disableReason: config.disableReason,
    updatedAt: config.updatedAt,
  };
  cacheTimestamp = now;
  
  return configCache;
}

/**
 * Update runtime config
 */
export async function updateRuntimeConfig(
  update: Partial<RuntimeConfig> & { updatedBy?: string }
): Promise<RuntimeConfig> {
  // Validate mlMode
  if (update.mlMode && !['off', 'advisor', 'assist'].includes(update.mlMode)) {
    throw new Error('Invalid mlMode. Must be: off, advisor, or assist');
  }
  
  // Validate consistency
  if (update.mlEnabled === false && update.mlMode && update.mlMode !== 'off') {
    throw new Error('Cannot set mlMode if mlEnabled is false');
  }
  
  // Update in DB
  const result = await EngineRuntimeConfigModel.findOneAndUpdate(
    {},
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
    },
    { 
      new: true,
      upsert: true,
    }
  );
  
  // Invalidate cache
  invalidateCache();
  
  console.log('[Engine Runtime] Config updated:', {
    mlEnabled: result.mlEnabled,
    mlMode: result.mlMode,
    updatedBy: update.updatedBy,
  });
  
  return {
    mlEnabled: result.mlEnabled,
    mlMode: result.mlMode,
    disabledBy: result.disabledBy,
    disableReason: result.disableReason,
    updatedAt: result.updatedAt,
  };
}

/**
 * Invalidate config cache
 */
export function invalidateCache() {
  configCache = null;
  cacheTimestamp = 0;
}

/**
 * Check if Kill Switch is active
 * 
 * Criteria:
 * - Agreement < 70%
 * - Flip rate > 10%
 * - Distribution shift > 20%
 * - Regression detected
 */
export async function checkKillSwitch(): Promise<boolean> {
  try {
    // Get recent decisions (last 100)
    const recentDecisions = await EngineDecisionModel.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    if (recentDecisions.length < 50) {
      // Not enough data to assess
      return false;
    }
    
    // Calculate metrics
    const metrics = calculateMLMetrics(recentDecisions);
    
    // Check thresholds
    const shouldKill = (
      metrics.agreement < 0.70 ||
      metrics.flipRate > 0.10 ||
      metrics.distributionShift > 0.20 ||
      metrics.regressionDetected
    );
    
    if (shouldKill) {
      console.warn('[Kill Switch] Triggered!', metrics);
    }
    
    return shouldKill;
  } catch (err) {
    console.error('[Kill Switch] Error checking:', err);
    return false; // Fail safe
  }
}

/**
 * Calculate ML quality metrics
 */
function calculateMLMetrics(decisions: any[]) {
  // Placeholder implementation
  // In production, this would analyze ML predictions vs actual outcomes
  
  // For now, return safe defaults
  return {
    agreement: 0.85,
    flipRate: 0.05,
    distributionShift: 0.10,
    regressionDetected: false,
  };
}

/**
 * Auto-disable ML if Kill Switch triggers
 */
export async function checkAndUpdateKillSwitch() {
  const killSwitchActive = await checkKillSwitch();
  
  if (killSwitchActive) {
    await updateRuntimeConfig({
      mlEnabled: false,
      mlMode: 'off',
      disabledBy: 'system',
      disableReason: 'Kill Switch triggered - quality degradation detected',
      updatedBy: 'system',
    });
    
    // TODO: Alert operator
    console.error('[Kill Switch] ML auto-disabled');
  }
}
