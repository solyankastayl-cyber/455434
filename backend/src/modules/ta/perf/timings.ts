/**
 * Phase U: Performance Engine - Timings & Observability
 * 
 * Track execution time per phase for metrics and optimization.
 */

export interface PhaseTimings {
  features_ms: number;
  gating_ms: number;
  families_ms: number;
  merge_ms: number;
  total_ms: number;
  
  // Per-family breakdown
  family_timings: Record<string, number>;
  family_counts: Record<string, number>;
}

export interface TimingCollector {
  start(phase: string): void;
  end(phase: string): number;
  startFamily(family: string): void;
  endFamily(family: string, count: number): number;
  getTimings(): PhaseTimings;
  reset(): void;
}

/**
 * Create a timing collector
 */
export function createTimingCollector(): TimingCollector {
  const starts: Map<string, number> = new Map();
  const durations: Map<string, number> = new Map();
  const familyTimings: Map<string, number> = new Map();
  const familyCounts: Map<string, number> = new Map();
  
  let totalStart = 0;
  
  return {
    start(phase: string): void {
      if (phase === 'total') {
        totalStart = Date.now();
      }
      starts.set(phase, Date.now());
    },
    
    end(phase: string): number {
      const start = starts.get(phase);
      if (!start) return 0;
      
      const duration = Date.now() - start;
      durations.set(phase, duration);
      starts.delete(phase);
      
      return duration;
    },
    
    startFamily(family: string): void {
      starts.set(`family_${family}`, Date.now());
    },
    
    endFamily(family: string, count: number): number {
      const start = starts.get(`family_${family}`);
      if (!start) return 0;
      
      const duration = Date.now() - start;
      familyTimings.set(family, duration);
      familyCounts.set(family, count);
      starts.delete(`family_${family}`);
      
      return duration;
    },
    
    getTimings(): PhaseTimings {
      const total_ms = totalStart ? Date.now() - totalStart : 
        (durations.get('total') || 0);
      
      return {
        features_ms: durations.get('features') || 0,
        gating_ms: durations.get('gating') || 0,
        families_ms: durations.get('families') || 0,
        merge_ms: durations.get('merge') || 0,
        total_ms,
        family_timings: Object.fromEntries(familyTimings),
        family_counts: Object.fromEntries(familyCounts),
      };
    },
    
    reset(): void {
      starts.clear();
      durations.clear();
      familyTimings.clear();
      familyCounts.clear();
      totalStart = 0;
    },
  };
}

/**
 * Log timings in structured format
 */
export function logTimings(timings: PhaseTimings, requestId?: string): void {
  const base = {
    phase: 'perf',
    requestId,
    ...timings,
  };
  
  // In production, this would go to structured logging
  console.log('[TA Perf]', JSON.stringify(base));
}

/**
 * Calculate performance metrics from timings
 */
export function analyzeTimings(timings: PhaseTimings): {
  bottleneck: string;
  suggestions: string[];
} {
  const phases = [
    { name: 'features', ms: timings.features_ms },
    { name: 'families', ms: timings.families_ms },
    { name: 'merge', ms: timings.merge_ms },
  ];
  
  phases.sort((a, b) => b.ms - a.ms);
  const bottleneck = phases[0]?.name || 'unknown';
  
  const suggestions: string[] = [];
  
  // Suggest optimizations based on bottleneck
  if (timings.features_ms > 100) {
    suggestions.push('Consider pre-computing features');
  }
  
  if (timings.families_ms > 500) {
    suggestions.push('Increase parallelism or reduce active families');
  }
  
  if (timings.merge_ms > 50) {
    suggestions.push('Too many patterns - tighten budgets');
  }
  
  // Check slow families
  for (const [family, ms] of Object.entries(timings.family_timings)) {
    if (ms > 200) {
      suggestions.push(`Family ${family} is slow (${ms}ms)`);
    }
  }
  
  return { bottleneck, suggestions };
}
