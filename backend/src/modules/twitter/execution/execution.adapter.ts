// B2/B3 Execution Core - Enhanced Adapter
// Connects B1 (Control Plane) with B2/B3 (Execution Core + Storage + Runtime)

import { Db, ObjectId } from 'mongodb';
import { twitterParserExecutor, TwitterParserExecutor } from './executor.service.js';
import { ParserInstance, ExecutionAccount, ParserTaskType, ExecutionResult } from './types.js';
import { slotHealthService, SlotHealthService, HealthCheckResult } from './health/slot.health.service.js';
import { getStorageService, StorageService } from './storage/storage.service.js';
import { CreateExecutionTaskDto, ExecutionTask, executionTaskToDTO } from './storage/execution_task.model.js';
import { runtimeDispatcher } from './runtime.dispatcher.js';
import {
  runtimeRegistry,
  runtimeHealthService,
  createTwitterRuntime,
  RuntimeStatus,
} from '../runtime/index.js';

const ACCOUNTS_COLLECTION = 'twitter_accounts';
const SLOTS_COLLECTION = 'twitter_egress_slots';

// Cache for in-memory state (synced from MongoDB)
interface ExecutionState {
  accounts: ExecutionAccount[];
  instances: ParserInstance[];
  lastSync: number;
}

const state: ExecutionState = {
  accounts: [],
  instances: [],
  lastSync: 0,
};

const SYNC_INTERVAL = 10000; // Sync every 10 seconds
const HEALTH_CHECK_INTERVAL = 60000; // Health check every minute

export class TwitterExecutionAdapter {
  private db: Db | null = null;
  private executor: TwitterParserExecutor;
  private healthService: SlotHealthService;
  private storageService: StorageService | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;
  private healthIntervalId: NodeJS.Timeout | null = null;

  constructor(
    executor: TwitterParserExecutor = twitterParserExecutor,
    healthService: SlotHealthService = slotHealthService
  ) {
    this.executor = executor;
    this.healthService = healthService;
  }

  /**
   * Initialize adapter with database connection
   */
  initialize(db: Db): void {
    this.db = db;
    this.storageService = getStorageService(db);
    
    // Ensure indexes
    this.storageService.ensureIndexes().catch(console.error);
    
    // Initial sync
    this.syncFromDatabase().catch(console.error);
    
    // Start periodic sync
    this.syncIntervalId = setInterval(() => {
      this.syncFromDatabase().catch(console.error);
    }, SYNC_INTERVAL);

    // Start health checks
    this.healthIntervalId = setInterval(() => {
      this.runHealthChecks().catch(console.error);
    }, HEALTH_CHECK_INTERVAL);

    console.log('[ExecutionAdapter] Initialized with persistent storage');
  }

