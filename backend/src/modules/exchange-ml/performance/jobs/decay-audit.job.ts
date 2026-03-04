/**
 * Exchange Horizon Bias — Decay Audit Job
 * 
 * Logs decay state changes every 6 hours.
 * 
 * KEY PRINCIPLE: NO event spam
 * - Only logs when state CHANGES
 * - Not on every inference
 * - Maximum ~4 events/day per horizon (if state is unstable)
 */

import cron from 'node-cron';
import { Db, Collection } from 'mongodb';
import { HorizonPerformanceService, getHorizonPerformanceService } from '../horizon-performance.service.js';
import { DecayState } from '../config/decay.config.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DecayAuditEvent {
  kind: 'EXCH_BIAS_DECAY_STATE';
  horizon: string;
  payload: {
    state: DecayState;
    previousState?: DecayState;
    effectiveSampleCount: number;
    tauDays: number;
    rawBias: number;
    decayedBias: number;
    rawWinRate: number;
    decayedWinRate: number;
  };
  createdAt: Date;
}

type ExchangeHorizon = '1D' | '7D' | '30D';

// ═══════════════════════════════════════════════════════════════
// AUDIT JOB
// ═══════════════════════════════════════════════════════════════

export class ExchangeDecayAuditJob {
  private eventsCollection: Collection<DecayAuditEvent>;
  private performanceService: HorizonPerformanceService;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;
  
  // In-memory cache of last known states (to detect changes)
  private lastStates: Map<string, DecayState> = new Map();
  
  constructor(private db: Db) {
    this.eventsCollection = db.collection('exchange_model_events');
    this.performanceService = getHorizonPerformanceService(db);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Start the audit job (runs every 6 hours).
   */
  start(): void {
    if (this.cronJob) {
      console.log('[DecayAudit] Job already running');
      return;
    }
    
    // Load last states from DB
    this.loadLastStates().then(() => {
      // Run every 6 hours at minute 30
      this.cronJob = cron.schedule('30 */6 * * *', async () => {
        await this.runAudit();
      }, { timezone: 'UTC' });
      
      console.log('[DecayAudit] Job started (every 6 hours)');
    });
  }
  
  /**
   * Stop the audit job.
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('[DecayAudit] Job stopped');
    }
  }
  
  /**
   * Get job status.
   */
  getStatus(): { running: boolean; lastStates: Record<string, DecayState> } {
    return {
      running: !!this.cronJob,
      lastStates: Object.fromEntries(this.lastStates),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // AUDIT LOGIC
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run audit for all horizons.
   */
  async runAudit(): Promise<{ eventsLogged: number }> {
    if (this.isRunning) {
      console.log('[DecayAudit] Already running, skipping');
      return { eventsLogged: 0 };
    }
    
    this.isRunning = true;
    let eventsLogged = 0;
    
    try {
      const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
      
      for (const horizon of horizons) {
        const logged = await this.auditHorizon(horizon);
        if (logged) eventsLogged++;
      }
      
      console.log(`[DecayAudit] Audit complete: ${eventsLogged} events logged`);
    } catch (err) {
      console.error('[DecayAudit] Audit error:', err);
    } finally {
      this.isRunning = false;
    }
    
    return { eventsLogged };
  }
  
  /**
   * Audit a single horizon.
   * @returns true if event was logged
   */
  private async auditHorizon(horizon: ExchangeHorizon): Promise<boolean> {
    try {
      const perf = await this.performanceService.getPerformanceWithDecay(horizon);
      const currentState = perf.decay.state;
      const lastState = this.lastStates.get(horizon);
      
      // Only log if state changed
      if (lastState === currentState) {
        return false;
      }
      
      // Log event
      const event: DecayAuditEvent = {
        kind: 'EXCH_BIAS_DECAY_STATE',
        horizon,
        payload: {
          state: currentState,
          previousState: lastState,
          effectiveSampleCount: perf.decay.effectiveSampleCount,
          tauDays: perf.decay.tauDays,
          rawBias: perf.raw.biasScore,
          decayedBias: perf.decay.biasScore,
          rawWinRate: perf.raw.winRate,
          decayedWinRate: perf.decay.winRate,
        },
        createdAt: new Date(),
      };
      
      await this.eventsCollection.insertOne(event as any);
      
      // Update cache
      this.lastStates.set(horizon, currentState);
      
      console.log(`[DecayAudit] ${horizon}: ${lastState || 'UNKNOWN'} → ${currentState}`);
      
      return true;
    } catch (err) {
      console.error(`[DecayAudit] Error auditing ${horizon}:`, err);
      return false;
    }
  }
  
  /**
   * Load last known states from database.
   */
  private async loadLastStates(): Promise<void> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    
    for (const horizon of horizons) {
      try {
        const lastEvent = await this.eventsCollection.findOne(
          { kind: 'EXCH_BIAS_DECAY_STATE', horizon },
          { sort: { createdAt: -1 } }
        );
        
        if (lastEvent?.payload?.state) {
          this.lastStates.set(horizon, lastEvent.payload.state);
        }
      } catch (err) {
        // Ignore - will treat as unknown state
      }
    }
    
    console.log('[DecayAudit] Loaded last states:', Object.fromEntries(this.lastStates));
  }
  
  /**
   * Ensure indexes for audit events.
   */
  async ensureIndexes(): Promise<void> {
    await this.eventsCollection.createIndex({ kind: 1, horizon: 1, createdAt: -1 });
    console.log('[DecayAudit] Indexes ensured');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let auditJobInstance: ExchangeDecayAuditJob | null = null;

export function getExchangeDecayAuditJob(db: Db): ExchangeDecayAuditJob {
  if (!auditJobInstance) {
    auditJobInstance = new ExchangeDecayAuditJob(db);
  }
  return auditJobInstance;
}

console.log('[Exchange ML] Decay Audit Job loaded');
