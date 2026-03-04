/**
 * Exchange Auto-Learning Loop - PR1: Label Scheduler
 * 
 * Creates labeling jobs for each new sample.
 * Runs periodically to ensure all samples have corresponding jobs.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import {
  ExchangeLabelJob,
  LabelSchedulerConfig,
  DEFAULT_LABEL_SCHEDULER_CONFIG,
} from './exchange_label_job.types.js';
import { ExchangeSample } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_SAMPLES = 'exch_dataset_samples';
const COLLECTION_JOBS = 'exch_label_jobs';

// ═══════════════════════════════════════════════════════════════
// SCHEDULER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeLabelSchedulerService {
  private samplesCollection: Collection<ExchangeSample>;
  private jobsCollection: Collection<ExchangeLabelJob>;
  private config: LabelSchedulerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  constructor(db: Db, config: Partial<LabelSchedulerConfig> = {}) {
    this.samplesCollection = db.collection<ExchangeSample>(COLLECTION_SAMPLES);
    this.jobsCollection = db.collection<ExchangeLabelJob>(COLLECTION_JOBS);
    this.config = { ...DEFAULT_LABEL_SCHEDULER_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    // Index for finding jobs by sample
    await this.jobsCollection.createIndex(
      { sampleId: 1 },
      { unique: true, name: 'idx_sample_id' }
    );
    
    // Index for finding pending jobs
    await this.jobsCollection.createIndex(
      { status: 1, resolveAt: 1 },
      { name: 'idx_pending_jobs' }
    );
    
    // Index for job processing
    await this.jobsCollection.createIndex(
      { status: 1, resolveAt: 1, attempts: 1 },
      { name: 'idx_job_processing' }
    );
    
    console.log('[ExchangeLabelScheduler] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // START/STOP
  // ═══════════════════════════════════════════════════════════════
  
  start(): void {
    if (this.intervalId) {
      console.log('[ExchangeLabelScheduler] Already running');
      return;
    }
    
    console.log(`[ExchangeLabelScheduler] Starting with interval ${this.config.checkIntervalMs}ms`);
    
    // Run immediately
    this.runScheduler();
    
    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runScheduler();
    }, this.config.checkIntervalMs);
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ExchangeLabelScheduler] Stopped');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN SCHEDULER LOOP
  // ═══════════════════════════════════════════════════════════════
  
  private async runScheduler(): Promise<void> {
    if (this.isRunning) {
      console.log('[ExchangeLabelScheduler] Skipping run - previous run still in progress');
      return;
    }
    
    this.isRunning = true;
    
    try {
      const jobsCreated = await this.createMissingJobs();
      
      if (jobsCreated > 0) {
        console.log(`[ExchangeLabelScheduler] Created ${jobsCreated} new jobs`);
      }
    } catch (err) {
      console.error('[ExchangeLabelScheduler] Error in scheduler run:', err);
    } finally {
      this.isRunning = false;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CREATE MISSING JOBS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Find samples without jobs and create jobs for them.
   */
  async createMissingJobs(): Promise<number> {
    // Find pending samples
    const pendingSamples = await this.samplesCollection
      .find({ status: 'PENDING' })
      .limit(this.config.batchSize * 2)
      .toArray() as ExchangeSample[];
    
    if (pendingSamples.length === 0) {
      return 0;
    }
    
    // Get existing job sample IDs
    const sampleIds = pendingSamples.map(s => s._id?.toString()).filter(Boolean);
    const existingJobs = await this.jobsCollection
      .find({ sampleId: { $in: sampleIds } })
      .toArray();
    
    const existingJobSampleIds = new Set(existingJobs.map(j => j.sampleId));
    
    // Filter samples that need jobs
    const samplesNeedingJobs = pendingSamples.filter(
      s => !existingJobSampleIds.has(s._id?.toString() || '')
    );
    
    if (samplesNeedingJobs.length === 0) {
      return 0;
    }
    
    // Create jobs (limit to batchSize)
    const samplesToProcess = samplesNeedingJobs.slice(0, this.config.batchSize);
    const now = new Date();
    
    const jobs: ExchangeLabelJob[] = samplesToProcess.map(sample => ({
      sampleId: sample._id?.toString() || '',
      symbol: sample.symbol,
      horizon: sample.horizon,
      resolveAt: sample.resolveAt,
      status: 'PENDING' as const,
      attempts: 0,
      maxAttempts: 3,
      lastAttemptAt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }));
    
    try {
      const result = await this.jobsCollection.insertMany(jobs as any, { ordered: false });
      return result.insertedCount;
    } catch (err: any) {
      // Handle partial inserts (some may be duplicates)
      if (err.insertedCount) {
        return err.insertedCount;
      }
      throw err;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MANUAL JOB CREATION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create a job for a specific sample.
   */
  async createJobForSample(sample: ExchangeSample): Promise<{ jobId: string; created: boolean }> {
    const sampleId = sample._id?.toString() || '';
    
    if (!sampleId) {
      throw new Error('Sample has no _id');
    }
    
    const now = new Date();
    
    const job: ExchangeLabelJob = {
      sampleId,
      symbol: sample.symbol,
      horizon: sample.horizon,
      resolveAt: sample.resolveAt,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      lastAttemptAt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    
    try {
      const result = await this.jobsCollection.insertOne(job as any);
      console.log(`[ExchangeLabelScheduler] Job created for sample ${sampleId}`);
      return { jobId: result.insertedId.toString(), created: true };
    } catch (err: any) {
      if (err.code === 11000) {
        // Job already exists
        const existing = await this.jobsCollection.findOne({ sampleId });
        return { jobId: existing?._id?.toString() || '', created: false };
      }
      throw err;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    pendingJobs: number;
    processingJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalJobs: number;
  }> {
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ];
    
    const results = await this.jobsCollection.aggregate(pipeline).toArray();
    
    const byStatus: Record<string, number> = {};
    let total = 0;
    
    for (const item of results) {
      byStatus[item._id] = item.count;
      total += item.count;
    }
    
    return {
      pendingJobs: byStatus['PENDING'] || 0,
      processingJobs: byStatus['PROCESSING'] || 0,
      completedJobs: byStatus['COMPLETED'] || 0,
      failedJobs: byStatus['FAILED'] || 0,
      totalJobs: total,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let schedulerInstance: ExchangeLabelSchedulerService | null = null;

export function getExchangeLabelScheduler(
  db: Db,
  config?: Partial<LabelSchedulerConfig>
): ExchangeLabelSchedulerService {
  if (!schedulerInstance) {
    schedulerInstance = new ExchangeLabelSchedulerService(db, config);
  }
  return schedulerInstance;
}

console.log('[Exchange ML] Label scheduler loaded');
