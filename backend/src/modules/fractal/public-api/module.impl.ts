/**
 * FRACTAL MODULE — Implementation
 * 
 * This is the concrete implementation of the FractalModule interface.
 * It wraps all internal services and exposes only the public API.
 * 
 * IMPORTANT: This module receives its dependencies via injection.
 * It does NOT create its own MongoDB connection or read process.env directly.
 * 
 * @version v2.0-fractal-stable
 */

import type {
  FractalModule,
  FractalConfig,
  Scope,
  Horizon,
  DashboardDto,
  ForecastDto,
  DriftDto,
  HealthDto,
  JobResult,
  FreezeManifest
} from './types.js';

import { getMongoDb } from '../../../db/mongoose.js';
import freezeManifestJson from '../../../../freeze/freeze-manifest.json' assert { type: 'json' };

// ═══════════════════════════════════════════════════════════════
// FRACTAL MODULE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class FractalModuleImpl implements FractalModule {
  private readonly config: FractalConfig;
  private initialized: boolean = false;
  private readonly version = 'v2.0-fractal-stable';
  
  constructor(config: FractalConfig) {
    this.config = config;
    this.initialized = true;
    console.log(`[FractalModule] Initialized. Frozen: ${config.frozen}, Version: ${config.freezeVersion}`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════
  
  async getDashboard(scope: Scope): Promise<DashboardDto> {
    const db = this.getDb();
    const timestamp = new Date().toISOString();
    
    // Get model config
    const modelConfig = await db.collection('model_config').findOne({ scope });
    
    // Get lifecycle state
    const lifecycleState = await db.collection('model_lifecycle_state').findOne({ scope });
    
    // Get health state
    const healthState = await db.collection('model_health_state').findOne({ scope });
    
    // Get latest drift
    const driftDoc = await db.collection('model_drift_state').findOne(
      { scope },
      { sort: { timestamp: -1 } }
    );
    
    // Get latest signal/prediction
    const signalDoc = await db.collection('prediction_snapshots').findOne(
      { scope },
      { sort: { timestamp: -1 } }
    );
    
    return {
      scope,
      timestamp,
      frozen: this.config.frozen,
      
      signal: {
        direction: signalDoc?.direction || 'NEUTRAL',
        confidence: signalDoc?.confidence || 0,
        horizon: signalDoc?.horizon || this.getDefaultHorizon(scope),
        matchCount: signalDoc?.matchCount || 0
      },
      
      health: {
        grade: healthState?.grade || 'HEALTHY',
        hitRate: healthState?.hitRate || 0,
        avgAbsError: healthState?.avgAbsError || 0,
        sampleCount: healthState?.sampleCount || 0,
        lastUpdated: healthState?.updatedAt || timestamp
      },
      
      drift: {
        severity: driftDoc?.severity || 'OK',
        delta: driftDoc?.delta || 0,
        trend: driftDoc?.trend || 'STABLE'
      },
      
      lifecycle: {
        currentVersion: lifecycleState?.currentVersion || this.config.freezeVersion,
        state: lifecycleState?.state || 'ACTIVE',
        lastPromoted: lifecycleState?.lastPromoted || null
      }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TERMINAL (FORECAST)
  // ═══════════════════════════════════════════════════════════════
  
  async getTerminal(scope: Scope, horizon: Horizon): Promise<ForecastDto> {
    const db = this.getDb();
    const timestamp = new Date().toISOString();
    
    // Get latest signal for this scope and horizon
    const signalDoc = await db.collection('prediction_snapshots').findOne(
      { scope, horizon },
      { sort: { timestamp: -1 } }
    );
    
    // Get regime context
    const regimeDoc = await db.collection('regime_state').findOne({ scope });
    
    return {
      scope,
      horizon,
      timestamp,
      
      forecast: {
        direction: signalDoc?.direction || 'NEUTRAL',
        confidence: signalDoc?.confidence || 0,
        expectedMove: signalDoc?.expectedMove || 0,
        expectedMovePercent: signalDoc?.expectedMovePercent || 0
      },
      
      matches: {
        count: signalDoc?.matchCount || 0,
        avgSimilarity: signalDoc?.avgSimilarity || 0,
        topMatchDate: signalDoc?.topMatchDate || '',
        topMatchSimilarity: signalDoc?.topMatchSimilarity || 0
      },
      
      context: {
        regime: regimeDoc?.currentRegime || 'UNKNOWN',
        volatility: regimeDoc?.volatility || 'MEDIUM',
        phase: regimeDoc?.phase || 'ACCUMULATION'
      }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DRIFT
  // ═══════════════════════════════════════════════════════════════
  
  async getDrift(scope: Scope): Promise<DriftDto> {
    const db = this.getDb();
    const timestamp = new Date().toISOString();
    
    // Get overall drift
    const driftDoc = await db.collection('model_drift_state').findOne(
      { scope },
      { sort: { timestamp: -1 } }
    );
    
    // Get drift by horizon
    const driftByHorizon = await db.collection('drift_by_horizon')
      .find({ scope })
      .sort({ horizon: 1 })
      .toArray();
    
    // Get rolling drift
    const rollingDrift = await db.collection('drift_rolling')
      .findOne({ scope }, { sort: { timestamp: -1 } });
    
    return {
      scope,
      timestamp,
      
      overall: {
        severity: driftDoc?.severity || 'OK',
        delta: driftDoc?.delta || 0,
        trend: driftDoc?.trend || 'STABLE'
      },
      
      byHorizon: driftByHorizon.map((d: any) => ({
        horizon: d.horizon,
        severity: d.severity || 'OK',
        delta: d.delta || 0
      })),
      
      rolling: {
        window: rollingDrift?.window || 30,
        avgDelta: rollingDrift?.avgDelta || 0,
        maxDelta: rollingDrift?.maxDelta || 0
      }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════════
  
  async getHealth(scope: Scope): Promise<HealthDto> {
    const db = this.getDb();
    const timestamp = new Date().toISOString();
    
    // Get health state
    const healthState = await db.collection('model_health_state').findOne({ scope });
    
    // Get health by horizon
    const healthByHorizon = await db.collection('health_by_horizon')
      .find({ scope })
      .sort({ horizon: 1 })
      .toArray();
    
    // Calculate stale hours
    const lastUpdated = healthState?.updatedAt ? new Date(healthState.updatedAt) : new Date();
    const staleHours = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60));
    
    // Build alerts
    const alerts: HealthDto['alerts'] = [];
    
    if (staleHours > 168) {
      alerts.push({
        type: 'STALE_DATA',
        message: `Data is ${staleHours} hours old (threshold: 168h)`,
        severity: 'WARNING'
      });
    }
    
    if (healthState?.hitRate && healthState.hitRate < 0.45) {
      alerts.push({
        type: 'LOW_HIT_RATE',
        message: `Hit rate is ${(healthState.hitRate * 100).toFixed(1)}% (threshold: 45%)`,
        severity: healthState.hitRate < 0.40 ? 'CRITICAL' : 'WARNING'
      });
    }
    
    return {
      scope,
      timestamp,
      
      grade: healthState?.grade || 'HEALTHY',
      
      metrics: {
        hitRate: healthState?.hitRate || 0,
        avgAbsError: healthState?.avgAbsError || 0,
        sampleCount: healthState?.sampleCount || 0,
        staleHours
      },
      
      byHorizon: healthByHorizon.map((h: any) => ({
        horizon: h.horizon,
        grade: h.grade || 'HEALTHY',
        hitRate: h.hitRate || 0,
        sampleCount: h.sampleCount || 0
      })),
      
      alerts
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAINTENANCE JOBS
  // ═══════════════════════════════════════════════════════════════
  
  async runMaintenanceJob(type: 'resolve' | 'health' | 'full'): Promise<JobResult> {
    const startTime = Date.now();
    
    // Map job type to internal job name
    const jobMap: Record<string, string> = {
      'resolve': 'resolve_matured',
      'health': 'health',
      'full': 'full'
    };
    
    const jobName = jobMap[type];
    
    if (!this.config.allowedJobs.includes(jobName)) {
      return {
        success: false,
        job: type,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        details: {
          message: `Job '${type}' is not allowed in current configuration`
        }
      };
    }
    
    try {
      // Import and run the job
      const { runAdminJob } = await import('../../jobs/admin_jobs.service.js');
      const result = await runAdminJob(jobName);
      
      return {
        success: result.success !== false,
        job: type,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        details: {
          processed: result.processed || 0,
          resolved: result.resolved || 0,
          errors: result.errors || 0,
          message: result.message
        }
      };
    } catch (error: any) {
      return {
        success: false,
        job: type,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        details: {
          message: error.message || 'Unknown error'
        }
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // FREEZE STATUS
  // ═══════════════════════════════════════════════════════════════
  
  isFrozen(): boolean {
    return this.config.frozen;
  }
  
  getFreezeManifest(): FreezeManifest {
    return freezeManifestJson as FreezeManifest;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════
  
  getMetadata() {
    return {
      version: this.version,
      frozen: this.config.frozen,
      scopes: ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'] as Scope[],
      initialized: this.initialized
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private getDb() {
    // Use injected adapter if available, otherwise fall back to global
    if (this.config.mongoDb) {
      return this.config.mongoDb.getDb();
    }
    return getMongoDb();
  }
  
  private getDefaultHorizon(scope: Scope): Horizon {
    const defaults: Record<Scope, Horizon> = {
      BTC: '14d',
      SPX: '21d',
      DXY: '10d',
      CROSS_ASSET: '14d'
    };
    return defaults[scope];
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new instance of the Fractal module.
 * 
 * This is the recommended way to instantiate the module.
 * The module receives all its dependencies via config.
 * 
 * @example
 * ```typescript
 * const fractal = createFractalModule({
 *   frozen: true,
 *   freezeVersion: 'v2.0-fractal-stable',
 *   mongoDb: coreDb,
 *   allowedJobs: ['full', 'resolve_matured', 'health']
 * });
 * 
 * const dashboard = await fractal.getDashboard('BTC');
 * ```
 */
export function createFractalModule(config: FractalConfig): FractalModule {
  return new FractalModuleImpl(config);
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Create default config from environment variables.
 * 
 * This is a convenience function for standalone mode.
 * In core integration, config should be provided by the core system.
 */
export function createDefaultConfig(): Omit<FractalConfig, 'mongoDb'> {
  return {
    frozen: process.env.SYSTEM_FROZEN === 'true',
    freezeVersion: process.env.FREEZE_VERSION || 'v2.0-fractal-stable',
    allowedJobs: ['full', 'resolve_matured', 'health', 'health_check'],
    logLevel: (process.env.LOG_LEVEL as any) || 'info'
  };
}
