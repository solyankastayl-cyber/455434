/**
 * Phase E: Probability Mapping
 * 
 * Converts hypothesis score (0..1) to probability (0..1)
 * - CALIBRATED: uses calibration service if available
 * - FALLBACK: logistic shrink function (conservative)
 */

export interface ProbabilityResult {
  p: number;           // 0..1
  source: 'CALIBRATED' | 'FALLBACK';
  reason: string;
}

export type Calibrator = (
  score: number, 
  ctx?: { patternTypes?: string[] }
) => Promise<number | null>;

function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Fallback probability: logistic mapping with conservative shrink
 * 
 * Formula:
 * 1. Center score around 0.5 → z ∈ [-3, +3]
 * 2. Apply logistic: 1/(1+e^(-z))
 * 3. Shrink toward 0.5 by factor 0.7 (conservative)
 * 
 * This prevents score=0.8 from becoming p=0.8 directly
 */
export function fallbackProbability(score: number): ProbabilityResult {
  // Center and scale
  const z = (score - 0.5) * 6;
  
  // Logistic function
  const logistic = 1 / (1 + Math.exp(-z));
  
  // Conservative shrink toward 0.5
  const shrinkFactor = 0.7;
  const shrunk = 0.5 + (logistic - 0.5) * shrinkFactor;
  
  return {
    p: clamp(shrunk),
    source: 'FALLBACK',
    reason: `logistic_shrink_${shrinkFactor}`
  };
}

/**
 * Main probability conversion function
 * 
 * @param score - Raw score from Hypothesis Builder (0..1)
 * @param calibrator - Optional calibration service
 * @param ctx - Context for calibration (pattern types, etc)
 */
export async function scoreToProbability(
  score: number,
  calibrator?: Calibrator,
  ctx?: { patternTypes?: string[] }
): Promise<ProbabilityResult> {
  
  // If no calibrator, use fallback
  if (!calibrator) {
    return fallbackProbability(score);
  }
  
  try {
    const calibrated = await calibrator(score, ctx);
    
    // If calibration returns null/NaN, fallback
    if (calibrated === null || Number.isNaN(calibrated)) {
      return fallbackProbability(score);
    }
    
    return {
      p: clamp(calibrated),
      source: 'CALIBRATED',
      reason: 'calibration_service'
    };
  } catch (err) {
    // On error, fallback
    return fallbackProbability(score);
  }
}

/**
 * Batch probability conversion
 */
export async function scoresToProbabilities(
  scores: number[],
  calibrator?: Calibrator
): Promise<ProbabilityResult[]> {
  return Promise.all(scores.map(s => scoreToProbability(s, calibrator)));
}