  /**
   * Stop adapter
   */
  shutdown(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
      this.healthIntervalId = null;
    }
    this.executor.stopWorker();
    console.log('[ExecutionAdapter] Shutdown');
  }

  /**
   * Sync accounts and slots from MongoDB to execution state
   */
  async syncFromDatabase(): Promise<void> {
    if (!this.db) return;

    try {
      // Clear runtime registry to force recreation
      runtimeRegistry.clear();
      console.log('[ExecutionAdapter] Cleared runtime registry');

      // Fetch accounts
      const accountDocs = await this.db
        .collection(ACCOUNTS_COLLECTION)
        .find({ status: 'ACTIVE' })
        .toArray();

      const accounts: ExecutionAccount[] = accountDocs.map(doc => ({
        id: doc._id.toString(),
        label: doc.label,
        enabled: doc.status === 'ACTIVE',
      }));

      // Fetch slots
      const slotDocs = await this.db
        .collection(SLOTS_COLLECTION)
        .find({ enabled: true })
        .toArray();

      const instances: ParserInstance[] = slotDocs.map(doc => ({
        id: doc._id.toString(),
        label: doc.label,
        kind: doc.type,
        baseUrl: doc.worker?.baseUrl,
        proxyUrl: doc.proxy?.url,
        enabled: doc.enabled,
        accountId: doc.accountId?.toString(),
        usedInWindow: doc.usage?.usedInWindow || 0,
        windowStart: doc.usage?.windowStartAt || Date.now(),
        limitPerHour: doc.limits?.requestsPerHour || 200,
        cooldownUntil: doc.cooldownUntil,
        health: doc.health?.status || 'UNKNOWN',
      }));

      // Update state
      state.accounts = accounts;
      state.instances = instances;
      state.lastSync = Date.now();

      // Update executor
      this.executor.setAccounts(accounts);
      this.executor.setInstances(instances);
    } catch (error) {
      console.error('[ExecutionAdapter] Sync error:', error);
    }
  }

  /**
   * Sync instance state back to MongoDB (counters, cooldowns, health)
   */
  async syncToDatabase(): Promise<void> {
    if (!this.db) return;

    const instances = this.executor.getInstances();
    
    for (const inst of instances) {
      try {
        await this.db.collection(SLOTS_COLLECTION).updateOne(
          { _id: new ObjectId(inst.id) },
          {
            $set: {
              'usage.usedInWindow': inst.usedInWindow,
              'usage.windowStartAt': inst.windowStart,
              'health.status': inst.health,
              cooldownUntil: inst.cooldownUntil,
              updatedAt: Date.now(),
            },
          }
        );
      } catch (error) {
        console.error(`[ExecutionAdapter] Failed to sync instance ${inst.id}:`, error);
      }
    }
  }

  /**
   * Run health checks on all slots
   */
  async runHealthChecks(): Promise<void> {
    if (!this.db) return;

    const instances = this.executor.getInstances();
    if (instances.length === 0) return;

    const results = await this.healthService.checkAllSlots(instances);

    // Update slots in memory and DB
    for (const [slotId, result] of results) {
      const inst = instances.find(i => i.id === slotId);
      if (inst) {
        inst.health = result.status;
      }

      // Persist to DB
      try {
        await this.db.collection(SLOTS_COLLECTION).updateOne(
          { _id: new ObjectId(slotId) },
          {
            $set: {
              'health.status': result.status,
              'health.lastCheckAt': Date.now(),
              'health.lastError': result.error,
              updatedAt: Date.now(),
            },
          }
        );
      } catch (error) {
        console.error(`[ExecutionAdapter] Failed to update health for ${slotId}:`, error);
      }
    }

    // Update executor with new health states
    this.executor.setInstances(instances);
  }

  /**
   * Check health of specific slot
   */
  async checkSlotHealth(slotId: string): Promise<HealthCheckResult> {
    const inst = this.executor.getInstances().find(i => i.id === slotId);
    if (!inst) {
      return { status: 'ERROR', error: 'Slot not found' };
    }
    return this.healthService.checkHealth(inst);
  }

  // ==================== Execution API ====================

  /**
   * Execute search task (sync)
   */
  async search(query: string, maxResults = 100): Promise<ExecutionResult> {
    await this.ensureSync();
    const result = await this.executor.runSync('SEARCH', { q: query, maxResults });
    
    // Store results if successful
    if (result.ok && result.data && this.storageService) {
      const items = result.data.items || result.data.tweets || result.data;
      if (Array.isArray(items)) {
        await this.storageService.storeTweets(items, 'SEARCH', {
          query,
          slotId: result.meta?.instanceId,
          accountId: result.meta?.accountId,
        });
      }
    }

    // Sync counters to DB
    await this.syncToDatabase();
    
    return result;
  }

  /**
   * Execute account tweets task (sync)
   */
  async getAccountTweets(username: string, maxResults = 100): Promise<ExecutionResult> {
    await this.ensureSync();
    const result = await this.executor.runSync('ACCOUNT_TWEETS', { username, maxResults });
    
    // Store results if successful
    if (result.ok && result.data && this.storageService) {
      const items = result.data.items || result.data.tweets || result.data;
      if (Array.isArray(items)) {
        await this.storageService.storeTweets(items, 'ACCOUNT_TWEETS', {
          username,
          slotId: result.meta?.instanceId,
          accountId: result.meta?.accountId,
        });
      }
      // Store account info if present
      if (result.data.user) {
        await this.storageService.storeAccount(result.data.user, {
          slotId: result.meta?.instanceId,
          accountId: result.meta?.accountId,
        });
      }
    }

    await this.syncToDatabase();
    return result;
  }

  /**
   * Execute account followers task (sync)
   */
  async getAccountFollowers(username: string, maxResults = 100): Promise<ExecutionResult> {
    await this.ensureSync();
    const result = await this.executor.runSync('ACCOUNT_FOLLOWERS', { username, maxResults });
    await this.syncToDatabase();
    return result;
  }

  // ==================== Task Queue API ====================

  /**
   * Queue task for async execution
   */
  async queueTask(dto: CreateExecutionTaskDto): Promise<{ ok: boolean; taskId?: string; error?: string }> {
    if (!this.storageService) {
      return { ok: false, error: 'Storage not initialized' };
    }

    await this.ensureSync();
    
    // Check for active account
    const activeAccount = state.accounts.find(a => a.enabled);
    if (!activeAccount) {
      return { ok: false, error: 'No active Twitter account configured' };
    }

    const task = await this.storageService.createTask(dto);
    
    // Start worker if not running
    this.executor.startWorker();
    
    return { ok: true, taskId: task._id };
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<{
    found: boolean;
    task?: ReturnType<typeof executionTaskToDTO>;
  }> {
    if (!this.storageService) {
      return { found: false };
    }

    const task = await this.storageService.getTask(taskId);
    if (!task) {
      return { found: false };
    }

    return {
      found: true,
      task: executionTaskToDTO(task),
    };
  }

  /**
   * Get recent tasks
   */
  async getRecentTasks(status?: string, limit = 50): Promise<ExecutionTask[]> {
    if (!this.storageService) return [];
    
    if (status) {
      return this.storageService.getTasksByStatus(status as any, limit);
    }

    // Get all recent tasks
    const [queued, running, done, failed] = await Promise.all([
      this.storageService.getTasksByStatus('QUEUED', 20),
      this.storageService.getTasksByStatus('RUNNING', 10),
      this.storageService.getTasksByStatus('DONE', 20),
      this.storageService.getTasksByStatus('FAILED', 10),
    ]);

    return [...running, ...queued, ...done, ...failed].slice(0, limit);
  }

  /**
   * Get task statistics
   */
  async getTaskStats() {
    if (!this.storageService) {
      return { queued: 0, running: 0, done: 0, failed: 0, total: 0 };
    }
    return this.storageService.getTaskStats();
  }

  // ==================== Cached Data API ====================

  /**
   * Get cached tweets by query
   */
  async getCachedTweetsByQuery(query: string, limit = 100) {
    if (!this.storageService) return [];
    return this.storageService.getTweetsByQuery(query, limit);
  }

  /**
   * Get cached tweets by username
   */
  async getCachedTweetsByUsername(username: string, limit = 100) {
    if (!this.storageService) return [];
    return this.storageService.getTweetsByUsername(username, limit);
  }

  /**
   * Get cached account
   */
  async getCachedAccount(username: string) {
    if (!this.storageService) return null;
    return this.storageService.getAccount(username);
  }

  // ==================== Monitoring ====================

  /**
   * Get execution status
   */
  getStatus(): {
    worker: ReturnType<TwitterParserExecutor['getWorkerStatus']>;
    capacity: ReturnType<TwitterParserExecutor['getCapacityInfo']>;
    lastSync: number;
    accountsCount: number;
    instancesCount: number;
    runtime: ReturnType<typeof runtimeRegistry.getSummary>;
  } {
    return {
      worker: this.executor.getWorkerStatus(),
      capacity: this.executor.getCapacityInfo(),
      lastSync: state.lastSync,
      accountsCount: state.accounts.length,
      instancesCount: state.instances.length,
      runtime: runtimeRegistry.getSummary(),
    };
  }

  /**
   * Get detailed status with task stats and runtime info
   */
  async getDetailedStatus() {
    const baseStatus = this.getStatus();
    const taskStats = await this.getTaskStats();
    
    // Get runtime details per slot
    const runtimeDetails: Record<string, any> = {};
    for (const slotId of runtimeRegistry.getSlotIds()) {
      const health = runtimeRegistry.getHealth(slotId);
      const runtime = runtimeRegistry.getRuntime(slotId);
      runtimeDetails[slotId] = {
        sourceType: runtime?.sourceType || 'UNKNOWN',
        health: health?.status || 'UNKNOWN',
        lastCheckedAt: health?.lastCheckedAt,
        error: health?.error,
      };
    }
    
    return {
      ...baseStatus,
      tasks: taskStats,
      runtimeDetails,
    };
  }

  /**
   * Start worker
   */
  startWorker(): void {
    this.executor.startWorker();
  }

  /**
   * Stop worker
   */
  stopWorker(): void {
    this.executor.stopWorker();
  }

  /**
   * Reset all counters
   */
  async resetCounters(): Promise<void> {
    this.executor.resetAllCounters();
    await this.syncToDatabase();
  }

  /**
   * Force health check
   */
  async forceHealthCheck(): Promise<Map<string, HealthCheckResult>> {
    const instances = this.executor.getInstances();
    const results = await this.healthService.checkAllSlots(instances);
    await this.runHealthChecks();
    return results;
  }

  /**
   * Check runtime health for a specific slot using Runtime Layer
   */
  async checkRuntimeHealth(slotId: string): Promise<RuntimeStatus> {
    const inst = this.executor.getInstances().find(i => i.id === slotId);
    if (!inst) {
      return 'ERROR';
    }
    return runtimeDispatcher.checkHealth(inst);
  }

  /**
   * Execute task using Runtime Layer directly
   */
  async executeWithRuntime(
    taskType: ParserTaskType,
    payload: Record<string, any>
  ): Promise<ExecutionResult> {
    await this.ensureSync();
    
    // Select a slot
    const instances = this.executor.getInstances();
    const activeSlot = instances.find(i => i.enabled && !i.cooldownUntil);
    
    if (!activeSlot) {
      return {
        ok: false,
        error: 'No available slot',
        errorCode: 'NO_AVAILABLE_SLOT',
      };
    }

    // Create task
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: taskType,
      payload,
      attempts: 0,
      maxAttempts: 3,
      status: 'RUNNING' as const,
      createdAt: Date.now(),
    };

    // Execute via runtime dispatcher
    const result = await runtimeDispatcher.dispatch(activeSlot, task);
    
    // Store results if successful
    if (result.ok && result.data && this.storageService) {
      if (taskType === 'SEARCH') {
        await this.storageService.storeTweets(result.data, 'SEARCH', {
          query: payload.q || payload.keyword,
          slotId: activeSlot.id,
          accountId: activeSlot.accountId,
        });
      } else if (taskType === 'ACCOUNT_TWEETS') {
        await this.storageService.storeTweets(result.data, 'ACCOUNT_TWEETS', {
          username: payload.username,
          slotId: activeSlot.id,
          accountId: activeSlot.accountId,
        });
      }
    }

    return result;
  }

  // ==================== Helpers ====================

  private async ensureSync(): Promise<void> {
    // Sync if stale (more than 30 seconds old)
    if (Date.now() - state.lastSync > 30000) {
      await this.syncFromDatabase();
    }
  }
}

// Singleton adapter
export const twitterExecutionAdapter = new TwitterExecutionAdapter();
