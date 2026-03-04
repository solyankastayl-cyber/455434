/**
 * ML v2.2: Auto-Retrain Policy Service
 * ML v2.3: Extended with mlVersion support
 * 
 * Собирает метрики и решает "enqueue / skip".
 * 
 * ВАЖНО:
 * - Auto-retrain НИКОГДА не трогает ACTIVE напрямую
 * - Только enqueue в ml_retrain_queue (SHADOW)
 * - Дальше пайплайн BATCH 1-4 делает train → shadow → eval → promote
 * - mlVersion определяет как обучать (v2.1 classic vs v2.3 pruning+weighting)
 */

import { MlRetrainPolicyModel, type IMlRetrainPolicy, DEFAULT_V23_CONFIG } from './ml_retrain_policy.model.js';
import { MlAutoRetrainDecisionModel, type DecisionType, type IDecisionSnapshot } from './ml_auto_retrain_decision.model.js';
import { acquireLock, releaseLock } from './ml_runtime_lock.service.js';
import { MlRetrainQueueModel } from '../ml_retrain_queue.model.js';
import { broadcastAdminEvent } from '../../admin/admin.events.js';
import mongoose from 'mongoose';

type Task = 'market' | 'actor';
type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | null;

export interface EvaluationResult {
  ok: boolean;
  enqueued: boolean;
  reason?: string;
  reasons?: string[];
  jobId?: string;
  mlVersionUsed?: 'v2.1' | 'v2.3';
}

export class AutoRetrainPolicyService {
  
  /**
   * Main entry: evaluate policy and enqueue if triggered
   */
  static async evaluateAndEnqueue(task: Task, network: string): Promise<EvaluationResult> {
    const now = Math.floor(Date.now() / 1000);
    
    // 1) Get policy
    const policy = await MlRetrainPolicyModel.findOne({ task, network }).lean();
    
    if (!policy?.enabled) {
      await this.logDecision(task, network, 'SKIPPED', ['POLICY_DISABLED'], {});
      return { ok: true, enqueued: false, reason: 'POLICY_DISABLED' };
    }

    // 2) Acquire lock (prevent concurrent evaluations)
    const lockId = `auto_retrain:${task}:${network}`;
    const lock = await acquireLock(lockId, 120); // 2 min TTL
    
    if (!lock) {
      await this.logDecision(task, network, 'SKIPPED', ['LOCKED'], {});
      broadcastAdminEvent({
        type: 'AUTO_RETRAIN_SKIPPED',
        meta: { task, network, reason: 'LOCKED' },
        timestamp: Date.now(),
      });
      return { ok: true, enqueued: false, reason: 'LOCKED' };
    }

    try {
      // 3) Check guards (cooldown, max/day, etc.)
      const guardsResult = await this.checkGuards(task, network, policy.guards, now);
      
      if (!guardsResult.ok) {
        await this.logDecision(task, network, 'SKIPPED', guardsResult.reasons, guardsResult.snapshot);
        broadcastAdminEvent({
          type: 'AUTO_RETRAIN_SKIPPED',
          meta: { task, network, reasons: guardsResult.reasons },
          timestamp: Date.now(),
        });
        return { ok: true, enqueued: false, reasons: guardsResult.reasons };
      }

      // 4) Check triggers (accuracy, drift, time)
      const triggersResult = await this.checkTriggers(task, network, policy.triggers, now);
      
      if (!triggersResult.triggered) {
        await this.logDecision(task, network, 'SKIPPED', ['NO_TRIGGER'], triggersResult.snapshot);
        return { ok: true, enqueued: false, reason: 'NO_TRIGGER' };
      }

      // 5) Determine ML version to use
      const mlVersion = policy.mlVersion || 'v2.1';
      const v23Config = mlVersion === 'v2.3' 
        ? (policy.v23Config || DEFAULT_V23_CONFIG)
        : undefined;

      // 6) Enqueue retrain job (SHADOW) with mlVersion
      const job = await MlRetrainQueueModel.create({
        network,
        modelType: task,
        reason: 'AUTO_POLICY',
        status: 'PENDING',
        createdAt: new Date(),
        mlVersion,
        v23Config,
      });

      const snapshot: IDecisionSnapshot = {
        ...triggersResult.snapshot,
        queueJobId: job._id.toString(),
        mlVersionUsed: mlVersion,
        v23ConfigSnapshot: v23Config,
      };

      await this.logDecision(task, network, 'ENQUEUED', triggersResult.reasons, snapshot, mlVersion);
      
      broadcastAdminEvent({
        type: 'AUTO_RETRAIN_ENQUEUED',
        meta: { 
          task, 
          network, 
          jobId: job._id.toString(), 
          reasons: triggersResult.reasons,
          mlVersion,
        },
        timestamp: Date.now(),
      });

      console.log(`[v2.2] Auto-retrain enqueued: ${task}/${network} (${triggersResult.reasons.join(', ')}) [mlVersion=${mlVersion}]`);

      return { 
        ok: true, 
        enqueued: true, 
        jobId: job._id.toString(), 
        reasons: triggersResult.reasons,
        mlVersionUsed: mlVersion,
      };

    } finally {
      await releaseLock(lockId);
    }
  }

