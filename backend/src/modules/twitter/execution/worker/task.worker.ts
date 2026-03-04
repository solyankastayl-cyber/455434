// B2 Execution Core - Task Worker
// Background worker that processes tasks from the queue

import { LiveTaskQueue } from '../queue/live.queue.js';
import { ParserTask, ParserInstance, ExecutionResult, ExecutionErrorCodes } from '../types.js';
import { SlotSelector } from '../slot.selector.js';
import { Dispatcher } from '../dispatcher.js';
import { CountersService } from '../counters.service.js';
import { CooldownService } from '../cooldown.service.js';

const POLL_INTERVAL = 500; // ms between queue checks
const MAX_CONCURRENT = 3;  // max concurrent tasks

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class TaskWorker {
  private running = false;
  private currentTasks = 0;
  private instancesProvider: () => ParserInstance[];

  constructor(
    private queue: LiveTaskQueue,
    private selector: SlotSelector,
    private dispatcher: Dispatcher,
    private counters: CountersService,
    private cooldown: CooldownService
  ) {
    // Default empty provider - must be set via setInstancesProvider
    this.instancesProvider = () => [];
  }

  /**
   * Set the provider function for getting current instances
   * This connects B1 (Control Plane) to B2 (Execution)
   */
  setInstancesProvider(provider: () => ParserInstance[]): void {
    this.instancesProvider = provider;
  }

  /**
   * Start the worker loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
    console.log('[TaskWorker] Started');
  }

  /**
   * Stop the worker loop
   */
  stop(): void {
    this.running = false;
    console.log('[TaskWorker] Stopped');
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
  getStatus(): {
    running: boolean;
    currentTasks: number;
    queueStats: ReturnType<LiveTaskQueue['getStats']>;
  } {
    return {
      running: this.running,
      currentTasks: this.currentTasks,
      queueStats: this.queue.getStats(),
    };
  }

  /**
   * Main worker loop
   */
  private async loop(): Promise<void> {
    while (this.running) {
      // Check if we can take more tasks
      if (this.currentTasks >= MAX_CONCURRENT) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Get next pending task
      const task = this.queue.next();
      if (!task) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Execute task (don't await - allow concurrent)
      this.executeTask(task).catch(err => {
        console.error('[TaskWorker] Unhandled error:', err);
      });
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: ParserTask): Promise<ExecutionResult> {
    this.currentTasks++;
    this.queue.markRunning(task.id);

    try {
      // Get current instances from B1
      const instances = this.instancesProvider();

      // Select best slot
      const slot = this.selector.select(instances);
      if (!slot) {
        const diagnostics = this.selector.getDiagnostics(instances);
        const error = this.getNoSlotError(diagnostics);
        
        // Retry if we haven't exceeded max attempts
        if (task.attempts < task.maxAttempts - 1) {
          this.queue.retry(task.id);
        } else {
          this.queue.markFailed(task.id, error);
        }
        
        return { ok: false, error, errorCode: ExecutionErrorCodes.NO_AVAILABLE_SLOT };
      }

      // Update task with slot info
      task.instanceId = slot.id;
      task.accountId = slot.accountId;

      // Dispatch to parser
      const result = await this.dispatcher.dispatch(slot, task);

      if (result.ok) {
        // Success - increment counter and mark done
        this.counters.increment(slot);
        this.queue.markDone(task.id, result.data);
        return result;
      } else {
        // Error - apply cooldown and potentially retry
        this.cooldown.apply(slot, { errorCode: result.errorCode });
        
        if (task.attempts < task.maxAttempts - 1) {
          this.queue.retry(task.id);
        } else {
          this.queue.markFailed(task.id, result.error || 'Unknown error');
        }
        
        return result;
      }
    } catch (error: any) {
      this.queue.markFailed(task.id, error.message || 'Execution error');
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
      return 'All instances are in cooldown due to recent errors';
    }
    return 'No available parser instance';
  }
}

// Factory function
export function createTaskWorker(
  queue: LiveTaskQueue,
  selector: SlotSelector,
  dispatcher: Dispatcher,
  counters: CountersService,
  cooldown: CooldownService
): TaskWorker {
  return new TaskWorker(queue, selector, dispatcher, counters, cooldown);
}
