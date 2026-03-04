/**
 * BLOCK 83 — Intel Alerts Detector
 * 
 * Detects state-change events by comparing yesterday vs today snapshots.
 * Events: LOCK_ENTER, LOCK_EXIT, DOMINANCE_SHIFT, PHASE_DOWNGRADE
 */

import type { IntelAlertPayload, IntelAlertEventType, IntelAlertSeverity, IntelAlertSource } from './intel-alerts.types.js';

export type IntelDaily = {
  date: string;
  symbol: string;
  source: IntelAlertSource;
  consensusIndex: number;
  conflictLevel: 'LOW' | 'MODERATE' | 'HIGH';
  dominanceTier: 'TIMING' | 'TACTICAL' | 'STRUCTURE';
  structuralLock: boolean;
  phaseType: string;
  phaseGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  phaseScore: number;
  volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'CRISIS';
  divergenceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  divergenceScore: number;
  phaseSamples?: number;
};

export type DetectedEvent = {
  eventType: IntelAlertEventType;
  severity: IntelAlertSeverity;
  payload: IntelAlertPayload;
};

const gradeIndex = (g: IntelDaily['phaseGrade']): number => {
  switch (g) {
    case 'A': return 1;
    case 'B': return 2;
    case 'C': return 3;
    case 'D': return 4;
    case 'F': return 5;
  }
};

export function detectIntelEvents(y: IntelDaily, t: IntelDaily): DetectedEvent[] {
  const events: DetectedEvent[] = [];

  // 1) LOCK_ENTER
  if (!y.structuralLock && t.structuralLock) {
    const severity: IntelAlertSeverity = t.volRegime === 'CRISIS' ? 'CRITICAL' : 'WARN';
    events.push({
      eventType: 'LOCK_ENTER',
      severity,
      payload: mkPayload(y, t, ['Structural lock entered']),
    });
  }

  // 2) LOCK_EXIT
  if (y.structuralLock && !t.structuralLock) {
    events.push({
      eventType: 'LOCK_EXIT',
      severity: 'INFO',
      payload: mkPayload(y, t, ['Structural lock exited']),
    });
  }

  // 3) DOMINANCE_SHIFT
  if (y.dominanceTier !== t.dominanceTier) {
    let severity: IntelAlertSeverity = 'INFO';
    if (y.dominanceTier === 'STRUCTURE' && t.dominanceTier === 'TIMING') severity = 'WARN';
    if (t.conflictLevel === 'HIGH') severity = 'CRITICAL';

    events.push({
      eventType: 'DOMINANCE_SHIFT',
      severity,
      payload: mkPayload(y, t, [`Dominance shift ${y.dominanceTier} → ${t.dominanceTier}`]),
    });
  }

  // 4) PHASE_DOWNGRADE (drop >= 2 grades)
  const drop = gradeIndex(t.phaseGrade) - gradeIndex(y.phaseGrade);
  if (drop >= 2) {
    let severity: IntelAlertSeverity = 'WARN';
    if (t.volRegime === 'CRISIS' && (t.divergenceGrade === 'D' || t.divergenceGrade === 'F')) {
      severity = 'CRITICAL';
    }

    events.push({
      eventType: 'PHASE_DOWNGRADE',
      severity,
      payload: mkPayload(y, t, [`Phase grade downgrade ${y.phaseGrade} → ${t.phaseGrade}`]),
    });
  }

  return events;
}

function mkPayload(y: IntelDaily, t: IntelDaily, notes: string[]): IntelAlertPayload {
  return {
    date: t.date,
    symbol: t.symbol,
    source: t.source,
    consensusIndex: t.consensusIndex,
    conflictLevel: t.conflictLevel,
    dominanceTier: t.dominanceTier,
    structuralLock: t.structuralLock,
    phaseType: t.phaseType,
    phaseGrade: t.phaseGrade,
    phaseScore: t.phaseScore,
    volRegime: t.volRegime,
    divergenceGrade: t.divergenceGrade,
    divergenceScore: t.divergenceScore,
    from: {
      dominanceTier: y.dominanceTier,
      structuralLock: y.structuralLock,
      phaseGrade: y.phaseGrade,
      phaseScore: y.phaseScore,
      volRegime: y.volRegime,
      divergenceGrade: y.divergenceGrade,
      divergenceScore: y.divergenceScore,
      conflictLevel: y.conflictLevel,
      consensusIndex: y.consensusIndex,
    },
    to: {
      dominanceTier: t.dominanceTier,
      structuralLock: t.structuralLock,
      phaseGrade: t.phaseGrade,
      phaseScore: t.phaseScore,
      volRegime: t.volRegime,
      divergenceGrade: t.divergenceGrade,
      divergenceScore: t.divergenceScore,
      conflictLevel: t.conflictLevel,
      consensusIndex: t.consensusIndex,
    },
    notes,
  };
}
