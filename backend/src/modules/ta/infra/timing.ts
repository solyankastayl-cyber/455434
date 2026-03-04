/**
 * Phase S4.3: Timing Utilities
 * For measuring pipeline phase durations
 */

export interface TimingEntry {
  phase: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
}

export class Timer {
  private entries: Map<string, TimingEntry> = new Map();
  private order: string[] = [];
  
  /**
   * Start timing a phase
   */
  start(phase: string): void {
    const entry: TimingEntry = {
      phase,
      startMs: Date.now(),
    };
    this.entries.set(phase, entry);
    if (!this.order.includes(phase)) {
      this.order.push(phase);
    }
  }
  
  /**
   * End timing a phase
   */
  end(phase: string): number {
    const entry = this.entries.get(phase);
    if (!entry) {
      console.warn(`[Timer] Phase "${phase}" was not started`);
      return 0;
    }
    
    entry.endMs = Date.now();
    entry.durationMs = entry.endMs - entry.startMs;
    return entry.durationMs;
  }
  
  /**
   * Time an async function
   */
  async timeAsync<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    this.start(phase);
    try {
      return await fn();
    } finally {
      this.end(phase);
    }
  }
  
  /**
   * Time a sync function
   */
  timeSync<T>(phase: string, fn: () => T): T {
    this.start(phase);
    try {
      return fn();
    } finally {
      this.end(phase);
    }
  }
  
  /**
   * Get duration of a phase
   */
  getDuration(phase: string): number {
    const entry = this.entries.get(phase);
    return entry?.durationMs ?? 0;
  }
  
  /**
   * Get all timings
   */
  getAll(): TimingEntry[] {
    return this.order.map(phase => this.entries.get(phase)!).filter(Boolean);
  }
  
  /**
   * Get total duration
   */
  getTotal(): number {
    return this.getAll().reduce((sum, e) => sum + (e.durationMs || 0), 0);
  }
  
  /**
   * Get summary object
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const entry of this.getAll()) {
      summary[entry.phase] = entry.durationMs || 0;
    }
    summary._total = this.getTotal();
    return summary;
  }
  
  /**
   * Reset timer
   */
  reset(): void {
    this.entries.clear();
    this.order = [];
  }
}

/**
 * Create new timer
 */
export function createTimer(): Timer {
  return new Timer();
}

/**
 * Standard TA pipeline phases
 */
export const TA_PHASES = {
  FETCH_DATA: 'fetch_data',
  COMPUTE_PIVOTS: 'pivots',
  COMPUTE_LEVELS: 'levels',
  COMPUTE_INDICATORS: 'indicators',
  RUN_DETECTORS: 'detectors',
  RELIABILITY_SCORE: 'reliability',
  BUILD_HYPOTHESES: 'hypotheses',
  BUILD_SCENARIOS: 'scenarios',
  RISK_PACK: 'risk_pack',
  CALIBRATION: 'calibration',
  ML_OVERLAY: 'ml_overlay',
  TOTAL: '_total',
} as const;
