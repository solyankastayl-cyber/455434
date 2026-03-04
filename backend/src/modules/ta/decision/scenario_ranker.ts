/**
 * Phase E: Scenario Ranker v1
 * 
 * Converts hypotheses (top-20) into ranked scenarios (top-3)
 * 
 * FEATURES:
 * - Diversity: tries to include BULL, BEAR, NEUTRAL
 * - Dedupe: removes near-duplicate hypotheses
 * - Probability: maps score to probability
 * - Intent: generates trade bias and confidence
 */

import { Hypothesis, PatternCandidate } from '../hypothesis/builder/hypothesis_types.js';
import { scoreToProbability, Calibrator, ProbabilityResult } from './probability.js';
import { Scenario, BiasType, ConfidenceLabel, ProbabilitySource } from './decision_types.js';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Convert probability to confidence label
 */
function labelFromProb(p: number): ConfidenceLabel {
  if (p >= 0.68) return 'HIGH';
  if (p >= 0.55) return 'MED';
  return 'LOW';
}

/**
 * Convert direction to trade bias
 */
function biasFromDir(dir: Scenario['direction']): BiasType {
  if (dir === 'BULL') return 'LONG';
  if (dir === 'BEAR') return 'SHORT';
  return 'WAIT';
}

/**
 * Generate component signature for deduplication
 */
function componentSignature(h: Hypothesis): string {
  return h.components.map(c => c.type).sort().join('|');
}

/**
 * Jaccard similarity between two hypotheses based on pattern types
 */
function similarity(a: Hypothesis, b: Hypothesis): number {
  const A = new Set(a.components.map(c => c.type));
  const B = new Set(b.components.map(c => c.type));
  
  let intersection = 0;
  for (const x of A) {
    if (B.has(x)) intersection++;
  }
  
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface RankerOpts {
  topK?: number;                    // Default 3
  benchK?: number;                  // Default 7
  dedupeSimilarity?: number;        // Default 0.7
  enforceDirectionDiversity?: boolean;  // Default true
  version: string;
}

export interface RankerResult {
  top: Scenario[];
  bench: Scenario[];
  droppedForDiversity: number;
  probabilityMode: ProbabilitySource;
}

/**
 * Main ranking function
 * 
 * Algorithm:
 * 1. Sort hypotheses by score (descending)
 * 2. Deduplicate by similarity threshold
 * 3. Enforce direction diversity (BULL, BEAR, NEUTRAL)
 * 4. Convert to Scenarios with probability
 */
export async function rankScenarios(
  hypotheses: Hypothesis[],
  calibrator: Calibrator | undefined,
  opts: RankerOpts
): Promise<RankerResult> {
  
  const topK = opts.topK ?? 3;
  const benchK = opts.benchK ?? 7;
  const simThreshold = opts.dedupeSimilarity ?? 0.7;
  const diversity = opts.enforceDirectionDiversity ?? true;
  
  // Sort by score descending
  const sorted = [...hypotheses].sort((a, b) => b.score - a.score);
  
  const chosen: Hypothesis[] = [];
  const dropped: Hypothesis[] = [];
  
  // Step 1: Deduplicate by similarity
  for (const h of sorted) {
    const isDuplicate = chosen.some(x => 
      similarity(x, h) >= simThreshold || 
      componentSignature(x) === componentSignature(h)
    );
    
    if (!isDuplicate) {
      chosen.push(h);
    } else {
      dropped.push(h);
    }
    
    // Safety limit
    if (chosen.length >= (topK + benchK) * 3) break;
  }
  
  // Step 2: Direction diversity selection
  const final: Hypothesis[] = [];
  const wantDirections: Array<Scenario['direction']> = diversity 
    ? ['BULL', 'BEAR', 'NEUTRAL'] 
    : [];
  
  if (diversity) {
    // First, try to get one of each direction
    for (const dir of wantDirections) {
      const pick = chosen.find(h => h.direction === dir && !final.includes(h));
      if (pick) {
        final.push(pick);
      }
    }
    
    // Then fill remaining slots with top scores
    for (const h of chosen) {
      if (final.includes(h)) continue;
      if (final.length >= topK + benchK) break;
      final.push(h);
    }
  } else {
    // No diversity enforcement - just take top
    final.push(...chosen.slice(0, topK + benchK));
  }
  
  // Step 3: Convert to Scenarios with probability
  const scenarios: Scenario[] = [];
  let probMode: ProbabilitySource = 'FALLBACK';
  
  for (let i = 0; i < final.length; i++) {
    const h = final[i];
    
    // Get probability
    const pr = await scoreToProbability(
      h.score, 
      calibrator, 
      { patternTypes: h.components.map(c => c.type) }
    );
    
    if (pr.source === 'CALIBRATED') {
      probMode = 'CALIBRATED';
    }
    
    // Build scenario
    const scenario: Scenario = {
      scenarioId: `sc_${h.id}`,
      rank: i + 1,
      hypothesisId: h.id,
      direction: h.direction,
      score: h.score,
      probability: pr.p,
      probabilitySource: pr.source,
      components: h.components,
      intent: {
        bias: biasFromDir(h.direction),
        confidenceLabel: labelFromProb(pr.p),
      },
      why: {
        headline: [
          `${h.direction} scenario`,
          `score=${h.score.toFixed(3)} p=${pr.p.toFixed(3)}`
        ],
        bullets: h.reasons.slice(0, 8),
      },
      meta: {
        createdAt: nowIso(),
        version: opts.version,
      },
    };
    
    scenarios.push(scenario);
  }
  
  return {
    top: scenarios.slice(0, topK),
    bench: scenarios.slice(topK, topK + benchK),
    droppedForDiversity: dropped.length,
    probabilityMode: probMode,
  };
}

/**
 * Generate explanation bullets for a scenario
 */
export function generateExplanation(scenario: Scenario): string[] {
  const bullets: string[] = [];
  
  // Direction
  bullets.push(`Direction: ${scenario.direction}`);
  
  // Probability and confidence
  bullets.push(`Probability: ${(scenario.probability * 100).toFixed(1)}% (${scenario.intent.confidenceLabel})`);
  
  // Components summary
  const groups = new Set(scenario.components.map(c => c.group));
  bullets.push(`Pattern groups: ${Array.from(groups).join(', ')}`);
  
  // Trade intent
  bullets.push(`Trade bias: ${scenario.intent.bias}`);
  
  return bullets;
}
