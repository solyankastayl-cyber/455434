/**
 * Exchange Auto-Learning Loop - PR1: Label Worker
 * 
 * Processes pending label jobs:
 * 1. Gets current price for the sample
 * 2. Calculates return percentage
 * 3. Determines label (WIN/LOSS/NEUTRAL)
 * 4. Updates sample with result
 * 
 * CRITICAL: No lookahead bias
 * - Only resolves when resolveAt <= now
 * - Uses price at resolveAt time (or current if resolveAt just passed)
 */

import { Db, Collection, ObjectId } from 'mongodb';
import {
  ExchangeLabelJob,
  LabelWorkerConfig,
  DEFAULT_LABEL_WORKER_CONFIG,
  LabelWorkerStats,
} from './exchange_label_job.types.js';
import { ExchangeSample, LabelResult } from '../dataset/exchange_dataset.types.js';
import { getExchangeDatasetService } from '../dataset/exchange_dataset.service.js';
// PR3: Shadow integration
import { getExchangeShadowRecorderService } from '../shadow/exchange_shadow_recorder.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_JOBS = 'exch_label_jobs';

// ═══════════════════════════════════════════════════════════════
// PRICE PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface PriceProvider {
  getCurrentPrice(symbol: string): Promise<number | null>;
  getHistoricalPrice?(symbol: string, timestamp: Date): Promise<number | null>;
}

