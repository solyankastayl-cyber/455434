/**
 * SPX PHASE ENGINE — Main Service
 * 
 * BLOCK B5.4 — Combines classifier, segmenter, and stats
 * 
 * Entry point for SPX phase analysis.
 */

import { classifySpxPhases } from './spx-phase.classifier.js';
import { segmentPhases } from './spx-phase.segmenter.js';
import { computePhaseStats, computeOverallGrade } from './spx-phase.stats.js';
import type { 
  SpxCandle, 
  SpxPhaseEngineOutput,
  SpxPhaseSegment,
  SpxPhaseFlag
} from './spx-phase.types.js';

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxPhaseService {
  /**
   * Build complete phase analysis from candles
   */
  build(candles: SpxCandle[]): SpxPhaseEngineOutput {
    if (candles.length < 250) {
      return this.emptyOutput();
    }

    // 1. Classify each day
    const labels = classifySpxPhases(candles);
    
    if (labels.length === 0) {
      return this.emptyOutput();
    }

    // 2. Segment into continuous periods
    const segments = segmentPhases(labels, candles);
    
    if (segments.length === 0) {
      return this.emptyOutput();
    }

    // 3. Compute stats per phase type
    const statsByPhase = computePhaseStats(segments);

    // 4. Get current phase (last segment)
    const phaseIdAtNow = segments[segments.length - 1];
    
    // 5. Get current flags from latest label
    const latestLabel = labels[labels.length - 1];
    const currentFlags: SpxPhaseFlag[] = latestLabel?.flags ?? [];

    // 6. Overall grade
    const overallGrade = computeOverallGrade(statsByPhase);

    // 7. Coverage stats
    const totalDays = labels.length;
    const coverageYears = totalDays / 252; // Trading days per year

    return {
      phaseIdAtNow,
      currentFlags,
      segments,
      statsByPhase,
      overallGrade,
      totalDays,
      coverageYears: Math.round(coverageYears * 10) / 10,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get phase at specific date
   */
  getPhaseAtDate(candles: SpxCandle[], targetDate: string): SpxPhaseSegment | null {
    const output = this.build(candles);
    
    for (const segment of output.segments) {
      if (targetDate >= segment.startDate && targetDate <= segment.endDate) {
        return segment;
      }
    }
    
    return null;
  }

  /**
   * Get phases in date range (for chart shading)
   */
  getPhasesInRange(
    candles: SpxCandle[], 
    startDate: string, 
    endDate: string
  ): SpxPhaseSegment[] {
    const output = this.build(candles);
    
    return output.segments.filter(s => 
      s.endDate >= startDate && s.startDate <= endDate
    );
  }

  /**
   * Empty output for insufficient data
   */
  private emptyOutput(): SpxPhaseEngineOutput {
    return {
      phaseIdAtNow: {
        phaseId: 'UNKNOWN',
        phase: 'SIDEWAYS_RANGE',
        startDate: '',
        endDate: '',
        startTs: 0,
        endTs: 0,
        duration: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        realizedVol: 0,
        flags: [],
        flagDays: 0,
      },
      currentFlags: [],
      segments: [],
      statsByPhase: {
        BULL_EXPANSION: this.emptyStats('BULL_EXPANSION'),
        BULL_COOLDOWN: this.emptyStats('BULL_COOLDOWN'),
        BEAR_DRAWDOWN: this.emptyStats('BEAR_DRAWDOWN'),
        BEAR_RALLY: this.emptyStats('BEAR_RALLY'),
        SIDEWAYS_RANGE: this.emptyStats('SIDEWAYS_RANGE'),
      },
      overallGrade: 'F',
      totalDays: 0,
      coverageYears: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  private emptyStats(phase: any) {
    return {
      phase,
      totalSegments: 0,
      totalDays: 0,
      avgDuration: 0,
      avgReturn: 0,
      medianReturn: 0,
      hitRate: 0,
      avgMaxDD: 0,
      sharpe: 0,
      sortino: 0,
      grade: 'F' as const,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const spxPhaseService = new SpxPhaseService();

export default SpxPhaseService;
