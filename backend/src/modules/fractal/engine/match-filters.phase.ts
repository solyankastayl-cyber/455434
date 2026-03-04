/**
 * BLOCK 37.3 — Phase-Aware Diversity Filter
 * 
 * Limits matches per phase to avoid single-phase dominance.
 * Ensures diverse historical context coverage.
 */

import {
  PhaseBucket,
  PhaseClassifierConfig,
  PhaseDiversityConfig,
  DEFAULT_PHASE_CLASSIFIER_CONFIG,
  DEFAULT_PHASE_DIVERSITY_CONFIG,
} from '../contracts/phase.contracts.js';
import { classifyPhase } from './phase.classifier.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface RankedCandidate {
  endTs: Date | number | string;
  endIdx: number;
  sim: number;
  closes: number[];
  meta?: Record<string, any>;
  [key: string]: any;
}

export interface PhaseDiversityStats {
  curPhase: PhaseBucket;
  inputCount: number;
  outputCount: number;
  byPhase: Record<PhaseBucket, number>;
  droppedByPhase: Record<PhaseBucket, number>;
}

// ═══════════════════════════════════════════════════════════════
// Phase Diversity Enforcement
// ═══════════════════════════════════════════════════════════════

/**
 * Enforce phase diversity: max N matches per phase
 * 
 * @param ranked - candidates sorted by similarity (descending)
 * @param curCloses - current window closes (for current phase detection)
 * @param phaseCfg - phase classifier configuration
 * @param divCfg - diversity configuration
 */
export function enforcePhaseDiversity<T extends RankedCandidate>(
  ranked: T[],
  curCloses: number[],
  phaseCfg: PhaseClassifierConfig = DEFAULT_PHASE_CLASSIFIER_CONFIG,
  divCfg: PhaseDiversityConfig = DEFAULT_PHASE_DIVERSITY_CONFIG
): {
  filtered: T[];
  stats: PhaseDiversityStats;
} {
  const curPhase = classifyPhase(curCloses, phaseCfg);

  const stats: PhaseDiversityStats = {
    curPhase,
    inputCount: ranked.length,
    outputCount: 0,
    byPhase: {
      ACCUMULATION: 0,
      MARKUP: 0,
      DISTRIBUTION: 0,
      MARKDOWN: 0,
      CAPITULATION: 0,
      RECOVERY: 0,
      UNKNOWN: 0,
    },
    droppedByPhase: {
      ACCUMULATION: 0,
      MARKUP: 0,
      DISTRIBUTION: 0,
      MARKDOWN: 0,
      CAPITULATION: 0,
      RECOVERY: 0,
      UNKNOWN: 0,
    },
  };

  if (!divCfg.enabled) {
    const result = ranked.slice(0, divCfg.maxTotal);
    stats.outputCount = result.length;
    return { filtered: result, stats };
  }

  const counts: Record<PhaseBucket, number> = {
    ACCUMULATION: 0,
    MARKUP: 0,
    DISTRIBUTION: 0,
    MARKDOWN: 0,
    CAPITULATION: 0,
    RECOVERY: 0,
    UNKNOWN: 0,
  };

  const out: T[] = [];

  for (const r of ranked) {
    if (out.length >= divCfg.maxTotal) break;

    // Classify historical window phase
    const ph = classifyPhase(r.closes, phaseCfg);
    const key = ph ?? "UNKNOWN";

    // Allow +1 for same phase if preferSamePhase is enabled
    const cap = divCfg.preferSamePhase && curPhase !== "UNKNOWN" && key === curPhase
      ? divCfg.maxPerPhase + 1
      : divCfg.maxPerPhase;

    if (counts[key] >= cap) {
      stats.droppedByPhase[key]++;
      continue;
    }

    counts[key]++;

    // Attach phase metadata to result
    const enriched = {
      ...r,
      meta: {
        ...(r.meta || {}),
        phase: key,
        curPhase,
      },
    };

    out.push(enriched as T);
  }

  stats.outputCount = out.length;
  stats.byPhase = { ...counts };

  return { filtered: out, stats };
}

