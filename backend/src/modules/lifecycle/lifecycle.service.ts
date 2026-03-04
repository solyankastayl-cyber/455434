/**
 * UNIFIED LIFECYCLE SERVICE — L2 Enhanced
 * 
 * Core service for lifecycle state management with observability
 */

import { Db, Collection } from 'mongodb';
import {
  ModelId,
  SystemMode,
  LifecycleStatus,
  DriftSeverity,
  ModelLifecycleState,
  LifecycleEvent,
  LifecycleEventType,
  LifecycleConfig,
  LifecycleDiagnostics,
  CombinedReadiness,
  DEFAULT_LIFECYCLE_CONFIG,
  createDefaultState,
} from './lifecycle.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STATE_COLLECTION = 'model_lifecycle_state';
const EVENTS_COLLECTION = 'model_lifecycle_events';

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class UnifiedLifecycleService {
  private stateCollection: Collection<any>;
  private eventsCollection: Collection<any>;
  private config: LifecycleConfig;
  
  constructor(private db: Db, config?: Partial<LifecycleConfig>) {
    this.stateCollection = db.collection(STATE_COLLECTION);
    this.eventsCollection = db.collection(EVENTS_COLLECTION);
    this.config = { ...DEFAULT_LIFECYCLE_CONFIG, ...config };
    
    console.log(`[Lifecycle] Service initialized (mode=${this.config.systemMode})`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.stateCollection.createIndex(
      { modelId: 1 },
      { unique: true, name: 'idx_lifecycle_model' }
    );
    
    await this.eventsCollection.createIndex(
      { modelId: 1, ts: -1 },
      { name: 'idx_lifecycle_events' }
    );
    
    await this.eventsCollection.createIndex(
      { type: 1, ts: -1 },
      { name: 'idx_lifecycle_events_type' }
    );
    
    console.log('[Lifecycle] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  async getState(modelId: ModelId): Promise<ModelLifecycleState | null> {
    return this.stateCollection.findOne({ modelId });
  }
  
  async getAllStates(): Promise<ModelLifecycleState[]> {
    return this.stateCollection.find({}).toArray();
  }
  
  async updateState(
    modelId: ModelId,
    update: Partial<ModelLifecycleState>
  ): Promise<ModelLifecycleState> {
    const now = new Date().toISOString();
    
    // Check if document exists first
    const existing = await this.stateCollection.findOne({ modelId });
    
    if (!existing) {
      // Create new document
      const newDoc = {
        ...createDefaultState(modelId),
        ...update,
        modelId,
        createdAt: now,
        updatedAt: now,
      };
      await this.stateCollection.insertOne(newDoc);
      return newDoc as unknown as ModelLifecycleState;
    }
    
    // Update existing document
    const result = await this.stateCollection.findOneAndUpdate(
      { modelId },
      {
        $set: {
          ...update,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );
    
    return result as unknown as ModelLifecycleState;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  
  async addEvent(
    modelId: ModelId,
    type: LifecycleEventType,
    actor: 'SYSTEM' | 'ADMIN' | 'CRON' = 'SYSTEM',
    meta?: Record<string, any>
  ): Promise<void> {
    const event: LifecycleEvent = {
      modelId,
      engineVersion: 'v2.1',
      ts: new Date().toISOString(),
      type,
      actor,
      meta,
    };
    
    await this.eventsCollection.insertOne(event);
    console.log(`[Lifecycle] Event: ${modelId} ${type} by ${actor}`);
  }
  
  async getEvents(modelId: ModelId, limit: number = 100): Promise<LifecycleEvent[]> {
    return this.eventsCollection
      .find({ modelId })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray() as unknown as LifecycleEvent[];
  }
  
  async getAllEvents(limit: number = 200): Promise<LifecycleEvent[]> {
    return this.eventsCollection
      .find({})
      .sort({ ts: -1 })
      .limit(limit)
      .toArray() as unknown as LifecycleEvent[];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS TRANSITIONS
  // ═══════════════════════════════════════════════════════════════
  
  async transition(
    modelId: ModelId,
    newStatus: LifecycleStatus,
    reason: string,
    actor: 'SYSTEM' | 'ADMIN' = 'SYSTEM',
    note?: string
  ): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    const current = await this.getState(modelId);
    const fromStatus = current?.status || 'SIMULATION';
    
    const now = new Date().toISOString();
    
    const state = await this.updateState(modelId, {
      status: newStatus,
      lastTransition: {
        from: fromStatus,
        to: newStatus,
        reason,
        actor,
        timestamp: now,
        note,
      },
    });
    
    return { success: true, state };
  }
  
  // Alias methods for routes compatibility
  async startWarmup(modelId: ModelId): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    return this.forceWarmup(modelId, 30);
  }
  
  async forceRevoke(modelId: ModelId, note?: string): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    return this.revoke(modelId, note || 'Force revoked by admin');
  }
  
  async validateForPromotion(modelId: ModelId): Promise<{ eligible: boolean; blockers: string[] }> {
    const diagnostics = await this.getDiagnostics(modelId);
    if (!diagnostics) {
      return { eligible: false, blockers: ['Model not found'] };
    }
    return {
      eligible: diagnostics.applyEligible,
      blockers: diagnostics.applyBlockers,
    };
  }
  
  async checkAndPromote(modelId: ModelId): Promise<{ promoted: boolean; reason: string }> {
    return this.checkAutoApply(modelId).then(r => ({
      promoted: r.applied,
      reason: r.reason,
    }));
  }
  
  async getRecentEvents(modelId: ModelId, limit: number = 50): Promise<LifecycleEvent[]> {
    return this.getEvents(modelId, limit);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════
  
  async forceWarmup(modelId: ModelId, targetDays: number = 30): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    const current = await this.getState(modelId);
    
    if (current?.systemMode === 'DEV') {
      // В DEV режиме warmup не имеет смысла, но разрешаем для тестирования
      console.log(`[Lifecycle] Warning: Starting warmup in DEV mode for ${modelId}`);
    }
    
    const now = new Date().toISOString();
    
    const state = await this.updateState(modelId, {
      status: 'WARMUP',
      warmup: {
        startedAt: now,
        targetDays,
        resolvedDays: 0,
        progressPct: 0,
      },
    });
    
    await this.addEvent(modelId, 'FORCE_WARMUP', 'ADMIN', { targetDays });
    
    return { success: true, state };
  }
  
  async forceApply(modelId: ModelId, reason: string): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    const current = await this.getState(modelId);
    const blockers: string[] = [];
    
    // Check protections (relaxed in DEV)
    if (current?.systemMode === 'PROD') {
      if ((current?.live?.liveSamples || 0) < this.config.autoApply.minSamples) {
        blockers.push(`Not enough live samples (${current?.live?.liveSamples || 0} < ${this.config.autoApply.minSamples})`);
      }
      
      if (current?.drift?.severity === 'CRITICAL') {
        blockers.push('Critical drift detected');
      }
    }
    
    if (blockers.length > 0 && current?.systemMode === 'PROD') {
      await this.addEvent(modelId, 'FORCE_APPLY', 'ADMIN', { blocked: true, blockers, reason });
      return { success: false, error: `Cannot apply: ${blockers.join(', ')}` };
    }
    
    const now = new Date().toISOString();
    
    const state = await this.updateState(modelId, {
      status: 'APPLIED_MANUAL',
      governanceAppliedAt: now,
    });
    
    await this.addEvent(modelId, 'FORCE_APPLY', 'ADMIN', { reason });
    
    return { success: true, state };
  }
  
  async revoke(modelId: ModelId, reason: string): Promise<{ success: boolean; state?: ModelLifecycleState }> {
    const state = await this.updateState(modelId, {
      status: 'REVOKED',
    });
    
    await this.addEvent(modelId, 'REVOKE', 'ADMIN', { reason });
    
    return { success: true, state };
  }
  
  async resetSimulation(modelId: ModelId, reason: string): Promise<{ success: boolean; error?: string; state?: ModelLifecycleState }> {
    const current = await this.getState(modelId);
    
    if (current?.systemMode === 'PROD') {
      return { success: false, error: 'Cannot reset to simulation in PROD mode' };
    }
    
    const state = await this.updateState(modelId, {
      status: 'SIMULATION',
      warmup: {
        startedAt: null,
        targetDays: 30,
        resolvedDays: 0,
        progressPct: 0,
      },
    });
    
    await this.addEvent(modelId, 'RESET_SIMULATION', 'ADMIN', { reason });
    
    return { success: true, state };
  }
  
  // DEV only: enable truth mode for all models
  async enableDevTruthMode(): Promise<void> {
    for (const modelId of ['BTC', 'SPX'] as ModelId[]) {
      await this.updateState(modelId, {
        status: 'SIMULATION',
        systemMode: 'DEV',
      });
    }
    
    await this.addEvent('BTC', 'DEV_TRUTH_MODE', 'ADMIN');
    await this.addEvent('SPX', 'DEV_TRUTH_MODE', 'ADMIN');
    
    console.log('[Lifecycle] DEV truth mode enabled for all models');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // AUTO-APPLY (for daily runner)
  // ═══════════════════════════════════════════════════════════════
  
  async checkAutoApply(modelId: ModelId): Promise<{ applied: boolean; reason: string }> {
    const state = await this.getState(modelId);
    
    if (!state) {
      return { applied: false, reason: 'State not found' };
    }
    
    if (state.systemMode !== 'PROD') {
      return { applied: false, reason: 'Not in PROD mode' };
    }
    
    if (state.status !== 'WARMUP') {
      return { applied: false, reason: 'Not in WARMUP status' };
    }
    
    const liveSamples = state.live?.liveSamples || 0;
    const minSamples = this.config.autoApply.minSamples;
    
    if (liveSamples < minSamples) {
      return { applied: false, reason: `Need ${minSamples - liveSamples} more samples` };
    }
    
    if (state.drift?.severity === 'CRITICAL') {
      return { applied: false, reason: 'Critical drift blocks auto-apply' };
    }
    
    // All checks passed — auto apply
    await this.updateState(modelId, {
      status: 'APPLIED',
      governanceAppliedAt: new Date().toISOString(),
    });
    
    await this.addEvent(modelId, 'AUTO_APPLY', 'SYSTEM', { liveSamples });
    
    return { applied: true, reason: 'Auto-applied after meeting all criteria' };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // WARMUP PROGRESS
  // ═══════════════════════════════════════════════════════════════
  
  async incrementWarmupDay(modelId: ModelId): Promise<{ success: boolean; daysCompleted: number; complete: boolean }> {
    const state = await this.getState(modelId);
    
    if (!state || state.status !== 'WARMUP') {
      return { success: false, daysCompleted: 0, complete: false };
    }
    
    const newDays = (state.warmup?.resolvedDays || 0) + 1;
    const targetDays = state.warmup?.targetDays || 30;
    const progressPct = Math.min(100, Math.round((newDays / targetDays) * 100));
    
    await this.updateState(modelId, {
      warmup: {
        ...state.warmup,
        resolvedDays: newDays,
        progressPct,
      },
    });
    
    await this.addEvent(modelId, 'WARMUP_PROGRESS', 'CRON', { day: newDays, progressPct });
    
    return {
      success: true,
      daysCompleted: newDays,
      complete: newDays >= targetDays,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DRIFT
  // ═══════════════════════════════════════════════════════════════
  
  async updateDrift(modelId: ModelId, severity: DriftSeverity, details?: Record<string, any>): Promise<void> {
    const state = await this.getState(modelId);
    const oldSeverity = state?.drift?.severity || 'OK';
    
    await this.updateState(modelId, {
      drift: {
        severity,
        lastCheckedAt: new Date().toISOString(),
        ...details,
      },
    });
    
    // Log event if severity changed
    if (severity !== oldSeverity) {
      if (severity === 'CRITICAL') {
        await this.addEvent(modelId, 'DRIFT_CRITICAL', 'SYSTEM', { oldSeverity, newSeverity: severity, ...details });
        
        // Auto-revoke on critical drift in PROD
        if (state?.systemMode === 'PROD' && this.config.autoRevoke.onCriticalDrift) {
          if (state?.status === 'APPLIED' || state?.status === 'APPLIED_MANUAL') {
            await this.revoke(modelId, 'Auto-revoked due to critical drift');
          }
        }
      } else if (severity === 'WARN') {
        await this.addEvent(modelId, 'DRIFT_WARN', 'SYSTEM', { oldSeverity, newSeverity: severity, ...details });
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════
  
  async getDiagnostics(modelId: ModelId): Promise<LifecycleDiagnostics | null> {
    const state = await this.getState(modelId);
    
    if (!state) return null;
    
    const blockers: string[] = [];
    
    // Check apply eligibility
    if (state.systemMode === 'PROD') {
      if ((state.live?.liveSamples || 0) < this.config.autoApply.minSamples) {
        blockers.push(`Need ${this.config.autoApply.minSamples - (state.live?.liveSamples || 0)} more live samples`);
      }
      if (state.drift?.severity === 'CRITICAL') {
        blockers.push('Critical drift detected');
      }
    }
    
    return {
      modelId: state.modelId,
      status: state.status,
      systemMode: state.systemMode,
      
      applyEligible: blockers.length === 0,
      applyBlockers: blockers,
      
      historicalSharpe: state.historicalMetrics?.sharpe,
      liveSharpe: state.liveMetrics?.sharpe,
      sharpeDeviation: state.historicalMetrics?.sharpe && state.liveMetrics?.sharpe
        ? (state.liveMetrics.sharpe - state.historicalMetrics.sharpe) / state.historicalMetrics.sharpe
        : undefined,
      
      historicalHitRate: state.historicalMetrics?.hitRate,
      liveHitRate: state.liveMetrics?.hitRate,
      hitRateDeviation: state.historicalMetrics?.hitRate && state.liveMetrics?.hitRate
        ? state.liveMetrics.hitRate - state.historicalMetrics.hitRate
        : undefined,
      
      constitutionHash: state.constitutionHash,
      governanceLocked: !!state.governanceAppliedAt,
      
      driftSeverity: state.drift?.severity || 'OK',
      lastDriftCheck: state.drift?.lastCheckedAt || null,
      
      liveSamples: state.live?.liveSamples || 0,
      requiredSamples: this.config.autoApply.minSamples,
      
      lastDailyRun: state.lastOps?.dailyRunAt || null,
      lastCalibration: state.lastOps?.calibrationAt || null,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // COMBINED READINESS
  // ═══════════════════════════════════════════════════════════════
  
  async getCombinedReadiness(): Promise<CombinedReadiness> {
    const states = await this.getAllStates();
    
    const btc = states.find(s => s.modelId === 'BTC');
    const spx = states.find(s => s.modelId === 'SPX');
    
    const blockers: string[] = [];
    let suggestedAction: string | undefined;
    
    if (!this.config.enableCombined) {
      blockers.push('ENABLE_COMBINED=false');
    }
    
    if (!btc || (btc.status !== 'APPLIED' && btc.status !== 'APPLIED_MANUAL')) {
      blockers.push(`BTC not APPLIED (status: ${btc?.status || 'NONE'})`);
      if (btc?.status === 'SIMULATION') suggestedAction = 'Start BTC Warmup';
    }
    
    if (!spx || (spx.status !== 'APPLIED' && spx.status !== 'APPLIED_MANUAL')) {
      blockers.push(`SPX not APPLIED (status: ${spx?.status || 'NONE'})`);
      if (spx?.status === 'SIMULATION' && !suggestedAction) suggestedAction = 'Start SPX Warmup';
    }
    
    if (btc?.systemMode !== 'PROD') {
      blockers.push('BTC not in PROD mode');
    }
    
    if (spx?.systemMode !== 'PROD') {
      blockers.push('SPX not in PROD mode');
    }
    
    const ready = blockers.length === 0;
    
    return {
      ready,
      btcStatus: btc?.status || null,
      spxStatus: spx?.status || null,
      blockers,
      suggestedAction,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SIMULATION (DEV only)
  // ═══════════════════════════════════════════════════════════════
  
  async simulateStatus(modelId: ModelId, status: LifecycleStatus): Promise<ModelLifecycleState> {
    const state = await this.updateState(modelId, {
      status,
      systemMode: 'DEV',
    });
    
    return state;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let lifecycleServiceInstance: UnifiedLifecycleService | null = null;

export function getUnifiedLifecycleService(
  db: Db,
  config?: Partial<LifecycleConfig>
): UnifiedLifecycleService {
  if (!lifecycleServiceInstance) {
    lifecycleServiceInstance = new UnifiedLifecycleService(db, config);
  }
  return lifecycleServiceInstance;
}

console.log('[Lifecycle] Service loaded (L1+L2)');