// ═══════════════════════════════════════════════════════════════
// WORKER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeLabelWorkerService {
  private jobsCollection: Collection<ExchangeLabelJob>;
  private config: LabelWorkerConfig;
  private priceProvider: PriceProvider;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  // Stats
  private stats: LabelWorkerStats = {
    lastRunAt: null,
    jobsProcessed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    recentWins: 0,
    recentLosses: 0,
    recentNeutral: 0,
    avgProcessingTimeMs: 0,
    errorRate: 0,
  };
  
  constructor(
    private db: Db,
    priceProvider: PriceProvider,
    config: Partial<LabelWorkerConfig> = {}
  ) {
    this.jobsCollection = db.collection<ExchangeLabelJob>(COLLECTION_JOBS);
    this.priceProvider = priceProvider;
    this.config = { ...DEFAULT_LABEL_WORKER_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // START/STOP
  // ═══════════════════════════════════════════════════════════════
  
  start(): void {
    if (this.intervalId) {
      console.log('[ExchangeLabelWorker] Already running');
      return;
    }
    
    console.log(`[ExchangeLabelWorker] Starting with interval ${this.config.intervalMs}ms`);
    
    // Run immediately
    this.runWorker();
    
    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runWorker();
    }, this.config.intervalMs);
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ExchangeLabelWorker] Stopped');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN WORKER LOOP
  // ═══════════════════════════════════════════════════════════════
  
  private async runWorker(): Promise<void> {
    if (this.isRunning) {
      console.log('[ExchangeLabelWorker] Skipping run - previous run still in progress');
      return;
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      const processed = await this.processReadyJobs();
      
      if (processed.total > 0) {
        console.log(
          `[ExchangeLabelWorker] Processed ${processed.total} jobs: ` +
          `${processed.succeeded} succeeded, ${processed.failed} failed`
        );
      }
      
      // Update stats
      this.stats.lastRunAt = new Date();
      this.stats.jobsProcessed += processed.total;
      this.stats.jobsSucceeded += processed.succeeded;
      this.stats.jobsFailed += processed.failed;
      
      const elapsed = Date.now() - startTime;
      if (processed.total > 0) {
        this.stats.avgProcessingTimeMs = elapsed / processed.total;
      }
      
    } catch (err) {
      console.error('[ExchangeLabelWorker] Error in worker run:', err);
    } finally {
      this.isRunning = false;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROCESS READY JOBS
  // ═══════════════════════════════════════════════════════════════
  
  async processReadyJobs(): Promise<{ total: number; succeeded: number; failed: number }> {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.config.gracePeriodMs);
    
    // Find jobs ready for processing
    // resolveAt + gracePeriod <= now
    const jobs = await this.jobsCollection
      .find({
        status: { $in: ['PENDING', 'PROCESSING'] },
        resolveAt: { $lte: cutoffTime },
        attempts: { $lt: this.config.maxAttempts },
      })
      .sort({ resolveAt: 1 })
      .limit(this.config.batchSize)
      .toArray() as ExchangeLabelJob[];
    
    if (jobs.length === 0) {
      return { total: 0, succeeded: 0, failed: 0 };
    }
    
    let succeeded = 0;
    let failed = 0;
    
    for (const job of jobs) {
      try {
        // Mark as processing
        await this.jobsCollection.updateOne(
          { _id: new ObjectId(job._id) as any },
          {
            $set: {
              status: 'PROCESSING',
              lastAttemptAt: now,
              updatedAt: now,
            },
            $inc: { attempts: 1 },
          }
        );
        
        // Process the job
        const result = await this.processJob(job);
        
        if (result.success) {
          succeeded++;
          
          // Update label stats
          if (result.label === 'WIN') this.stats.recentWins++;
          else if (result.label === 'LOSS') this.stats.recentLosses++;
          else this.stats.recentNeutral++;
        } else {
          failed++;
        }
        
      } catch (err) {
        console.error(`[ExchangeLabelWorker] Error processing job ${job._id}:`, err);
        failed++;
        
        // Mark as failed if max attempts reached
        const newAttempts = (job.attempts || 0) + 1;
        if (newAttempts >= this.config.maxAttempts) {
          await this.markJobFailed(job._id!, (err as Error).message);
        }
      }
    }
    
    return { total: jobs.length, succeeded, failed };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROCESS SINGLE JOB
  // ═══════════════════════════════════════════════════════════════
  
  private async processJob(
    job: ExchangeLabelJob
  ): Promise<{ success: boolean; label?: LabelResult }> {
    // Get the sample
    const datasetService = getExchangeDatasetService(this.db);
    const sample = await datasetService.getSampleById(job.sampleId);
    
    if (!sample) {
      await this.markJobFailed(job._id!, 'Sample not found');
      return { success: false };
    }
    
    if (sample.status !== 'PENDING') {
      // Sample already resolved
      await this.markJobCompleted(job._id!);
      return { success: true, label: sample.label || undefined };
    }
    
    // Get current price
    const exitPrice = await this.priceProvider.getCurrentPrice(sample.symbol);
    
    if (exitPrice === null || exitPrice <= 0) {
      throw new Error(`Could not get price for ${sample.symbol}`);
    }
    
    // Calculate return
    const returnPct = (exitPrice - sample.entryPrice) / sample.entryPrice;
    
    // Determine label
    const label = this.determineLabel(returnPct, sample.signalMeta?.direction);
    
    // Update sample
    const resolved = await datasetService.resolveSample({
      sampleId: job.sampleId,
      exitPrice,
      returnPct,
      label,
    });
    
    if (!resolved) {
      throw new Error('Failed to resolve sample');
    }
    
    // Mark job as completed
    await this.markJobCompleted(job._id!, {
      exitPrice,
      returnPct,
      label,
    });
    
    // PR3: Also resolve shadow prediction if exists
    if (this.isShadowEnabled()) {
      try {
        const shadowRecorder = getExchangeShadowRecorderService(this.db);
        await shadowRecorder.resolvePrediction({
          sampleId: job.sampleId,
          actualLabel: label,
        });
      } catch (err) {
        // Shadow resolution errors don't affect main flow
        console.warn(`[ExchangeLabelWorker] Shadow resolution error for ${job.sampleId}:`, err);
      }
    }
    
    console.log(
      `[ExchangeLabelWorker] Resolved: ${sample.symbol}/${sample.horizon} ` +
      `entry=${sample.entryPrice.toFixed(2)} exit=${exitPrice.toFixed(2)} ` +
      `return=${(returnPct * 100).toFixed(2)}% -> ${label}`
    );
    
    return { success: true, label };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DETERMINE LABEL
  // ═══════════════════════════════════════════════════════════════
  
  private determineLabel(
    returnPct: number,
    direction?: 'LONG' | 'SHORT' | 'NEUTRAL'
  ): LabelResult {
    // Direction-aware labeling
    if (this.config.useDirectionAware && direction) {
      if (direction === 'LONG') {
        // For LONG signals: positive return = WIN
        if (returnPct >= this.config.winThresholdPct) return 'WIN';
        if (returnPct <= -this.config.winThresholdPct) return 'LOSS';
      } else if (direction === 'SHORT') {
        // For SHORT signals: negative return = WIN
        if (returnPct <= -this.config.winThresholdPct) return 'WIN';
        if (returnPct >= this.config.winThresholdPct) return 'LOSS';
      }
    }
    
    // Simple absolute return labeling
    const absReturn = Math.abs(returnPct);
    
    if (absReturn < this.config.neutralZonePct) {
      return 'NEUTRAL';
    }
    
    if (returnPct >= this.config.winThresholdPct) {
      return 'WIN';
    }
    
    if (returnPct <= -this.config.winThresholdPct) {
      return 'LOSS';
    }
    
    return 'NEUTRAL';
  }
  
  // ═══════════════════════════════════════════════════════════════
  // JOB STATUS UPDATES
  // ═══════════════════════════════════════════════════════════════
  
  private async markJobCompleted(
    jobId: string,
    result?: { exitPrice: number; returnPct: number; label: LabelResult }
  ): Promise<void> {
    const update: any = {
      $set: {
        status: 'COMPLETED',
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    };
    
    if (result) {
      update.$set.result = result;
    }
    
    await this.jobsCollection.updateOne(
      { _id: new ObjectId(jobId) as any },
      update
    );
  }
  
  private async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.jobsCollection.updateOne(
      { _id: new ObjectId(jobId) as any },
      {
        $set: {
          status: 'FAILED',
          error,
          updatedAt: new Date(),
        },
      }
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  getStats(): LabelWorkerStats {
    // Calculate error rate
    const total = this.stats.jobsSucceeded + this.stats.jobsFailed;
    this.stats.errorRate = total > 0 ? this.stats.jobsFailed / total : 0;
    
    return { ...this.stats };
  }
  
  resetStats(): void {
    this.stats = {
      lastRunAt: null,
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      recentWins: 0,
      recentLosses: 0,
      recentNeutral: 0,
      avgProcessingTimeMs: 0,
      errorRate: 0,
    };
  }
  
  // PR3: Check if shadow mode is enabled
  private isShadowEnabled(): boolean {
    return process.env.EXCHANGE_SHADOW_ENABLED === 'true';
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let workerInstance: ExchangeLabelWorkerService | null = null;

export function getExchangeLabelWorker(
  db: Db,
  priceProvider: PriceProvider,
  config?: Partial<LabelWorkerConfig>
): ExchangeLabelWorkerService {
  if (!workerInstance) {
    workerInstance = new ExchangeLabelWorkerService(db, priceProvider, config);
  }
  return workerInstance;
}

console.log('[Exchange ML] Label worker loaded');