/**
 * Combined diversity filter: Year + Phase
 * Applies both temporal (year) and phase diversity constraints
 */
export function enforceCombinedDiversity<T extends RankedCandidate>(
  ranked: T[],
  curCloses: number[],
  phaseCfg: PhaseClassifierConfig = DEFAULT_PHASE_CLASSIFIER_CONFIG,
  divCfg: PhaseDiversityConfig = DEFAULT_PHASE_DIVERSITY_CONFIG,
  maxPerYear = 3
): {
  filtered: T[];
  phaseStats: PhaseDiversityStats;
  yearStats: Record<number, number>;
} {
  // First apply phase diversity
  const { filtered: afterPhase, stats: phaseStats } = enforcePhaseDiversity(
    ranked,
    curCloses,
    phaseCfg,
    divCfg
  );

  // Then apply year diversity
  const yearCounts: Record<number, number> = {};
  const yearStats: Record<number, number> = {};
  const out: T[] = [];

  for (const r of afterPhase) {
    if (out.length >= divCfg.maxTotal) break;

    const ts = r.endTs instanceof Date
      ? r.endTs
      : new Date(r.endTs);
    const year = ts.getUTCFullYear();

    yearCounts[year] = yearCounts[year] ?? 0;

    if (yearCounts[year] >= maxPerYear) continue;

    yearCounts[year]++;
    out.push(r);
  }

  // Copy final counts to stats
  for (const [y, c] of Object.entries(yearCounts)) {
    yearStats[parseInt(y)] = c;
  }

  return {
    filtered: out,
    phaseStats: {
      ...phaseStats,
      outputCount: out.length,
    },
    yearStats,
  };
}

/**
 * Analyze phase distribution in matches
 */
export function analyzePhaseDistribution<T extends RankedCandidate>(
  matches: T[],
  phaseCfg: PhaseClassifierConfig = DEFAULT_PHASE_CLASSIFIER_CONFIG
): {
  byPhase: Record<PhaseBucket, { count: number; avgSim: number }>;
  dominantPhase: PhaseBucket | null;
  dominantPhasePct: number;
  phaseEntropy: number;
} {
  const byPhase: Record<PhaseBucket, { count: number; totalSim: number }> = {
    ACCUMULATION: { count: 0, totalSim: 0 },
    MARKUP: { count: 0, totalSim: 0 },
    DISTRIBUTION: { count: 0, totalSim: 0 },
    MARKDOWN: { count: 0, totalSim: 0 },
    CAPITULATION: { count: 0, totalSim: 0 },
    RECOVERY: { count: 0, totalSim: 0 },
    UNKNOWN: { count: 0, totalSim: 0 },
  };

  for (const m of matches) {
    const phase = classifyPhase(m.closes, phaseCfg);
    byPhase[phase].count++;
    byPhase[phase].totalSim += m.sim;
  }

  // Calculate averages and find dominant
  const result: Record<PhaseBucket, { count: number; avgSim: number }> = {} as any;
  let maxCount = 0;
  let dominantPhase: PhaseBucket | null = null;
  const total = matches.length || 1;

  for (const [phase, data] of Object.entries(byPhase)) {
    result[phase as PhaseBucket] = {
      count: data.count,
      avgSim: data.count > 0 ? data.totalSim / data.count : 0,
    };
    if (data.count > maxCount) {
      maxCount = data.count;
      dominantPhase = phase as PhaseBucket;
    }
  }

  const dominantPhasePct = maxCount / total;

  // Calculate entropy (diversity measure)
  let entropy = 0;
  for (const data of Object.values(byPhase)) {
    if (data.count > 0) {
      const p = data.count / total;
      entropy -= p * Math.log2(p);
    }
  }
  // Normalize to 0-1 (max entropy = log2(7) for 7 phases)
  const maxEntropy = Math.log2(7);
  const phaseEntropy = entropy / maxEntropy;

  return {
    byPhase: result,
    dominantPhase,
    dominantPhasePct: Math.round(dominantPhasePct * 1000) / 1000,
    phaseEntropy: Math.round(phaseEntropy * 1000) / 1000,
  };
}
