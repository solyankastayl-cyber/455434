/**
 * Score Explanation Service (L10.3 - WHY Engine)
 * 
 * Explains WHY a score is what it is.
 * Shows breakdown, impact of each metric, and summary.
 * 
 * IMPORTANT: Uses same weights from score_formula.constants.ts
 * to ensure consistency between calculation and explanation.
 */
import { ScoreModel, IScore } from '../scores/scores.model.js';
import { BundleModel } from '../bundles/bundles.model.js';
import { 
  SCORE_FORMULA_VERSION, 
  SCORE_WEIGHTS, 
  TIER_THRESHOLDS 
} from '../scores/score_formula.constants.js';

/**
 * Score breakdown item
 */
export interface ScoreBreakdownItem {
  metric: string;
  value: number;
  weight: number;
  impact: number;  // contribution to final score
  description: string;
}

/**
 * Score explanation result
 */
export interface ScoreExplanation {
  address: string;
  window: string;
  
  finalScore: number;
  tier: 'elite' | 'green' | 'yellow' | 'red';
  
  breakdown: ScoreBreakdownItem[];
  
  strengths: string[];
  weaknesses: string[];
  
  summary: string;
  
  recommendations?: string[];
  
  // Version tracking for consistency
  formulaVersion: string;
  explainVersion: string;
}

/**
 * Get tier from composite score (using constants)
 */
function getTier(score: number): 'elite' | 'green' | 'yellow' | 'red' {
  if (score >= TIER_THRESHOLDS.green) return 'elite';
  if (score >= TIER_THRESHOLDS.yellow) return 'green';
  if (score >= TIER_THRESHOLDS.orange) return 'yellow';
  return 'red';
}

/**
 * Generate metric description
 */
function getMetricDescription(metric: string, value: number): string {
  const descriptions: Record<string, (v: number) => string> = {
    behavior: (v) => v >= 70 
      ? 'Strong behavioral patterns indicating clear strategy execution'
      : v >= 50 
        ? 'Moderate behavioral consistency in trading patterns'
        : 'Inconsistent or unclear behavioral patterns',
    
    intensity: (v) => v >= 70
      ? 'High activity intensity with significant volume'
      : v >= 50
        ? 'Moderate activity levels'
        : 'Low activity intensity',
    
    consistency: (v) => v >= 70
      ? 'Highly consistent behavior over time'
      : v >= 50
        ? 'Moderately consistent patterns'
        : 'Inconsistent or erratic behavior',
    
    risk: (v) => v >= 70
      ? '⚠️ High risk indicators (wash trading, suspicious patterns)'
      : v >= 50
        ? 'Moderate risk level'
        : 'Low risk profile',
    
    influence: (v) => v >= 70
      ? 'High market influence (large volumes, many counterparties)'
      : v >= 50
        ? 'Moderate market presence'
        : 'Low market influence',
  };
  
  return descriptions[metric]?.(value) || `${metric}: ${value}`;
}

/**
 * Explain score for an address
 */
export async function explainScore(
  address: string,
  window: string = '7d'
): Promise<ScoreExplanation | null> {
  const addr = address.toLowerCase();
  
  // Get score
  const score = await ScoreModel.findOne({ subjectId: addr, window }).lean();
  
  if (!score) {
    return null;
  }
  
  // Calculate breakdown
  const breakdown: ScoreBreakdownItem[] = [
    {
      metric: 'behavior',
      value: score.behaviorScore,
      weight: SCORE_WEIGHTS.behavior,
      impact: Math.round(score.behaviorScore * SCORE_WEIGHTS.behavior),
      description: getMetricDescription('behavior', score.behaviorScore),
    },
    {
      metric: 'intensity',
      value: score.intensityScore,
      weight: SCORE_WEIGHTS.intensity,
      impact: Math.round(score.intensityScore * SCORE_WEIGHTS.intensity),
      description: getMetricDescription('intensity', score.intensityScore),
    },
    {
      metric: 'consistency',
      value: score.consistencyScore,
      weight: SCORE_WEIGHTS.consistency,
      impact: Math.round(score.consistencyScore * SCORE_WEIGHTS.consistency),
      description: getMetricDescription('consistency', score.consistencyScore),
    },
    {
      metric: 'risk',
      value: score.riskScore,
      weight: -SCORE_WEIGHTS.risk,
      impact: -Math.round(score.riskScore * SCORE_WEIGHTS.risk),
      description: getMetricDescription('risk', score.riskScore),
    },
    {
      metric: 'influence',
      value: score.influenceScore,
      weight: SCORE_WEIGHTS.influence,
      impact: Math.round(score.influenceScore * SCORE_WEIGHTS.influence),
      description: getMetricDescription('influence', score.influenceScore),
    },
  ];
  
  // Sort by absolute impact
  breakdown.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  
  // Identify strengths and weaknesses
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  
  if (score.behaviorScore >= 70) strengths.push('Strong behavioral patterns');
  else if (score.behaviorScore < 40) weaknesses.push('Unclear behavioral patterns');
  
  if (score.intensityScore >= 70) strengths.push('High activity intensity');
  else if (score.intensityScore < 40) weaknesses.push('Low activity levels');
  
  if (score.consistencyScore >= 70) strengths.push('Consistent behavior');
  else if (score.consistencyScore < 40) weaknesses.push('Inconsistent patterns');
  
  if (score.riskScore < 30) strengths.push('Low risk profile');
  else if (score.riskScore >= 60) weaknesses.push('Elevated risk indicators');
  
  if (score.influenceScore >= 70) strengths.push('High market influence');
  else if (score.influenceScore < 30) weaknesses.push('Limited market presence');
  
  // Generate summary
  const tier = getTier(score.compositeScore);
  let summary: string;
  
  switch (tier) {
    case 'elite':
      summary = `Exceptional profile with score ${score.compositeScore}. ${strengths.slice(0, 2).join(' and ')}. This actor demonstrates highly reliable patterns.`;
      break;
    case 'green':
      summary = `Solid profile with score ${score.compositeScore}. ${strengths[0] || 'Moderate overall performance'}. Generally trustworthy patterns with some areas for observation.`;
      break;
    case 'yellow':
      summary = `Mixed profile with score ${score.compositeScore}. ${weaknesses[0] || 'Some concerns noted'}. Exercise caution and monitor for pattern changes.`;
      break;
    case 'red':
      summary = `Low-confidence profile with score ${score.compositeScore}. ${weaknesses.slice(0, 2).join(' and ')}. Significant caution advised.`;
      break;
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  if (score.riskScore >= 50) {
    recommendations.push('Monitor for wash trading patterns');
  }
  if (score.consistencyScore < 50) {
    recommendations.push('Wait for more consistent behavior before following');
  }
  if (score.influenceScore >= 70 && score.behaviorScore >= 60) {
    recommendations.push('Consider adding to watchlist for strategy signals');
  }
  
  return {
    address: addr,
    window,
    finalScore: score.compositeScore,
    tier,
    breakdown,
    strengths,
    weaknesses,
    summary,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    // Version tracking
    formulaVersion: SCORE_FORMULA_VERSION,
    explainVersion: '1.0.0',
  };
}
