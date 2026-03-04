/**
 * Retrain Executor Service
 * 
 * BATCH 1: Выполняет retrain из очереди.
 * BATCH 2: Интеграция с Python ML Training Service.
 * ML v2.3: Поддержка Feature Pruning + Sample Weighting.
 * 
 * Гарантии:
 * - только 1 retrain одновременно
 * - всегда SHADOW статус для новых моделей
 * - WS события для админки
 * - не трогает ACTIVE модели
 * - v2.3 safety guards (minFeatures, maxFeatureDropPct)
 */

import { MlRetrainQueueModel, type IMlRetrainQueue } from './ml_retrain_queue.model.js';
import { MlModelRegistryModel, type IFeatureMeta } from './ml_model_registry.model.js';
import { broadcastAdminEvent } from '../admin/admin.events.js';
import { pyTrain, pyHealth } from './python_ml.client.js';
import { pyTrainV23, pyV23Health } from './v23/python_v23.client.js';
import { env } from '../../config/env.js';

let retrainLock = false;

// Dataset version (fixed until next freeze)
const DATASET_VERSION = 'v2.0';

export class RetrainExecutorService {
  /**
   * Process next pending job from queue
   */
  static async runNext(): Promise<void> {
    if (retrainLock) {
      return;
    }
    retrainLock = true;

    try {
      const job = await MlRetrainQueueModel.findOne({
        status: 'PENDING'
      }).sort({ createdAt: 1 });

      if (!job) {
        retrainLock = false;
        return;
      }

      await this.executeJob(job);
    } catch (err) {
      console.error('[RetrainExecutor] Unexpected error:', err);
    } finally {
      retrainLock = false;
    }
  }

  /**
   * Execute a single retrain job
   */
  private static async executeJob(job: any): Promise<void> {
    const task = job.modelType as 'market' | 'actor';
    const mlVersion = job.mlVersion || 'v2.1';
    
    try {
      job.status = 'RUNNING';
      job.startedAt = new Date();
      await job.save();

      broadcastAdminEvent({
        type: 'RETRAIN_STARTED',
        meta: {
          network: job.network,
          modelType: task,
          mlVersion,
        },
        timestamp: Date.now(),
      });

      console.log(`[RetrainExecutor] Starting ${task}/${job.network} (reason: ${job.reason}, mlVersion: ${mlVersion})`);

      let newVersion: string;
      let metrics: Record<string, any>;
      let artifactPath: string;
      let featureMeta: IFeatureMeta | undefined;

      if (mlVersion === 'v2.3') {
        // ML v2.3: Use Feature Pruning + Sample Weighting
        const result = await this.executeV23Training(job);
        newVersion = result.newVersion;
        metrics = result.metrics;
        artifactPath = result.artifactPath;
        featureMeta = result.featureMeta;
      } else {
        // Classic v2.1 training
        const result = await this.executeV21Training(job);
        newVersion = result.newVersion;
        metrics = result.metrics;
        artifactPath = result.artifactPath;
      }

      // Always create as SHADOW - never directly ACTIVE
      const modelRecord = await MlModelRegistryModel.create({
        modelType: task,
        network: job.network,
        version: newVersion,
        status: 'SHADOW',
        artifactPath,
        metrics,
        featureMeta,
      });

      job.status = 'DONE';
      job.finishedAt = new Date();
      await job.save();

      broadcastAdminEvent({
        type: 'RETRAIN_FINISHED',
        meta: {
          network: job.network,
          modelType: task,
          version: newVersion,
          registryId: modelRecord._id.toString(),
          mlVersion,
        },
        timestamp: Date.now(),
      });

      console.log(`[RetrainExecutor] Completed ${task}/${job.network} -> ${newVersion} (SHADOW) [${mlVersion}]`);
      console.log(`[RetrainExecutor] Metrics: accuracy=${metrics.accuracy}, f1=${metrics.f1 || metrics.f1_macro || 0}`);
    } catch (err: any) {
      job.status = 'FAILED';
      job.error = err.message;
      job.finishedAt = new Date();
      await job.save();

      broadcastAdminEvent({
        type: 'RETRAIN_FAILED',
        meta: {
          network: job.network,
          modelType: task,
          error: err.message,
          mlVersion,
        },
        timestamp: Date.now(),
      });

      console.error(`[RetrainExecutor] Failed ${task}/${job.network} [${mlVersion}]:`, err.message);
    }
  }

