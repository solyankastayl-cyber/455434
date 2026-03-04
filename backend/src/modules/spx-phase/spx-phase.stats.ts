/**
 * SPX PHASE ENGINE — Stats Builder
 * 
 * BLOCK B5.4 — Compute aggregated statistics per phase type
 */

import type { 
  SpxPhaseSegment, 
  SpxPhaseStats, 
  SpxPhaseType, 
  SpxPhaseGrade 
} from './spx-phase.types.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE PHASE STATS
// ═══════════════════════════════════════════════════════════════

const ALL_PHASES: SpxPhaseType[] = [
  'BULL_EXPANSION',
  'BULL_COOLDOWN',
  'BEAR_DRAWDOWN',
  'BEAR_RALLY',
  'SIDEWAYS_RANGE',
];

export function computePhaseStats(
  segments: SpxPhaseSegment[]
): Record<SpxPhaseType, SpxPhaseStats> {
  const result: Record<SpxPhaseType, SpxPhaseStats> = {} as any;

  for (const phaseType of ALL_PHASES) {
    const phaseSegments = segments.filter(s => s.phase === phaseType);
    
    if (phaseSegments.length === 0) {
      result[phaseType] = {
        phase: phaseType,
        totalSegments: 0,
        totalDays: 0,
        avgDuration: 0,
        avgReturn: 0,
        medianReturn: 0,
        hitRate: 0,
        avgMaxDD: 0,
        sharpe: 0,
        sortino: 0,
        grade: 'F',
      };
      continue;
    }

    const returns = phaseSegments.map(s => s.returnPct);
    const durations = phaseSegments.map(s => s.duration);
    const maxDDs = phaseSegments.map(s => s.maxDrawdownPct);
    const vols = phaseSegments.map(s => s.realizedVol).filter(v => v > 0);

    // Basic stats
    const totalSegments = phaseSegments.length;
    const totalDays = durations.reduce((a, b) => a + b, 0);
    const avgDuration = totalDays / totalSegments;

    // Return stats
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const medianReturn = sortedReturns[Math.floor(sortedReturns.length / 2)];
    const hitRate = returns.filter(r => r > 0).length / returns.length;

    // Drawdown stats
    const avgMaxDD = maxDDs.reduce((a, b) => a + b, 0) / maxDDs.length;

    // Sharpe (simplified: avg return / std of returns)
    const returnStd = Math.sqrt(
      returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / returns.length
    );
    const sharpe = returnStd > 0 ? avgReturn / returnStd : 0;

    // Sortino (downside deviation)
    const negReturns = returns.filter(r => r < 0);
    const downsideStd = negReturns.length > 0
      ? Math.sqrt(negReturns.reduce((a, b) => a + b ** 2, 0) / negReturns.length)
      : 0;
    const sortino = downsideStd > 0 ? avgReturn / downsideStd : sharpe;

    // Grade calculation
    const grade = computeGrade(avgReturn, hitRate, sharpe, avgMaxDD);

    result[phaseType] = {
      phase: phaseType,
      totalSegments,
      totalDays,
      avgDuration: Math.round(avgDuration * 10) / 10,
      avgReturn: Math.round(avgReturn * 100) / 100,
      medianReturn: Math.round(medianReturn * 100) / 100,
      hitRate: Math.round(hitRate * 1000) / 10, // As %
      avgMaxDD: Math.round(avgMaxDD * 100) / 100,
      sharpe: Math.round(sharpe * 100) / 100,
      sortino: Math.round(sortino * 100) / 100,
      grade,
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// GRADE CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeGrade(
  avgReturn: number, 
  hitRate: number, 
  sharpe: number,
  avgMaxDD: number
): SpxPhaseGrade {
  // Score components (0-100 each)
  let score = 0;

  // Return component (40%)
  if (avgReturn > 5) score += 40;
  else if (avgReturn > 2) score += 30;
  else if (avgReturn > 0) score += 20;
  else if (avgReturn > -2) score += 10;
  // else 0

  // Hit rate component (30%)
  if (hitRate > 0.7) score += 30;
  else if (hitRate > 0.6) score += 24;
  else if (hitRate > 0.5) score += 18;
  else if (hitRate > 0.4) score += 12;
  else score += 6;

  // Sharpe component (20%)
  if (sharpe > 1.5) score += 20;
  else if (sharpe > 1.0) score += 15;
  else if (sharpe > 0.5) score += 10;
  else if (sharpe > 0) score += 5;
  // else 0

  // Drawdown component (10%) - lower is better
  if (avgMaxDD > -3) score += 10;
  else if (avgMaxDD > -5) score += 8;
  else if (avgMaxDD > -10) score += 5;
  else if (avgMaxDD > -15) score += 2;
  // else 0

  // Convert to grade
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ═══════════════════════════════════════════════════════════════
// OVERALL GRADE
// ═══════════════════════════════════════════════════════════════

export function computeOverallGrade(
  statsByPhase: Record<SpxPhaseType, SpxPhaseStats>
): SpxPhaseGrade {
  const grades: SpxPhaseGrade[] = Object.values(statsByPhase)
    .filter(s => s.totalSegments > 0)
    .map(s => s.grade);

  if (grades.length === 0) return 'F';

  // Convert to numeric and average
  const gradeToNum: Record<SpxPhaseGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const avg = grades.reduce((a, g) => a + gradeToNum[g], 0) / grades.length;

  if (avg >= 3.5) return 'A';
  if (avg >= 2.5) return 'B';
  if (avg >= 1.5) return 'C';
  if (avg >= 0.5) return 'D';
  return 'F';
}

export default computePhaseStats;
