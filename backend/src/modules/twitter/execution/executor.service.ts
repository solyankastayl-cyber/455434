// B2 Execution Core - Executor Service
// Main facade for parser execution (P2: Mongo Queue)

import {
  ParserTask,
  ParserTaskType,
  ParserInstance,
  ExecutionAccount,
  ExecutionResult,
  ExecutionErrorCodes,
  createTask,
} from './types.js';
import { slotSelector, SlotSelector } from './slot.selector.js';
import { dispatcher, Dispatcher } from './dispatcher.js';
import { countersService, CountersService } from './counters.service.js';
import { cooldownService, CooldownService } from './cooldown.service.js';
import { MongoTaskQueue, mongoTaskQueue } from './queue/mongo.queue.js';
import { MongoTaskWorker, mongoTaskWorker } from './worker/mongo.worker.js';
import { TaskType, TaskPriority } from './queue/task.model.js';

export class TwitterParserExecutor {
  private instancesStore: ParserInstance[] = [];
  private accountsStore: ExecutionAccount[] = [];
  private workerStarted = false;

  constructor(
    private queue: MongoTaskQueue = mongoTaskQueue,
    private worker: MongoTaskWorker = mongoTaskWorker,
    private selector: SlotSelector = slotSelector,
    private dispatcherService: Dispatcher = dispatcher,
    private counters: CountersService = countersService,
    private cooldown: CooldownService = cooldownService
  ) {
    // Set provider for instances
    this.worker.setInstancesProvider(() => this.instancesStore);
  }

  // ==================== Store Management (B1 → B2) ====================

  /**
   * Update instances from B1 Control Plane
   */
  setInstances(instances: ParserInstance[]): void {
    this.instancesStore = instances;
  }

  /**
   * Update accounts from B1 Control Plane
   */
  setAccounts(accounts: ExecutionAccount[]): void {
    this.accountsStore = accounts;
  }

  /**
   * Get current instances (for monitoring)
   */
  getInstances(): ParserInstance[] {
    return [...this.instancesStore];
  }

  /**
   * Get current accounts (for monitoring)
   */
  getAccounts(): ExecutionAccount[] {
    return [...this.accountsStore];
  }

  // ==================== Execution ====================

  /**
   * Execute task synchronously (blocking)
   * Use for simple/urgent requests
   */
  async runSync(
    type: ParserTaskType,
    payload: Record<string, any>
  ): Promise<ExecutionResult> {
    // Check for active account
    const activeAccount = this.accountsStore.find(a => a.enabled);
    if (!activeAccount) {
      return {
        ok: false,
        error: 'No active Twitter account configured',
        errorCode: ExecutionErrorCodes.NO_ACTIVE_ACCOUNT,
      };
    }

    // Select slot
    const slot = this.selector.select(this.instancesStore);
    if (!slot) {
      const diagnostics = this.selector.getDiagnostics(this.instancesStore);
      return {
        ok: false,
        error: this.getNoSlotError(diagnostics),
        errorCode: ExecutionErrorCodes.NO_AVAILABLE_SLOT,
      };
    }

    // Create task
    const task = createTask(type, payload);
    task.accountId = activeAccount.id;
    task.instanceId = slot.id;

    // Execute
    const result = await this.dispatcherService.dispatch(slot, task);

    if (result.ok) {
      this.counters.increment(slot);
    } else {
      this.cooldown.apply(slot, { errorCode: result.errorCode });
    }

    return result;
  }