  /**
   * Execute classic v2.1 training
   */
  private static async executeV21Training(job: IMlRetrainQueue): Promise<{
    newVersion: string;
    metrics: Record<string, any>;
    artifactPath: string;
  }> {
    const task = job.modelType as 'market' | 'actor';
    
    // Check Python ML service health
    const pythonHealthy = await pyHealth();
    
    if (pythonHealthy) {
      console.log(`[RetrainExecutor] Python ML service healthy, calling /api/v2/train`);
      
      const result = await pyTrain({
        task,
        dataset_version: DATASET_VERSION,
        dataset_id: null,
        params: {},
      });
      
      return {
        newVersion: result.model_version,
        metrics: result.metrics,
        artifactPath: result.artifact_path,
      };
    } else {
      // Fallback: Mock training when Python service unavailable
      console.warn(`[RetrainExecutor] Python ML service unavailable, using mock training`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return {
        newVersion: `${task}_${DATASET_VERSION}_${Date.now()}`,
        metrics: {
          accuracy: 0,
          precision: 0,
          recall: 0,
          note: 'MOCK - Python service unavailable'
        },
        artifactPath: `/models/${DATASET_VERSION}/${task}/${Date.now()}.joblib`,
      };
    }
  }

  /**
   * Execute v2.3 training with Feature Pruning + Sample Weighting
   */
  private static async executeV23Training(job: IMlRetrainQueue): Promise<{
    newVersion: string;
    metrics: Record<string, any>;
    artifactPath: string;
    featureMeta: IFeatureMeta;
  }> {
    const task = job.modelType as 'market' | 'actor';
    const v23Config = job.v23Config || {
      pruningMode: 'FULL',
      weightingMode: 'FULL',
      minFeatures: 5,
      maxFeatureDropPct: 40,
    };
    
    // Check v2.3 endpoint health
    const v23Healthy = await pyV23Health();
    
    if (!v23Healthy) {
      console.warn(`[RetrainExecutor] v2.3 endpoint unavailable, falling back to v2.1`);
      const v21Result = await this.executeV21Training(job);
      return {
        ...v21Result,
        featureMeta: {
          keptFeatures: [],
          droppedFeatures: [],
          pruning: { mode: 'OFF', note: 'FALLBACK_TO_V21' },
          weighting: { mode: 'OFF', note: 'FALLBACK_TO_V21' },
        },
      };
    }

    console.log(`[RetrainExecutor] v2.3 endpoint healthy, calling /api/v23/train`);
    console.log(`[RetrainExecutor] v2.3 config: pruning=${v23Config.pruningMode}, weighting=${v23Config.weightingMode}`);

    // Export dataset to CSV first
    const datasetPath = await this.exportDatasetForV23(task, job.network);
    
    const result = await pyTrainV23({
      version: 'v2.3',
      task,
      network: job.network,
      datasetPath,
      pruning: {
        mode: v23Config.pruningMode,
        varianceThreshold: 1e-8,
        corrThreshold: 0.98,
        minImportance: 0.002,
        maxFeatures: 80,
        importanceMethod: 'permutation',
      },
      weighting: {
        mode: v23Config.weightingMode,
        timeDecayHalfLifeHours: 72,
        strongLabelBoost: 1.5,
        classWeight: 'balanced',
        maxWeight: 5.0,
      },
    });

    // Safety guards check
    const keptCount = result.keptFeatures.length;
    const droppedCount = result.droppedFeatures.length;
    const totalFeatures = keptCount + droppedCount;
    const dropPct = totalFeatures > 0 ? (droppedCount / totalFeatures) * 100 : 0;

    if (keptCount < v23Config.minFeatures) {
      throw new Error(`V23_SAFETY_GUARD_FAILED: Only ${keptCount} features kept, minimum is ${v23Config.minFeatures}`);
    }

    if (dropPct > v23Config.maxFeatureDropPct) {
      throw new Error(`V23_SAFETY_GUARD_FAILED: ${dropPct.toFixed(1)}% features dropped, maximum is ${v23Config.maxFeatureDropPct}%`);
    }

    console.log(`[RetrainExecutor] v2.3 training complete: ${keptCount} features kept, ${droppedCount} dropped (${dropPct.toFixed(1)}%)`);

    return {
      newVersion: result.modelVersion,
      metrics: result.metrics,
      artifactPath: result.artifactsPath,
      featureMeta: {
        keptFeatures: result.keptFeatures,
        droppedFeatures: result.droppedFeatures,
        importances: result.importances || undefined,
        pruning: result.pruningConfig,
        weighting: result.weightingConfig,
      },
    };
  }

  /**
   * Export dataset to CSV for v2.3 training
   */
  private static async exportDatasetForV23(task: 'market' | 'actor', network: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const mongoose = await import('mongoose');
    
    const db = mongoose.default.connection.db;
    if (!db) throw new Error('Database not available');
    
    // Get labeled data from feature store
    const collectionName = task === 'market' 
      ? 'ml_market_features' 
      : 'ml_actor_features';
    
    const cursor = db.collection(collectionName).find({
      network,
      label: { $exists: true, $ne: null }
    }).sort({ ts: -1 }).limit(10000);
    
    const docs = await cursor.toArray();
    
    if (docs.length === 0) {
      throw new Error(`No labeled data for ${task}/${network}`);
    }
    
    // Convert to CSV
    const headers = Object.keys(docs[0]).filter(k => k !== '_id');
    const rows = docs.map(doc => {
      return headers.map(h => {
        const val = doc[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    
    // Save to file
    const exportDir = '/data/datasets/v2.3';
    await fs.mkdir(exportDir, { recursive: true });
    
    const timestamp = Date.now();
    const filePath = path.join(exportDir, `${task}_${network}_${timestamp}.csv`);
    
    await fs.writeFile(filePath, csv);
    
    console.log(`[RetrainExecutor] Exported ${docs.length} samples to ${filePath}`);
    
    return filePath;
  }

  /**
   * Check if retrain is currently running
   */
  static isRunning(): boolean {
    return retrainLock;
  }

  /**
   * Force unlock (emergency use only)
   */
  static forceUnlock(): void {
    console.warn('[RetrainExecutor] Force unlock called');
    retrainLock = false;
  }
  
  /**
   * Get current dataset version
   */
  static getDatasetVersion(): string {
    return DATASET_VERSION;
  }
}
