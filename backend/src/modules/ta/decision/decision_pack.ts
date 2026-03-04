/**
 * Phase E: Decision Pack Builder
 * 
 * Creates the final output for TA Engine integration:
 * - Top 3 scenarios with probability
 * - Bench scenarios for backup
 * - Audit metadata for Phase F storage
 */

import { Hypothesis } from '../hypothesis/builder/hypothesis_types.js';
import { DecisionPack, Scenario } from './decision_types.js';
import { rankScenarios, RankerOpts } from './scenario_ranker.js';
import { Calibrator } from './probability.js';

function nowIso(): string {
  return new Date().toISOString();
}

export interface DecisionPackParams {
  runId: string;
  asset: string;
  timeframe: string;
  engineVersion: string;
  hypotheses: Hypothesis[];
  calibrator?: Calibrator;
  rankerOpts?: Partial<Omit<RankerOpts, 'version'>>;
}

/**
 * Build a complete Decision Pack from hypotheses
 * 
 * @param params - Build parameters
 * @returns Complete DecisionPack ready for API response and storage
 */
export async function buildDecisionPack(params: DecisionPackParams): Promise<DecisionPack> {
  const {
    runId,
    asset,
    timeframe,
    engineVersion,
    hypotheses,
    calibrator,
    rankerOpts = {}
  } = params;
  
  // Default ranker options
  const fullRankerOpts: RankerOpts = {
    topK: rankerOpts.topK ?? 3,
    benchK: rankerOpts.benchK ?? 7,
    dedupeSimilarity: rankerOpts.dedupeSimilarity ?? 0.7,
    enforceDirectionDiversity: rankerOpts.enforceDirectionDiversity ?? true,
    version: engineVersion,
  };
  
  // Rank scenarios
  const { top, bench, droppedForDiversity, probabilityMode } = 
    await rankScenarios(hypotheses, calibrator, fullRankerOpts);
  
  // Build decision pack
  const pack: DecisionPack = {
    runId,
    asset,
    timeframe,
    engineVersion,
    top,
    bench,
    summary: {
      hypothesesIn: hypotheses.length,
      scenariosOut: top.length,
      droppedForDiversity,
      probabilityMode,
    },
    audit: {
      topHypothesisIds: top.map(s => s.hypothesisId),
      timestamp: nowIso(),
    },
  };
  
  return pack;
}

/**
 * Quick decision summary for logging/debugging
 */
export function summarizeDecisionPack(pack: DecisionPack): string {
  const lines: string[] = [
    `Decision Pack [${pack.runId}]`,
    `Asset: ${pack.asset} | TF: ${pack.timeframe}`,
    `Input: ${pack.summary.hypothesesIn} hypotheses`,
    `Output: ${pack.summary.scenariosOut} scenarios (${pack.summary.probabilityMode})`,
    '',
    'Top Scenarios:',
  ];
  
  for (const s of pack.top) {
    lines.push(
      `  #${s.rank} ${s.direction} | p=${(s.probability * 100).toFixed(1)}% | ${s.intent.bias} (${s.intent.confidenceLabel})`
    );
  }
  
  return lines.join('\n');
}

/**
 * Extract just the top scenario for quick decisions
 */
export function getTopScenario(pack: DecisionPack): Scenario | null {
  return pack.top[0] ?? null;
}

/**
 * Check if pack has high-confidence scenario
 */
export function hasHighConfidence(pack: DecisionPack, threshold = 0.65): boolean {
  return pack.top.some(s => s.probability >= threshold);
}
