/**
 * Engine V2: Evidence & Direction Calculator
 * 
 * Aggregates signal impacts into Evidence (0-100) and Direction (-100..100)
 * with top signals attribution.
 */
import type { D1Signal } from '../d1_signals/d1_signal.types.js';
import type { EngineWindow } from './signals_fetcher.js';
import { computeSignalImpact, SignalImpactResult } from './impact_model.js';
import { getSignalDirection } from './direction_model.js';

export interface TopSignal {
  signalId: string;
  status: string;
  type: string;
  contribution: number;   // 0..1 normalized
  confidence: number;
  impact: number;
  direction: number;      // -1..1
  clusterPassed: boolean;
  dominance: number;
  penalties: string[];
}

export interface EvidenceDirectionResult {
  evidence: number;         // 0..100
  direction: number;        // -100..100
  topSignals: TopSignal[];
  notes: {
    evidenceNotes: string[];
  };
}

/**
 * Compute Evidence and Direction from signals
 */
export function computeEvidenceAndDirection(
  signals: D1Signal[],
  window: EngineWindow
): EvidenceDirectionResult {
  if (!signals || signals.length === 0) {
    return {
      evidence: 0,
      direction: 0,
      topSignals: [],
      notes: { evidenceNotes: ['no_signals'] },
    };
  }
  
  const now = new Date();
  
  // Compute impacts for all signals
  const impacts: Array<{
    signal: D1Signal;
    meta: SignalImpactResult;
    dir: number;
  }> = signals.map((signal) => {
    const meta = computeSignalImpact(signal, window, now);
    const dir = getSignalDirection(signal);
    return { signal, meta, dir };
  });
  
  // Total impact for normalization
  const totalImpact = impacts.reduce((sum, x) => sum + x.meta.impact, 0);
  
  // Evidence: normalize to 0..100
  // Calibration: with ~10 strong signals, evidence should be ~70-90
  const CAL = 1.25;
  const rawEvidence = Math.min(1, totalImpact * CAL);
  const evidence = Math.round(rawEvidence * 100);
  
  // Direction: weighted average, scaled to -100..100
  const dirNumer = impacts.reduce((sum, x) => sum + x.meta.impact * x.dir, 0);
  const dirDenom = totalImpact > 0 ? totalImpact : 1;
  const direction = Math.round(Math.max(-1, Math.min(1, dirNumer / dirDenom)) * 100);
  
  // Top signals by impact (limit to 8)
  const sorted = [...impacts].sort((a, b) => b.meta.impact - a.meta.impact).slice(0, 8);
  
  const topSignals: TopSignal[] = sorted.map((x) => ({
    signalId: x.signal.id ?? String(x.signal._id ?? ''),
    status: x.signal.status,
    type: x.signal.type,
    contribution: totalImpact > 0 ? x.meta.impact / totalImpact : 0,
    confidence: x.meta.confidence,
    impact: x.meta.impact,
    direction: x.dir,
    clusterPassed: x.meta.passed,
    dominance: x.meta.dominance,
    penalties: x.meta.penalties,
  }));
  
  // Evidence notes
  const evidenceNotes: string[] = [];
  if (evidence < 50) evidenceNotes.push('low_evidence');
  if (sorted.length === 0) evidenceNotes.push('no_supporting_signals');
  if (sorted.length === 1) evidenceNotes.push('single_signal_support');
  
  const avgPenalties = impacts.reduce((sum, x) => sum + x.meta.penalties.length, 0) / impacts.length;
  if (avgPenalties > 1.5) evidenceNotes.push('high_penalty_signals');
  
  return { evidence, direction, topSignals, notes: { evidenceNotes } };
}
