/**
 * Phase AE2.3: Behaviour Intelligence - Apply Boost
 * 
 * Applies behaviour-based probability adjustment to scenarios.
 * This is the integration point into the Decision Engine.
 */

import { 
  BehaviourModel, 
  BehaviourKeyStats,
  ProbabilityBreakdown,
  BehaviourExplanation,
  DEFAULT_BEHAVIOUR_RULES
} from './behaviour_model_types.js';
import { getBehaviourBuilder } from './behaviour_builder.js';

// ═══════════════════════════════════════════════════════════════
// BEHAVIOUR LOOKUP
// ═══════════════════════════════════════════════════════════════

/**
 * Find behaviour stats for a specific key
 */
export function findBehaviourStats(
  model: BehaviourModel | null,
  behaviourKey: string
): BehaviourKeyStats | null {
  if (!model) return null;
  return model.keys.find(k => k.behaviourKey === behaviourKey) || null;
}

/**
 * Find condition boosts for a pattern
 */
export function findConditionBoosts(
  model: BehaviourModel | null,
  patternType: string
): Array<{ condition: string; boost: number; confidence: number }> {
  if (!model) return [];
  
  return model.conditions
    .filter(c => c.patternType === patternType && c.boost > 0)
    .map(c => ({
      condition: c.condition,
      boost: c.boost,
      confidence: c.confidence,
    }))
    .slice(0, 5); // Top 5 boosters
}

// ═══════════════════════════════════════════════════════════════
// PROBABILITY ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export interface ApplyBehaviourInput {
  probability: number;
  behaviourKey: string;
  patternType: string;
  context?: Record<string, any>;
}

export interface ApplyBehaviourResult {
  probabilityBefore: number;
  probabilityAfter: number;
  boost: number;
  explanation: BehaviourExplanation | null;
}

/**
 * Apply behaviour boost to probability
 */
export async function applyBehaviourBoost(
  input: ApplyBehaviourInput
): Promise<ApplyBehaviourResult> {
  const { probability, behaviourKey, patternType, context } = input;
  
  const builder = getBehaviourBuilder();
  if (!builder) {
    return {
      probabilityBefore: probability,
      probabilityAfter: probability,
      boost: 0,
      explanation: null,
    };
  }
  
  const model = await builder.getLatestModel();
  if (!model) {
    return {
      probabilityBefore: probability,
      probabilityAfter: probability,
      boost: 0,
      explanation: null,
    };
  }
  
  // Find behaviour key stats
  const keyStats = findBehaviourStats(model, behaviourKey);
  
  // Check minimum samples requirement
  if (!keyStats || keyStats.n < model.rules.minSamples) {
    return {
      probabilityBefore: probability,
      probabilityAfter: probability,
      boost: 0,
      explanation: null,
    };
  }
  
  // Apply boost
  const boost = keyStats.boost;
  let adjusted = probability * (1 + boost);
  
  // Clamp to valid range
  adjusted = Math.max(0.01, Math.min(0.98, adjusted));
  
  // Build explanation
  const conditionBoosts = findConditionBoosts(model, patternType);
  
  const explanation: BehaviourExplanation = {
    modelId: model.modelId,
    behaviourKey,
    patternType,
    samples: keyStats.n,
    baseWinRate: model.summary.avgWinRate,
    scenarioWinRate: keyStats.winRate,
    rawBoost: keyStats.winRate - model.summary.avgWinRate,
    confidence: keyStats.confidence,
    appliedBoost: boost,
    contributors: [
      {
        name: 'behaviourKey',
        delta: boost,
        confidence: keyStats.confidence,
      },
      ...conditionBoosts.map(c => ({
        name: c.condition,
        delta: c.boost,
        confidence: c.confidence,
      })),
    ],
  };
  
  return {
    probabilityBefore: probability,
    probabilityAfter: adjusted,
    boost,
    explanation,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROBABILITY PIPELINE
// ═══════════════════════════════════════════════════════════════

export interface ProbabilityPipelineInput {
  textbookPrior: number;
  confluenceScore: number;
  calibratedProbability?: number;
  behaviourKey: string;
  patternType: string;
  context?: Record<string, any>;
  mlOverlay?: number;
}

/**
 * Run full probability pipeline with behaviour intelligence
 */
export async function runProbabilityPipeline(
  input: ProbabilityPipelineInput
): Promise<{
  final: number;
  breakdown: ProbabilityBreakdown;
  explanation: BehaviourExplanation | null;
}> {
  const {
    textbookPrior,
    confluenceScore,
    calibratedProbability,
    behaviourKey,
    patternType,
    context,
    mlOverlay,
  } = input;
  
  // Step 1: Textbook prior
  let current = textbookPrior;
  
  // Step 2: Confluence adjustment (already applied in scoring)
  const afterConfluence = current * (0.8 + confluenceScore * 0.4);
  current = afterConfluence;
  
  // Step 3: Calibration (if available)
  const afterCalibration = calibratedProbability ?? current;
  current = afterCalibration;
  
  // Step 4: Behaviour boost
  const behaviourResult = await applyBehaviourBoost({
    probability: current,
    behaviourKey,
    patternType,
    context,
  });
  current = behaviourResult.probabilityAfter;
  
  // Step 5: ML overlay (if available)
  const afterML = mlOverlay ?? current;
  current = afterML;
  
  // Final clamp
  const final = Math.max(0.01, Math.min(0.98, current));
  
  return {
    final,
    breakdown: {
      textbook: textbookPrior,
      confluence: afterConfluence,
      calibrated: afterCalibration,
      behaviourBoost: behaviourResult.probabilityAfter,
      mlOverlay: mlOverlay,
      final,
    },
    explanation: behaviourResult.explanation,
  };
}

// ═══════════════════════════════════════════════════════════════
// TOP KEYS
// ═══════════════════════════════════════════════════════════════

/**
 * Get top performing behaviour keys
 */
export async function getTopBehaviourKeys(
  limit: number = 20
): Promise<Array<BehaviourKeyStats & { rank: number }>> {
  const builder = getBehaviourBuilder();
  if (!builder) return [];
  
  const model = await builder.getLatestModel();
  if (!model) return [];
  
  // Filter by minimum samples and sort by win rate
  return model.keys
    .filter(k => k.n >= model.rules.minSamples)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit)
    .map((k, i) => ({ ...k, rank: i + 1 }));
}