  /**
   * Queue task for async execution (P2: Mongo-backed)
   * Returns immediately with task ID
   */
  async runAsync(
    type: ParserTaskType,
    payload: Record<string, any>,
    options: { priority?: TaskPriority; maxAttempts?: number } = {}
  ): Promise<{ ok: boolean; taskId?: string; error?: string }> {
    // Check for active account
    const activeAccount = this.accountsStore.find(a => a.enabled);
    if (!activeAccount) {
      return {
        ok: false,
        error: 'No active Twitter account configured',
      };
    }

    try {
      // Enqueue to Mongo
      const taskId = await this.queue.enqueue(
        type as TaskType,
        payload,
        {
          priority: options.priority,
          maxAttempts: options.maxAttempts,
          accountId: activeAccount.id,
        }
      );

      // Ensure worker is running
      this.ensureWorkerRunning();

      return {
        ok: true,
        taskId,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to enqueue task',
      };
    }
  }

  /**
   * Get task status and result
   */
  async getTaskStatus(taskId: string): Promise<{
    found: boolean;
    task?: ParserTask;
    result?: any;
  }> {
    const task = await this.queue.get(taskId);
    if (!task) {
      return { found: false };
    }

    return {
      found: true,
      task: this.queue.toParserTask(task),
      result: task.status === 'DONE' ? task.result : undefined,
    };
  }

  // ==================== Worker Control ====================

  /**
   * Start background worker
   */
  startWorker(): void {
    this.worker.start();
    this.workerStarted = true;
  }

  /**
   * Stop background worker
   */
  async stopWorker(): Promise<void> {
    await this.worker.stop();
    this.workerStarted = false;
  }

  /**
   * Ensure worker is running
   */
  private ensureWorkerRunning(): void {
    if (!this.workerStarted && !this.worker.isRunning()) {
      this.startWorker();
    }
  }

  /**
   * Get worker status
   */
  async getWorkerStatus(): Promise<Awaited<ReturnType<MongoTaskWorker['getStatus']>>> {
    return this.worker.getStatus();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<Awaited<ReturnType<MongoTaskQueue['getStats']>>> {
    return this.queue.getStats();
  }

  /**
   * Get recent tasks (for monitoring)
   */
  async getRecentTasks(limit: number = 50): Promise<ParserTask[]> {
    const tasks = await this.queue.getRecent(limit);
    return tasks.map(t => this.queue.toParserTask(t));
  }

  // ==================== Capacity & Monitoring ====================

  /**
   * Get current capacity info
   */
  getCapacityInfo(): {
    totalCapacity: number;
    usedThisHour: number;
    availableThisHour: number;
    activeInstances: number;
    inCooldown: number;
    rateLimited: number;
  } {
    const diagnostics = this.selector.getDiagnostics(this.instancesStore);
    
    let totalCapacity = 0;
    let usedThisHour = 0;

    for (const inst of this.instancesStore) {
      if (inst.enabled) {
        totalCapacity += inst.limitPerHour;
        usedThisHour += inst.usedInWindow;
      }
    }

    return {
      totalCapacity,
      usedThisHour,
      availableThisHour: Math.max(0, totalCapacity - usedThisHour),
      activeInstances: diagnostics.available,
      inCooldown: diagnostics.inCooldown,
      rateLimited: diagnostics.rateLimited,
    };
  }

  /**
   * Reset all counters (for testing/admin)
   */
  resetAllCounters(): void {
    for (const inst of this.instancesStore) {
      this.counters.forceReset(inst);
      this.cooldown.clear(inst);
    }
  }

  // ==================== Helpers ====================

  private getNoSlotError(diagnostics: ReturnType<SlotSelector['getDiagnostics']>): string {
    if (diagnostics.total === 0) {
      return 'No parser instances configured. Add instances in Admin → Twitter Parser → Slots';
    }
    if (diagnostics.enabled === 0) {
      return 'All parser instances are disabled';
    }
    if (diagnostics.rateLimited > 0 && diagnostics.inCooldown === 0) {
      return 'All instances have reached hourly rate limit. Try again later.';
    }
    if (diagnostics.inCooldown > 0) {
      return `All instances are in cooldown (${diagnostics.inCooldown} in cooldown)`;
    }
    return 'No available parser instance';
  }
}

// Singleton executor
export const twitterParserExecutor = new TwitterParserExecutor();
