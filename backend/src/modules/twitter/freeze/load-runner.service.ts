// P3 FREEZE Validation - Load Runner Service
// Generates controlled load for SMOKE/STRESS testing
// P2: Uses MongoTaskQueue with atomic claim

import { LoadProfile, FreezeResult, freezeGateService } from './freeze-gate.service.js';
import { metricsService } from './metrics.service.js';
import { mongoTaskQueue } from '../execution/queue/mongo.queue.js';
import { TwitterTaskModel, TaskStatus } from '../execution/queue/task.model.js';
import { createTask, ParserTask } from '../execution/types.js';
import { mockRuntime, MockFaultConfig } from '../runtime/adapters/mock.runtime.js';

export interface LoadConfig {
  durationMinutes: number;
  tasksTotal: number;
  concurrency: number;
  runtime: 'mock' | 'remote';
  useQueue: boolean;  // P2: Toggle queue vs direct execution
  faultInjection: {
    rateLimit429: number;     // 0-1 probability
    timeout: number;          // 0-1 probability
    serverError: number;      // 0-1 probability
    randomLatencyMs: [number, number]; // [min, max]
  };
}

const SMOKE_CONFIG: LoadConfig = {
  durationMinutes: 2,  // Quick 2-minute test
  tasksTotal: 100,
  concurrency: 3,
  runtime: 'mock',
  useQueue: true,  // P2: Use Mongo queue by default
  faultInjection: {
    rateLimit429: 0.05,
    timeout: 0.03,
    serverError: 0.01,
    randomLatencyMs: [50, 800],
  },
};

const STRESS_CONFIG: LoadConfig = {
  durationMinutes: 5,  // 5-minute stress test
  tasksTotal: 500,
  concurrency: 5,
  runtime: 'mock',
  useQueue: true,  // P2: Use Mongo queue by default
  faultInjection: {
    rateLimit429: 0.03,   // Realistic 3% rate limit
    timeout: 0.02,        // 2% timeouts
    serverError: 0.01,    // 1% errors
    randomLatencyMs: [50, 1500],
  },
};

export type LoadRunnerStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface LoadRunnerState {
  status: LoadRunnerStatus;
  profile: LoadProfile | null;
  config: LoadConfig | null;
  progress: {
    tasksGenerated: number;
    tasksTotal: number;
    elapsedMs: number;
    durationMs: number;
  } | null;
  result: FreezeResult | null;
  startedAt: number | null;
  error: string | null;
}

const SAMPLE_KEYWORDS = ['solana', 'ethereum', 'bitcoin', 'defi', 'nft', 'airdrop', 'whale'];

export class LoadRunnerService {
  private state: LoadRunnerState = {
    status: 'IDLE',
    profile: null,
    config: null,
    progress: null,
    result: null,
    startedAt: null,
    error: null,
  };

  private abortController: AbortController | null = null;

  getConfig(profile: LoadProfile): LoadConfig {
    switch (profile) {
      case 'SMOKE': return { ...SMOKE_CONFIG };
      case 'STRESS': return { ...STRESS_CONFIG };
      case 'SOAK': return { ...STRESS_CONFIG, durationMinutes: 360, tasksTotal: 50000 };
      default: return { ...SMOKE_CONFIG };
    }
  }

  getState(): LoadRunnerState {
    // Update progress if running
    if (this.state.status === 'RUNNING' && this.state.startedAt && this.state.config) {
      this.state.progress = {
        ...this.state.progress!,
        elapsedMs: Date.now() - this.state.startedAt,
      };
    }
    return { ...this.state };
  }