  /**
   * Check guards (cooldown, max jobs per day)
   */
  private static async checkGuards(
    task: Task, 
    network: string, 
    guards: IMlRetrainPolicy['guards'],
    now: number
  ): Promise<{ ok: boolean; reasons: string[]; snapshot: IDecisionSnapshot }> {
    const reasons: string[] = [];
    const snapshot: IDecisionSnapshot = {};

    // Check cooldown - find last completed retrain
    const lastDone = await MlRetrainQueueModel.findOne({ 
      modelType: task, 
      network,
      status: 'DONE' 
    }).sort({ finishedAt: -1 }).lean();

    if (lastDone?.finishedAt) {
      const finishedTs = Math.floor(new Date(lastDone.finishedAt).getTime() / 1000);
      const minutesSinceRetrain = (now - finishedTs) / 60;
      snapshot.minutesSinceRetrain = Math.round(minutesSinceRetrain);
      
      if (minutesSinceRetrain < guards.cooldownMinutes) {
        reasons.push('COOLDOWN');
      }
    }

    // Check max jobs per day
    const dayAgo = now - 86400;
    const dayAgoDate = new Date(dayAgo * 1000);
    
    const jobs24h = await MlRetrainQueueModel.countDocuments({ 
      modelType: task, 
      network,
      createdAt: { $gte: dayAgoDate }
    });
    
    snapshot.jobs24h = jobs24h;
    
    if (jobs24h >= guards.maxJobsPerDay) {
      reasons.push('MAX_JOBS_PER_DAY');
    }

    snapshot.minRows = guards.minRows;

    return { ok: reasons.length === 0, reasons, snapshot };
  }

  /**
   * Check triggers (accuracy drop, drift, time elapsed)
   */
  private static async checkTriggers(
    task: Task,
    network: string,
    triggers: IMlRetrainPolicy['triggers'],
    now: number
  ): Promise<{ triggered: boolean; reasons: string[]; snapshot: IDecisionSnapshot }> {
    const reasons: string[] = [];
    const snapshot: IDecisionSnapshot = {};

    // Accuracy trigger
    if (triggers.accuracy?.enabled && triggers.accuracy.minAccuracy7d) {
      const accuracy7d = await this.getAccuracy7d(task, network);
      snapshot.accuracy7d = accuracy7d ?? undefined;
      
      if (accuracy7d !== null && accuracy7d < triggers.accuracy.minAccuracy7d) {
        reasons.push('ACCURACY_DROP');
      }
    }

    // Drift trigger
    if (triggers.drift?.enabled && triggers.drift.minLevel) {
      const driftLevel = await this.getDriftLevel(task, network);
      snapshot.driftLevel = driftLevel ?? undefined;
      
      if (driftLevel && this.levelGte(driftLevel, triggers.drift.minLevel)) {
        reasons.push('DRIFT_HIGH');
      }
    }

    // Time elapsed trigger
    if (triggers.time?.enabled && triggers.time.maxHoursSinceRetrain) {
      const lastDone = await MlRetrainQueueModel.findOne({ 
        modelType: task, 
        network,
        status: 'DONE' 
      }).sort({ finishedAt: -1 }).lean();

      let hoursSinceRetrain = 999999;
      
      if (lastDone?.finishedAt) {
        const finishedTs = Math.floor(new Date(lastDone.finishedAt).getTime() / 1000);
        hoursSinceRetrain = (now - finishedTs) / 3600;
      }
      
      snapshot.hoursSinceRetrain = Math.round(hoursSinceRetrain);
      
      if (hoursSinceRetrain > triggers.time.maxHoursSinceRetrain) {
        reasons.push('TIME_ELAPSED');
      }
    }

    return { triggered: reasons.length > 0, reasons, snapshot };
  }

