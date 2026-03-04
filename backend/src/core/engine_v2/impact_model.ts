/**
 * Engine V2: Signal Impact Model
 * 
 * Computes individual signal impact for Evidence calculation.
 * Uses lifecycle, freshness, cluster quality, and penalties.
 */
import type { D1Signal, D1Status, D1Confidence } from '../d1_signals/d1_signal.types.js';
import type { EngineWindow } from './signals_fetcher.js';

// Lifecycle weight mapping
const LIFECYCLE_WEIGHT: Record<D1Status, number> = {
  'new': 0.8,
  'active': 1.0,
  'cooling': 0.6,
  'archived': 0.1,
};

// Confidence to numeric
const CONFIDENCE_NUMERIC: Record<D1Confidence, number> = {
  'low': 40,
  'medium': 65,
  'high': 90,
};

/**
 * Exponential decay based on time window
 */
function expDecay(hours: number, window: EngineWindow): number {
  // μ tuned: shorter windows decay faster
  const mu = window === '1h' ? 0.25 :
             window === '6h' ? 0.08 :
             window === '24h' ? 0.03 : 0.01;
  return Math.exp(-mu * Math.max(0, hours));
}

/**
 * Cluster quality factor
 * - passed + low dominance = good (1.0)
 * - passed + high dominance = reduced (0.5)
 * - failed = penalized (0.5 * (1-dominance))
 */
function clusterQuality(passed: boolean, dominance: number): number {
  const d = Math.min(1, Math.max(0, dominance ?? 1));
  return passed ? (1 - 0.5 * d) : (0.5 * (1 - d));
}

/**
 * Penalty factor based on signal quality indicators
 */
function penaltyFactor(signal: D1Signal): number {
  const penalties: string[] = [];
  
  // Check severity
  if (signal.severity === 'low') {
    penalties.push('low_severity');
  }
  
  // Check confidence
  if (signal.confidence === 'low') {
    penalties.push('low_confidence');
  }
  
  // Check evidence quality
  if (!signal.evidence?.topEdges?.length) {
    penalties.push('no_evidence');
  }
  
  if (penalties.length === 0) return 1.0;
  if (penalties.includes('no_evidence') && penalties.includes('low_confidence')) return 0.70;
  if (penalties.includes('low_confidence')) return 0.75;
  
  return 0.85;
}

export interface SignalImpactResult {
  impact: number;
  lifecycleW: number;
  freshness: number;
  clusterQuality: number;
  penaltyFactor: number;
  confidence: number;
  dominance: number;
  passed: boolean;
  penalties: string[];
  hoursSince: number;
}

/**
 * Compute signal impact score
 */
export function computeSignalImpact(
  signal: D1Signal,
  window: EngineWindow,
  now = new Date()
): SignalImpactResult {
  const status = signal.status;
  const lifecycleW = LIFECYCLE_WEIGHT[status] ?? 0.6;
  
  // Time since update
  const updatedAt = new Date(signal.updatedAt ?? signal.createdAt ?? now);
  const hours = (now.getTime() - updatedAt.getTime()) / 36e5;
  
  const freshness = expDecay(hours, window);
  
  // Cluster analysis from evidence
  const topEdges = signal.evidence?.topEdges ?? [];
  const hasHighConfidence = topEdges.some(e => e.confidence === 'high');
  const passed = hasHighConfidence || signal.confidence === 'high';
  
  // Calculate dominance from edges
  let dominance = 1;
  if (topEdges.length > 0) {
    const totalWeight = topEdges.reduce((sum, e) => sum + (e.weight ?? 0), 0);
    const maxWeight = Math.max(...topEdges.map(e => e.weight ?? 0));
    dominance = totalWeight > 0 ? maxWeight / totalWeight : 1;
  }
  
  const cq = clusterQuality(passed, dominance);
  const pf = penaltyFactor(signal);
  
  const confidence = CONFIDENCE_NUMERIC[signal.confidence] ?? 50;
  const confidenceNorm = confidence / 100;
  
  // Final impact calculation
  const impact = confidenceNorm * lifecycleW * freshness * cq * pf;
  
  // Collect penalties for reporting
  const penalties: string[] = [];
  if (signal.severity === 'low') penalties.push('low_severity');
  if (signal.confidence === 'low') penalties.push('low_confidence');
  if (dominance > 0.85) penalties.push('strong_dominance');
  if (!passed) penalties.push('cluster_not_passed');
  
  return {
    impact,
    lifecycleW,
    freshness,
    clusterQuality: cq,
    penaltyFactor: pf,
    confidence,
    dominance,
    passed,
    penalties,
    hoursSince: hours,
  };
}
