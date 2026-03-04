// B2 Execution Core - Live Task Queue
// In-memory task queue for async execution

import { ParserTask } from '../types.js';

export class LiveTaskQueue {
  private queue: ParserTask[] = [];
  private results: Map<string, any> = new Map();
  private maxQueueSize = 1000;

  /**
   * Add task to queue
   */
  enqueue(task: ParserTask): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      // Remove oldest completed/failed tasks
      this.cleanup();
    }

    if (this.queue.length >= this.maxQueueSize) {
      return false; // Queue full
    }

    this.queue.push(task);
    return true;
  }

  /**
   * Get next pending task
   */
  next(): ParserTask | undefined {
    return this.queue.find(t => t.status === 'PENDING');
  }

  /**
   * Get task by ID
   */
  get(taskId: string): ParserTask | undefined {
    return this.queue.find(t => t.id === taskId);
  }

  /**
   * Mark task as running
   */
  markRunning(taskId: string): void {
    const task = this.queue.find(t => t.id === taskId);
    if (task) {
      task.status = 'RUNNING';
      task.startedAt = Date.now();
    }
  }

  /**
   * Mark task as done with result
   */
  markDone(taskId: string, result?: any): void {
    const task = this.queue.find(t => t.id === taskId);
    if (task) {
      task.status = 'DONE';
      task.completedAt = Date.now();
      if (result !== undefined) {
        this.results.set(taskId, result);
      }
    }
  }

  /**
   * Mark task as failed
   */
  markFailed(taskId: string, error: string): void {
    const task = this.queue.find(t => t.id === taskId);
    if (task) {
      task.status = 'FAILED';
      task.lastError = error;
      task.completedAt = Date.now();
    }
  }

  /**
   * Retry task (reset to pending with incremented attempts)
   */
  retry(taskId: string): boolean {
    const task = this.queue.find(t => t.id === taskId);
    if (task && task.attempts < task.maxAttempts) {
      task.status = 'PENDING';
      task.attempts++;
      return true;
    }
    return false;
  }

  /**
   * Get result for completed task
   */
  getResult(taskId: string): any {
    return this.results.get(taskId);
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
  } {
    let pending = 0;
    let running = 0;
    let done = 0;
    let failed = 0;

    for (const task of this.queue) {
      switch (task.status) {
        case 'PENDING': pending++; break;
        case 'RUNNING': running++; break;
        case 'DONE': done++; break;
        case 'FAILED': failed++; break;
      }
    }

    return {
      total: this.queue.length,
      pending,
      running,
      done,
      failed,
    };
  }

  /**
   * Get all tasks (for monitoring)
   */
  getAll(): ParserTask[] {
    return [...this.queue];
  }

  /**
   * Cleanup old completed/failed tasks
   */
  cleanup(): number {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    const before = this.queue.length;
    
    this.queue = this.queue.filter(task => {
      // Keep pending and running tasks
      if (task.status === 'PENDING' || task.status === 'RUNNING') {
        return true;
      }
      // Keep recent completed/failed tasks
      if (task.completedAt && now - task.completedAt < maxAge) {
        return true;
      }
      // Remove old results
      this.results.delete(task.id);
      return false;
    });

    return before - this.queue.length;
  }

  /**
   * Clear all tasks (for testing)
   */
  clear(): void {
    this.queue = [];
    this.results.clear();
  }
}

// Singleton export
export const liveTaskQueue = new LiveTaskQueue();
