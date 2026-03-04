// P2: Mongo Task Worker
// Background worker that processes tasks from Mongo queue with atomic claim

import 'dotenv/config';  // Ensure env is loaded
import * as dotenv from 'dotenv';

// Load .env from backend directory explicitly with absolute path
dotenv.config({ path: '/app/backend/.env' });

import { MongoTaskQueue, mongoTaskQueue } from '../queue/mongo.queue.js';
import { ITwitterTask, TaskStatus } from '../queue/task.model.js';
import { ParserInstance, ExecutionResult, ExecutionErrorCodes } from '../types.js';
import { SlotSelector, slotSelector } from '../slot.selector.js';
import { Dispatcher, dispatcher } from '../dispatcher.js';
import { CountersService, countersService } from '../counters.service.js';
import { cooldownService, CooldownService } from '../cooldown/index.js';
import { UserTwitterParsedTweetModel } from '../../../twitter-user/models/twitter-parsed-tweet.model.js';
import { UserTwitterParseTargetModel } from '../../../twitter-user/models/user-twitter-parse-target.model.js';

const POLL_INTERVAL_MS = 500;   // Time between queue checks
const MAX_CONCURRENT = 3;       // Max concurrent task executions
const STALE_RECOVERY_INTERVAL = 60 * 1000; // Check for stale tasks every minute
const CLEANUP_INTERVAL = 10 * 60 * 1000;   // Cleanup old tasks every 10 minutes

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MongoTaskWorker {
  private running = false;
  private currentTasks = 0;
  private loopPromise: Promise<void> | null = null;
  private staleRecoveryTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  // Provider for instances (set by executor)
  private instancesProvider: () => ParserInstance[] = () => [];

  constructor(
    private queue: MongoTaskQueue = mongoTaskQueue,
    private selector: SlotSelector = slotSelector,
    private dispatcherService: Dispatcher = dispatcher,
    private counters: CountersService = countersService,
    private cooldown: CooldownService = cooldownService
  ) {}

  /**
   * Set the provider function for getting current instances
   */
  setInstancesProvider(provider: () => ParserInstance[]): void {
    this.instancesProvider = provider;
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.running) {
      console.log('[MongoTaskWorker] Already running');
      return;
    }

    // CRITICAL: Validate COOKIE_ENC_KEY at startup
    console.log('[MongoTaskWorker] ENV CHECK at startup:');
    console.log('[MongoTaskWorker] COOKIE_ENC_KEY present:', !!process.env.COOKIE_ENC_KEY);
    console.log('[MongoTaskWorker] COOKIE_ENC_KEY length:', process.env.COOKIE_ENC_KEY?.length || 0);
    
    if (!process.env.COOKIE_ENC_KEY) {
      console.error('❌ [MongoTaskWorker] COOKIE_ENC_KEY is MISSING in worker process!');
      console.error('❌ [MongoTaskWorker] Worker cannot decrypt cookies without this key.');
      throw new Error('COOKIE_ENC_KEY is missing in worker process - cannot start');
    }
    
    console.log('✅ [MongoTaskWorker] COOKIE_ENC_KEY is SET - worker can decrypt cookies');

    this.running = true;
    console.log('[MongoTaskWorker] Starting...');

    // Start main processing loop
    this.loopPromise = this.loop();

    // Start stale task recovery timer
    this.staleRecoveryTimer = setInterval(async () => {
      try {
        await this.queue.recoverStaleTasks();
      } catch (err) {
        console.error('[MongoTaskWorker] Stale recovery error:', err);
      }
    }, STALE_RECOVERY_INTERVAL);

    // Start cleanup timer
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.queue.cleanup();
      } catch (err) {
        console.error('[MongoTaskWorker] Cleanup error:', err);
      }
    }, CLEANUP_INTERVAL);

    console.log('[MongoTaskWorker] Started with concurrent limit:', MAX_CONCURRENT);
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[MongoTaskWorker] Stopping...');
    this.running = false;

    // Clear timers
    if (this.staleRecoveryTimer) {
      clearInterval(this.staleRecoveryTimer);
      this.staleRecoveryTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Wait for loop to finish
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }

    console.log('[MongoTaskWorker] Stopped');
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<{
    running: boolean;
    currentTasks: number;
    maxConcurrent: number;
    queueStats: Awaited<ReturnType<MongoTaskQueue['getStats']>>;
  }> {
    return {
      running: this.running,
      currentTasks: this.currentTasks,
      maxConcurrent: MAX_CONCURRENT,
      queueStats: await this.queue.getStats(),
    };
  }

  /**
   * Main worker loop
   */
  private async loop(): Promise<void> {
    let loopCount = 0;
    console.log('[MongoTaskWorker] Loop started, polling every', POLL_INTERVAL_MS, 'ms');
    
    while (this.running) {
      try {
        loopCount++;
        
        // Log every 60 iterations (~30 seconds)
        if (loopCount % 60 === 0) {
          const stats = await this.queue.getStats();
          console.log(`[MongoTaskWorker] Heartbeat #${loopCount/60}: pending=${stats.pending}, running=${stats.running}, current=${this.currentTasks}`);
        }
        
        // Check concurrent limit
        if (this.currentTasks >= MAX_CONCURRENT) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        // Try to claim a task
        const task = await this.queue.claim();
        
        if (!task) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        
        console.log(`[MongoTaskWorker] CLAIMED task: ${task._id}, type=${task.type}, scope=${task.scope || 'SYSTEM'}, ownerType=${task.ownerType || 'SYSTEM'}`);

        // Execute task (don't await - allow concurrent execution)
        this.executeTask(task).catch(err => {
          console.error('[MongoTaskWorker] Unhandled error:', err);
        });
      } catch (err) {
        console.error('[MongoTaskWorker] Loop error:', err);
        await sleep(POLL_INTERVAL_MS * 2);
      }
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: ITwitterTask): Promise<ExecutionResult> {
    this.currentTasks++;
    const taskId = task._id.toString();
    
    console.log(`[MongoTaskWorker] Executing task ${taskId} type=${task.type} scope=${task.scope || 'SYSTEM'}`);

    try {
      // USER SCOPE: bypass slots entirely — user is their own "slot"
      if (task.ownerType === 'USER' || task.scope === 'USER') {
        return await this.executeUserTask(task, taskId);
      }

      // SYSTEM SCOPE: use slots, cooldown, rate limiting
      return await this.executeSystemTask(task, taskId);
    } catch (error: any) {
      await this.queue.fail(taskId, error.message || 'Execution error');
      console.error(`[MongoTaskWorker] Task ${taskId} exception:`, error.message);
      return {
        ok: false,
        error: error.message || 'Execution error',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      };
    } finally {
      this.currentTasks--;
    }
  }

  /**
   * Execute USER task - uses ParseRuntimeService for full flow
   * (session selection, parsing, saving tweets, stats update)
   */
  private async executeUserTask(task: ITwitterTask, taskId: string): Promise<ExecutionResult> {
    console.log(`[MongoTaskWorker] USER scope - using ParseRuntimeService`);
    console.log(`[MongoTaskWorker] COOKIE_ENC_KEY present:`, !!process.env.COOKIE_ENC_KEY);
    console.log(`[MongoTaskWorker] COOKIE_ENC_KEY length:`, process.env.COOKIE_ENC_KEY?.length || 0);

    // Try loading env directly if not present
    if (!process.env.COOKIE_ENC_KEY) {
      const dotenv = await import('dotenv');
      dotenv.config({ path: '/app/backend/.env' });
      console.log(`[MongoTaskWorker] After dotenv reload, COOKIE_ENC_KEY:`, !!process.env.COOKIE_ENC_KEY);
    }

    // Phase 4.2: Check if target is on cooldown
    const targetId = task.payload?.targetId;
    if (targetId) {
      const cooldownInfo = await cooldownService.isTargetOnCooldown(targetId);
      if (cooldownInfo.isOnCooldown) {
        console.log(`[MongoTaskWorker] SKIPPED task ${taskId} - target on cooldown | reason: ${cooldownInfo.cooldownReason}`);
        await this.queue.fail(taskId, 'COOLDOWN_ACTIVE', 'TARGET_COOLDOWN');
        return { ok: false, error: 'TARGET_COOLDOWN' };
      }
    }

    try {
      // Dynamic import to avoid circular dependency
      const { ParseRuntimeService } = await import('../../../twitter-user/services/parse-runtime.service.js');
      const { CryptoService } = await import('../../../twitter-user/crypto/crypto.service.js');
      
      // Get encryption key from environment
      const cookieEncKey = process.env.COOKIE_ENC_KEY;
      console.log(`[MongoTaskWorker] Final cookieEncKey length:`, cookieEncKey?.length || 0);
      
      if (!cookieEncKey) {
        throw new Error('COOKIE_ENC_KEY environment variable is not set');
      }
      
      const crypto = new CryptoService(cookieEncKey);
      const parseRuntime = new ParseRuntimeService(crypto);

      const ownerUserId = task.ownerUserId || 'dev-user';
      const query = task.payload?.query || task.payload?.keyword || '';
      const limit = task.payload?.maxTweets || task.payload?.limit || 50;
      const targetId = task.payload?.targetId;  // Get targetId from task payload

      console.log(`[MongoTaskWorker] USER task params: ownerUserId=${ownerUserId}, query=${query}, limit=${limit}, targetId=${targetId || 'none'}`);

      let result: any;

      if (task.type === 'SEARCH') {
        result = await parseRuntime.parseSearch({
          ownerUserId,
          query,
          limit,
          targetId,  // Pass targetId for stats update
        });
      } else if (task.type === 'ACCOUNT_TWEETS') {
        result = await parseRuntime.parseAccount({
          ownerUserId,
          username: query,
          limit,
          targetId,  // Pass targetId for stats update
        });
      } else {
        result = { ok: false, error: `Unsupported task type: ${task.type}` };
      }

      // Check for success (status: 'OK' or 'PARTIAL')
      const isSuccess = result.status === 'OK' || result.status === 'PARTIAL';
      
      if (isSuccess) {
        await this.queue.ack(taskId, result.data?.tweets || result.tweets || []);
        console.log(`[MongoTaskWorker] USER task ${taskId} COMPLETED | fetched: ${result.fetched || 0}`);
        return { ok: true, data: result };
      } else {
        // Phase 4.1: Pass error code for retry policy
        const errorCode = result.reason || result.errorCode || 'UNKNOWN';
        const errorMsg = result.error || result.reason || 'Parse failed';
        await this.queue.fail(taskId, errorMsg, errorCode);
        console.log(`[MongoTaskWorker] USER task ${taskId} failed: ${errorCode} - ${errorMsg}`);
        return { ok: false, error: errorMsg, errorCode };
      }
    } catch (error: any) {
      // Phase 4.1: Try to extract error code from message
      const errorCode = this.extractErrorCode(error.message);
      console.error(`[MongoTaskWorker] USER task error:`, error.message, `code=${errorCode}`);
      await this.queue.fail(taskId, error.message, errorCode);
      return { ok: false, error: error.message, errorCode };
    }
  }

  /**
   * Extract error code from error message
   */
  private extractErrorCode(message: string): string {
    if (message.includes('ECONNREFUSED') || message.includes('PARSER_DOWN')) return 'PARSER_DOWN';
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) return 'ETIMEDOUT';
    if (message.includes('ECONNRESET')) return 'ECONNRESET';
    if (message.includes('SESSION_EXPIRED')) return 'SESSION_EXPIRED';
    if (message.includes('SESSION_INVALID')) return 'SESSION_INVALID';
    if (message.includes('DECRYPT')) return 'DECRYPT_FAILED';
    if (message.includes('ALL_SESSIONS_INVALID')) return 'ALL_SESSIONS_INVALID';
    return 'UNKNOWN';
  }

  /**
   * Save parsed tweets to user_twitter_parsed_tweets
   */
  private async saveUserTweets(task: ITwitterTask, tweets: any[]): Promise<number> {
    try {
      const query = task.payload?.query || task.payload?.keyword || '';
      const targetId = task.payload?.targetId;
      const source = task.type === 'SEARCH' ? 'SEARCH' : 'ACCOUNT';
      const ownerUserId = task.ownerUserId || 'dev-user';
      const accountId = task.accountId?.toString();

      const docs = tweets.map(t => ({
        ownerUserId,
        accountId,
        targetId,
        tweetId: t.id,
        text: t.text || '',
        username: t.author?.username || t.username || '',
        displayName: t.author?.displayName || t.author?.name || t.displayName || '',
        likes: t.likes || 0,
        reposts: t.reposts || 0,
        replies: t.replies || 0,
        views: t.views || 0,
        media: t.media || [],
        query,
        source,
        tweetedAt: t.createdAt ? new Date(t.createdAt) : new Date(),
        parsedAt: new Date(),
      }));

      const result = await UserTwitterParsedTweetModel.insertMany(docs, { ordered: false });
      console.log(`[MongoTaskWorker] Saved ${result.length} tweets for query="${query}"`);

      // Update target stats
      if (targetId) {
        await UserTwitterParseTargetModel.findByIdAndUpdate(targetId, {
          $inc: { 'stats.totalRuns': 1, 'stats.totalPostsFetched': result.length },
        });
      }

      return result.length;
    } catch (error: any) {
      // Handle duplicate key errors (already parsed tweets)
      if (error.code === 11000) {
        const inserted = error.result?.insertedCount || 0;
        console.log(`[MongoTaskWorker] Saved ${inserted} new tweets (some duplicates skipped)`);
        return inserted;
      }
      console.error(`[MongoTaskWorker] saveUserTweets error:`, error.message);
      return 0;
    }
  }

  /**
   * Execute SYSTEM task - with slots, cooldown, rate limiting
   */
  private async executeSystemTask(task: ITwitterTask, taskId: string): Promise<ExecutionResult> {
    // Get current instances
    const instances = this.instancesProvider();

    // Select best available slot
    const slot = this.selector.select(instances);
    
    if (!slot) {
      const diagnostics = this.selector.getDiagnostics(instances);
      const error = this.getNoSlotError(diagnostics);
      
      await this.queue.fail(taskId, error, ExecutionErrorCodes.NO_AVAILABLE_SLOT);
      
      return { 
        ok: false, 
        error, 
        errorCode: ExecutionErrorCodes.NO_AVAILABLE_SLOT 
      };
    }

    // Convert to ParserTask for dispatcher
    const parserTask = this.queue.toParserTask(task);
    parserTask.instanceId = slot.id;

    // Dispatch to parser
    const result = await this.dispatcherService.dispatch(slot, parserTask);

    if (result.ok) {
      // Success
      this.counters.increment(slot);
      await this.queue.ack(taskId, result.data);
      console.log(`[MongoTaskWorker] SYSTEM task ${taskId} succeeded`);
      return result;
    } else {
      // Failure
      this.cooldown.apply(slot, { errorCode: result.errorCode });
      await this.queue.fail(taskId, result.error || 'Unknown error', result.errorCode);
      console.log(`[MongoTaskWorker] SYSTEM task ${taskId} failed: ${result.error}`);
      return result;
    }
  }

  /**
   * Get descriptive error for no available slot
   */
  private getNoSlotError(diagnostics: ReturnType<SlotSelector['getDiagnostics']>): string {
    if (diagnostics.total === 0) {
      return 'No parser instances configured';
    }
    if (diagnostics.enabled === 0) {
      return 'All parser instances are disabled';
    }
    if (diagnostics.rateLimited > 0 && diagnostics.inCooldown === 0) {
      return 'All instances have reached hourly rate limit';
    }
    if (diagnostics.inCooldown > 0) {
      return `All instances in cooldown (${diagnostics.inCooldown})`;
    }
    return 'No available parser instance';
  }
}

// Singleton worker
export const mongoTaskWorker = new MongoTaskWorker();
