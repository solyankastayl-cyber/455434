// P3 FREEZE Validation - Metrics Service
// Centralized metrics collection for execution pipeline

export interface LatencyHistogram {
  samples: number[];
  count: number;
}

export interface MetricsSnapshot {
  counters: {
    tasksEnqueued: number;
    tasksStarted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    tasksRetried: number;
    runtimeCalls: number;
    runtimeErrors: number;
    rateLimitHits: number;
    cooldownsTriggered: number;
    slotSelectionSkips: number;
  };
  latency: {
    runtimeP50: number;
    runtimeP95: number;
    mongoP50: number;
    mongoP95: number;
  };
  queue: {
    depth: number;
    maxDepth: number;
  };
  timestamp: number;
  windowStartedAt: number;
}

export class MetricsService {
  private counters = {
    tasksEnqueued: 0,
    tasksStarted: 0,
    tasksSucceeded: 0,
    tasksFailed: 0,
    tasksRetried: 0,
    runtimeCalls: 0,
    runtimeErrors: 0,
    rateLimitHits: 0,
    cooldownsTriggered: 0,
    slotSelectionSkips: 0,
  };

  private runtimeLatencies: number[] = [];
  private mongoLatencies: number[] = [];
  private maxQueueDepth = 0;
  private windowStartedAt = Date.now();

  // Counter increments
  incTasksEnqueued(): void { this.counters.tasksEnqueued++; }
  incTasksStarted(): void { this.counters.tasksStarted++; }
  incTasksSucceeded(): void { this.counters.tasksSucceeded++; }
  incTasksFailed(): void { this.counters.tasksFailed++; }
  incTasksRetried(): void { this.counters.tasksRetried++; }
  incRuntimeCalls(): void { this.counters.runtimeCalls++; }
  incRuntimeErrors(): void { this.counters.runtimeErrors++; }
  incRateLimitHits(): void { this.counters.rateLimitHits++; }
  incCooldownsTriggered(): void { this.counters.cooldownsTriggered++; }
  incSlotSelectionSkips(): void { this.counters.slotSelectionSkips++; }

  // P2: Direct setters for queue-based metrics
  setTasksSucceeded(count: number): void { this.counters.tasksSucceeded = count; }
  setTasksFailed(count: number): void { this.counters.tasksFailed = count; }

  // Latency recording
  recordRuntimeLatency(ms: number): void {
    this.runtimeLatencies.push(ms);
    // Keep last 1000 samples
    if (this.runtimeLatencies.length > 1000) {
      this.runtimeLatencies.shift();
    }
  }

  recordMongoLatency(ms: number): void {
    this.mongoLatencies.push(ms);
    if (this.mongoLatencies.length > 1000) {
      this.mongoLatencies.shift();
    }
  }

  // Queue depth tracking
  updateQueueDepth(depth: number): void {
    if (depth > this.maxQueueDepth) {
      this.maxQueueDepth = depth;
    }
  }

  // Calculate percentile
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  // Get snapshot
  getSnapshot(currentQueueDepth: number): MetricsSnapshot {
    this.updateQueueDepth(currentQueueDepth);
    
    return {
      counters: { ...this.counters },
      latency: {
        runtimeP50: this.percentile(this.runtimeLatencies, 50),
        runtimeP95: this.percentile(this.runtimeLatencies, 95),
        mongoP50: this.percentile(this.mongoLatencies, 50),
        mongoP95: this.percentile(this.mongoLatencies, 95),
      },
      queue: {
        depth: currentQueueDepth,
        maxDepth: this.maxQueueDepth,
      },
      timestamp: Date.now(),
      windowStartedAt: this.windowStartedAt,
    };
  }

  // Reset all metrics
  reset(): void {
    this.counters = {
      tasksEnqueued: 0,
      tasksStarted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      tasksRetried: 0,
      runtimeCalls: 0,
      runtimeErrors: 0,
      rateLimitHits: 0,
      cooldownsTriggered: 0,
      slotSelectionSkips: 0,
    };
    this.runtimeLatencies = [];
    this.mongoLatencies = [];
    this.maxQueueDepth = 0;
    this.windowStartedAt = Date.now();
  }
}

// Singleton
export const metricsService = new MetricsService();
