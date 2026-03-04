/**
 * Signal Merge Logic
 * 
 * Merges duplicate signals from different detectors/sources
 * Keeps max(severity, confidence) and combines evidence
 */

import { IntelligenceSignal, severityMax, severityRank } from '../types.js';

/**
 * Create stable key for signal deduplication
 */
function signalKey(s: IntelligenceSignal): string {
  return `${s.type}:${s.network}:${s.subject.kind}:${s.subject.id}:${s.window.label}`;
}

/**
 * Deduplicate evidence
 */
function dedupeEvidence(evidence: IntelligenceSignal['evidence']): IntelligenceSignal['evidence'] {
  const seen = new Set<string>();
  const result: IntelligenceSignal['evidence'] = [];

  for (const ev of evidence) {
    const key = ev.ref
      ? `${ev.kind}:${ev.ref}`
      : `${ev.kind}:${ev.text ?? ''}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ev);
    }
  }

  return result;
}

/**
 * Merge signals with same key
 * Strategy: max(severity), max(confidence), combine evidence
 */
export function mergeSignals(signals: IntelligenceSignal[]): IntelligenceSignal[] {
  const map = new Map<string, IntelligenceSignal>();

  for (const signal of signals) {
    const key = signalKey(signal);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, signal);
      continue;
    }

    // Merge: take max severity and confidence
    const merged: IntelligenceSignal = {
      ...existing,
      severity: severityMax(existing.severity, signal.severity),
      confidence: Math.max(existing.confidence, signal.confidence),
      metrics: {
        ...existing.metrics,
        ...signal.metrics,
      },
      evidence: dedupeEvidence([...existing.evidence, ...signal.evidence]),
      createdAtTs: Math.max(existing.createdAtTs, signal.createdAtTs),
    };

    map.set(key, merged);
  }

  // Sort by severity desc, then confidence desc
  return Array.from(map.values()).sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.confidence - a.confidence
  );
}

/**
 * Create summary from signals
 */
export function createSummary(signals: IntelligenceSignal[]): {
  maxSeverity: IntelligenceSignal['severity'] | null;
  maxConfidence: number;
  countsByType: Record<string, number>;
  countsBySeverity: Record<IntelligenceSignal['severity'], number>;
  lastComputedTs: number;
} {
  if (signals.length === 0) {
    return {
      maxSeverity: null,
      maxConfidence: 0,
      countsByType: {},
      countsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      lastComputedTs: Math.floor(Date.now() / 1000),
    };
  }

  const countsByType: Record<string, number> = {};
  const countsBySeverity: Record<IntelligenceSignal['severity'], number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  let maxSeverity = signals[0].severity;
  let maxConfidence = signals[0].confidence;
  let lastComputedTs = signals[0].createdAtTs;

  for (const signal of signals) {
    // Count by type
    countsByType[signal.type] = (countsByType[signal.type] ?? 0) + 1;

    // Count by severity
    countsBySeverity[signal.severity]++;

    // Update max severity
    if (severityRank(signal.severity) > severityRank(maxSeverity)) {
      maxSeverity = signal.severity;
    }

    // Update max confidence
    if (signal.confidence > maxConfidence) {
      maxConfidence = signal.confidence;
    }

    // Update last computed
    if (signal.createdAtTs > lastComputedTs) {
      lastComputedTs = signal.createdAtTs;
    }
  }

  return {
    maxSeverity,
    maxConfidence,
    countsByType,
    countsBySeverity,
    lastComputedTs,
  };
}