  async run(profile: LoadProfile): Promise<FreezeResult> {
    if (this.state.status === 'RUNNING') {
      throw new Error('Load runner already running');
    }

    const config = this.getConfig(profile);
    this.abortController = new AbortController();

    // Reset metrics
    metricsService.reset();

    // Configure MockRuntime with fault injection
    const faultConfig: MockFaultConfig = {
      rateLimit429: config.faultInjection.rateLimit429,
      timeout: config.faultInjection.timeout,
      serverError: config.faultInjection.serverError,
      randomLatencyMs: config.faultInjection.randomLatencyMs,
    };
    mockRuntime.setFaultConfig(faultConfig);

    // Initialize state
    this.state = {
      status: 'RUNNING',
      profile,
      config,
      progress: {
        tasksGenerated: 0,
        tasksTotal: config.tasksTotal,
        elapsedMs: 0,
        durationMs: config.durationMinutes * 60 * 1000,
      },
      result: null,
      startedAt: Date.now(),
      error: null,
    };

    console.log(`[LoadRunner] Starting ${profile} test: ${config.tasksTotal} tasks over ${config.durationMinutes} minutes`);
    console.log(`[LoadRunner] Fault injection: 429=${config.faultInjection.rateLimit429*100}%, timeout=${config.faultInjection.timeout*100}%`);
    console.log(`[LoadRunner] Queue mode: ${config.useQueue ? 'MONGO' : 'DIRECT'}`);

    try {
      if (config.useQueue) {
        // P2: Use Mongo queue with atomic claim
        await this.runWithQueue(config);
      } else {
        // Legacy: Direct execution (for comparison testing)
        await this.runDirect(config);
      }

      // Evaluate results
      const snapshot = metricsService.getSnapshot(0);
      const result = freezeGateService.evaluate(snapshot, profile, config.durationMinutes);

      this.state.status = 'COMPLETED';
      this.state.result = result;

      console.log(`[LoadRunner] ${profile} test completed: ${result.verdict}`);
      if (result.reasons.length > 0) {
        console.log(`[LoadRunner] Reasons: ${result.reasons.join(', ')}`);
      }

      return result;

    } catch (error: any) {
      this.state.status = 'FAILED';
      this.state.error = error.message;
      console.error(`[LoadRunner] ${profile} test failed:`, error.message);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * P2: Run with Mongo queue - tests full pipeline
   */
  private async runWithQueue(config: LoadConfig): Promise<void> {
    const intervalMs = (config.durationMinutes * 60 * 1000) / config.tasksTotal;
    let tasksEnqueued = 0;

    // Phase 1: Enqueue all tasks
    console.log(`[LoadRunner] Phase 1: Enqueueing ${config.tasksTotal} tasks to Mongo...`);
    
    while (tasksEnqueued < config.tasksTotal) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Load runner aborted');
      }

      const keyword = SAMPLE_KEYWORDS[tasksEnqueued % SAMPLE_KEYWORDS.length];
      
      await mongoTaskQueue.enqueue('SEARCH', { keyword, limit: 20 }, {
        priority: 'NORMAL',
        maxAttempts: 2,
      });
      
      tasksEnqueued++;
      this.state.progress!.tasksGenerated = tasksEnqueued;
      metricsService.incTasksEnqueued();

      // Small delay to avoid overwhelming Mongo
      if (tasksEnqueued % 50 === 0) {
        await this.sleep(10);
      }
    }

    console.log(`[LoadRunner] Enqueued ${tasksEnqueued} tasks, waiting for worker to process...`);

    // Phase 2: Wait for worker to process all tasks
    const maxWaitMs = config.durationMinutes * 60 * 1000 * 2; // 2x duration max
    const startWait = Date.now();
    
    while (Date.now() - startWait < maxWaitMs) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Load runner aborted');
      }

      const stats = await mongoTaskQueue.getStats();
      metricsService.updateQueueDepth(stats.pending + stats.running);

      // Check if all tasks are done
      if (stats.pending === 0 && stats.running === 0) {
        // Update final metrics
        metricsService.setTasksSucceeded(stats.done);
        metricsService.setTasksFailed(stats.failed);
        
        console.log(`[LoadRunner] All tasks processed: ${stats.done} done, ${stats.failed} failed`);
        break;
      }

      // Progress update
      const processed = stats.done + stats.failed;
      console.log(`[LoadRunner] Progress: ${processed}/${tasksEnqueued} (${stats.pending} pending, ${stats.running} running)`);
      
      await this.sleep(1000);
    }

    // Cleanup test tasks
    await TwitterTaskModel.deleteMany({
      payload: { keyword: { $in: SAMPLE_KEYWORDS } },
      status: { $in: [TaskStatus.DONE, TaskStatus.FAILED] },
    });
  }

  /**
   * Legacy: Direct execution without queue (for comparison)
   */
  private async runDirect(config: LoadConfig): Promise<void> {
    const intervalMs = (config.durationMinutes * 60 * 1000) / config.tasksTotal;
    let tasksGenerated = 0;
    const activeTasks: Promise<void>[] = [];
    
    const executeTask = async (keyword: string) => {
      metricsService.incTasksEnqueued();
      metricsService.incTasksStarted();
      
      const startTime = Date.now();
      try {
        metricsService.incRuntimeCalls();
        const result = await mockRuntime.fetchTweetsByKeyword({ keyword, limit: 20 });
        const duration = Date.now() - startTime;
        metricsService.recordRuntimeLatency(duration);
        
        if (result.ok) {
          metricsService.incTasksSucceeded();
        } else {
          metricsService.incRuntimeErrors();
          if (result.status === 'RATE_LIMITED') {
            metricsService.incRateLimitHits();
            metricsService.incCooldownsTriggered();
          }
          // Simulate retry
          metricsService.incTasksRetried();
          const retryResult = await mockRuntime.fetchTweetsByKeyword({ keyword, limit: 20 });
          if (retryResult.ok) {
            metricsService.incTasksSucceeded();
          } else {
            metricsService.incTasksFailed();
          }
        }
      } catch (error) {
        metricsService.incRuntimeErrors();
        metricsService.incTasksFailed();
      }
    };

    while (tasksGenerated < config.tasksTotal) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Load runner aborted');
      }

      const keyword = SAMPLE_KEYWORDS[tasksGenerated % SAMPLE_KEYWORDS.length];
      
      if (activeTasks.length < config.concurrency) {
        const taskPromise = executeTask(keyword).finally(() => {
          const idx = activeTasks.indexOf(taskPromise);
          if (idx > -1) activeTasks.splice(idx, 1);
        });
        activeTasks.push(taskPromise);
        
        tasksGenerated++;
        this.state.progress!.tasksGenerated = tasksGenerated;
        metricsService.updateQueueDepth(activeTasks.length);
      } else {
        await Promise.race(activeTasks);
      }

      await this.sleep(Math.max(5, intervalMs / config.concurrency));
    }

    await Promise.all(activeTasks);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.state.status = 'IDLE';
      console.log('[LoadRunner] Aborted');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const loadRunnerService = new LoadRunnerService();
