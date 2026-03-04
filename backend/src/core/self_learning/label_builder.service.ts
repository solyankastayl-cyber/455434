/**
 * Label Builder Service (ETAP 5.3)
 * 
 * Builds labels for "BUY success" prediction.
 * 
 * KEY LOGIC:
 * - Label = 1: BUY was correct (TRUE_POSITIVE, DELAYED_TRUE)
 * - Label = 0: BUY was wrong (FALSE_POSITIVE)
 * - MISSED cases: Not included in BUY-success model (separate recall optimization)
 * 
 * SAMPLE WEIGHTS:
 * - FP (bad BUY) gets higher weight to penalize more
 * - This is how we "learn from BUY errors"
 */

export interface LabelVector {
  label: number;          // 0 or 1
  sampleWeight: number;   // For class imbalance and FP penalty
  verdict: string;        // Original verdict for audit
}

export interface LabelsResult {
  y: number[];                  // Labels array
  weights: number[];            // Sample weights array
  verdicts: string[];           // Verdicts for audit
  labelCounts: {
    positive: number;
    negative: number;
  };
}

/**
 * Build label for a single sample
 * 
 * @param sample - LearningSample with outcome
 * @param horizon - 7d or 30d
 * @returns LabelVector
 */
export function buildLabel(
  sample: any,
  horizon: '7d' | '30d'
): LabelVector | null {
  // Check if this sample has outcome for the horizon
  const outcome = sample.outcomes?.[horizon];
  
  if (!outcome || !outcome.verdict) {
    return null; // No outcome yet
  }
  
  const verdict = outcome.verdict;
  const predictionBucket = sample.predictionBucket;
  
  // ========== LABEL LOGIC ==========
  
  // We're building a "BUY success" predictor
  // So we only care about cases where BUY was predicted
  
  if (predictionBucket !== 'BUY') {
    return null; // Not a BUY prediction, skip
  }
  
  let label: number;
  let sampleWeight: number;
  
  switch (verdict) {
    case 'TRUE_POSITIVE':
      // BUY was correct - price went up
      label = 1;
      sampleWeight = 1.0;
      break;
    
    case 'DELAYED_TRUE':
      // BUY was correct but delayed
      label = 1;
      sampleWeight = 0.8; // Slightly lower weight (delayed is less ideal)
      break;
    
    case 'FALSE_POSITIVE':
      // BUY was WRONG - price did NOT go up
      // THIS IS THE ERROR WE WANT TO LEARN FROM
      label = 0;
      sampleWeight = 1.5; // HIGHER weight to penalize FP more
      break;
    
    case 'MISSED':
      // We didn't BUY but price went up (FN)
      // NOT included in BUY-success model
      // (This would be a separate "recall optimization" model)
      return null;
    
    case 'TRUE_NEGATIVE':
      // Correctly didn't BUY
      // Not relevant for BUY-success model
      return null;
    
    default:
      return null;
  }
  
  return {
    label,
    sampleWeight,
    verdict,
  };
}

/**
 * Build labels for multiple samples
 * 
 * @param samples - Array of LearningSample
 * @param horizon - 7d or 30d
 * @returns LabelsResult
 */
export function buildLabels(
  samples: any[],
  horizon: '7d' | '30d'
): LabelsResult {
  const y: number[] = [];
  const weights: number[] = [];
  const verdicts: string[] = [];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const sample of samples) {
    const labelVector = buildLabel(sample, horizon);
    
    if (labelVector === null) {
      continue; // Skip samples without valid labels
    }
    
    y.push(labelVector.label);
    weights.push(labelVector.sampleWeight);
    verdicts.push(labelVector.verdict);
    
    if (labelVector.label === 1) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }
  
  if (y.length === 0) {
    throw new Error('No valid labels found in samples');
  }
  
  return {
    y,
    weights,
    verdicts,
    labelCounts: {
      positive: positiveCount,
      negative: negativeCount,
    },
  };
}

/**
 * Calculate class imbalance ratio
 */
export function calculateClassImbalance(labelCounts: {
  positive: number;
  negative: number;
}): {
  ratio: number;
  imbalanced: boolean;
} {
  const total = labelCounts.positive + labelCounts.negative;
  const positiveRatio = labelCounts.positive / total;
  
  // Imbalanced if minority class < 30%
  const imbalanced = positiveRatio < 0.3 || positiveRatio > 0.7;
  
  return {
    ratio: positiveRatio,
    imbalanced,
  };
}

/**
 * Get class weights for sklearn
 * 
 * This is used in training to handle class imbalance
 */
export function getClassWeights(labelCounts: {
  positive: number;
  negative: number;
}): {
  '0': number;
  '1': number;
} {
  const total = labelCounts.positive + labelCounts.negative;
  
  // Inverse frequency weighting
  const weight0 = total / (2 * labelCounts.negative);
  const weight1 = total / (2 * labelCounts.positive);
  
  return {
    '0': weight0,
    '1': weight1,
  };
}

/**
 * Why FP gets higher sample weight?
 * 
 * FALSE_POSITIVE (bad BUY) is the most expensive error:
 * - Capital is allocated
 * - Opportunity cost (could have bought something better)
 * - Potential loss if price drops
 * 
 * By giving FP cases weight=1.5:
 * - Model learns to be MORE conservative in BUY decisions
 * - ML will reduce p(success) in similar market conditions
 * - This translates to lower mlModifier → lower confidence → fewer BUYs
 * 
 * This is "learning from BUY errors" without changing the score.
 * 
 * TRUE_POSITIVE gets weight=1.0:
 * - Standard reinforcement
 * - Maintain good BUY patterns
 * 
 * DELAYED_TRUE gets weight=0.8:
 * - Still positive but less ideal (delayed)
 * - Slightly discourage patterns that lead to delays
 */