  /**
   * Log decision to database
   */
  private static async logDecision(
    task: Task,
    network: string,
    decision: DecisionType,
    reasons: string[],
    snapshot: IDecisionSnapshot,
    mlVersionUsed?: 'v2.1' | 'v2.3'
  ): Promise<void> {
    await MlAutoRetrainDecisionModel.create({
      ts: Math.floor(Date.now() / 1000),
      task,
      network,
      decision,
      reasons,
      snapshot,
      queueJobId: snapshot.queueJobId,
      mlVersionUsed,
    });
  }

  /**
   * Get 7-day accuracy from ml_accuracy_snapshots
   */
  private static async getAccuracy7d(task: Task, network: string): Promise<number | null> {
    try {
      const db = mongoose.connection.db;
      
      // Try to get from ml_accuracy_snapshots
      const snapshot = await db.collection('ml_accuracy_snapshots').findOne(
        { task, network },
        { sort: { ts: -1 } }
      );
      
      if (snapshot?.metrics?.accuracy7d !== undefined) {
        return snapshot.metrics.accuracy7d;
      }
      
      // Fallback: try ml_signal_outcomes aggregate
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      
      const outcomes = await db.collection('ml_signal_outcomes')
        .find({ 
          task,
          createdAt: { $gte: new Date(weekAgo) }
        })
        .toArray();
      
      if (outcomes.length === 0) return null;
      
      const correct = outcomes.filter(o => o.correct === true).length;
      return correct / outcomes.length;
      
    } catch (err) {
      console.warn(`[v2.2] Failed to get accuracy7d for ${task}/${network}:`, err);
      return null;
    }
  }

  /**
   * Get current drift level from ml_drift_events
   */
  private static async getDriftLevel(task: Task, network: string): Promise<DriftLevel> {
    try {
      const db = mongoose.connection.db;
      
      const event = await db.collection('ml_drift_events').findOne(
        { task, network },
        { sort: { ts: -1 } }
      );
      
      if (event?.level) {
        return event.level as DriftLevel;
      }
      
      return null;
    } catch (err) {
      console.warn(`[v2.2] Failed to get drift level for ${task}/${network}:`, err);
      return null;
    }
  }

  /**
   * Compare drift levels
   */
  private static levelGte(a: string, b: string): boolean {
    const levels: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    return (levels[a] || 0) >= (levels[b] || 0);
  }

  /**
   * Get policy for a task/network
   */
  static async getPolicy(task: Task, network: string) {
    return MlRetrainPolicyModel.findOne({ task, network }).lean();
  }

  /**
   * Update policy
   */
  static async updatePolicy(
    task: Task, 
    network: string, 
    updates: Partial<IMlRetrainPolicy>,
    updatedBy?: { id: string; email?: string }
  ) {
    return MlRetrainPolicyModel.findOneAndUpdate(
      { task, network },
      { 
        ...updates, 
        updatedAtTs: Math.floor(Date.now() / 1000),
        updatedBy 
      },
      { new: true, upsert: true }
    );
  }

  /**
   * Get recent decisions
   */
  static async getRecentDecisions(
    task: Task, 
    network: string, 
    limit = 50
  ) {
    return MlAutoRetrainDecisionModel
      .find({ task, network })
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Dry run - evaluate without enqueuing
   */
  static async dryRun(task: Task, network: string) {
    const now = Math.floor(Date.now() / 1000);
    const policy = await MlRetrainPolicyModel.findOne({ task, network }).lean();
    
    if (!policy) {
      return { wouldEnqueue: false, reason: 'NO_POLICY' };
    }
    
    if (!policy.enabled) {
      return { wouldEnqueue: false, reason: 'POLICY_DISABLED' };
    }

    const guards = await this.checkGuards(task, network, policy.guards, now);
    if (!guards.ok) {
      return { wouldEnqueue: false, reasons: guards.reasons, snapshot: guards.snapshot };
    }

    const triggers = await this.checkTriggers(task, network, policy.triggers, now);
    
    return { 
      wouldEnqueue: triggers.triggered, 
      reasons: triggers.triggered ? triggers.reasons : ['NO_TRIGGER'],
      snapshot: { ...guards.snapshot, ...triggers.snapshot },
      mlVersion: policy.mlVersion || 'v2.1',
      v23Config: policy.mlVersion === 'v2.3' ? (policy.v23Config || DEFAULT_V23_CONFIG) : undefined,
    };
  }
}
