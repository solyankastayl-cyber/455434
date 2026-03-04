/**
 * P1.3: Confidence Temporal Decay
 * 
 * Makes confidence time-aware:
 * - Confidence decays over time since last confirmation
 * - Formula: confidence × e^(-λ × timeDelta)
 * 
 * Decay behavior:
 * - 0h  → 100%
 * - 24h → ~70-85%
 * - 72h → ~40-55%
 */

/**
 * Decay configuration
 */
export const DECAY_CONFIG = {
  // Decay rate lambda (per hour)
  // 0.015 = slow decay, 0.035 = fast decay
  lambda: 0.02,
  
  // Minimum decay factor (floor)
  minDecayFactor: 0.4,
  
  // Maximum hours to consider for decay
  maxHours: 168, // 7 days
} as const;

export interface TemporalDecayResult {
  finalConfidence: number;
  decayFactor: number;
  hoursElapsed: number;
}

/**
 * Apply temporal decay to confidence score
 * 
 * @param baseConfidence - Original confidence score (0-100)
 * @param lastTriggeredAt - When signal was last triggered
 * @param now - Current time (default: now)
 * @returns Decayed confidence and decay factor
 */
export function applyTemporalDecay(
  baseConfidence: number,
  lastTriggeredAt?: Date,
  now = new Date()
): TemporalDecayResult {
  // No decay if never triggered or same time
  if (!lastTriggeredAt) {
    return {
      finalConfidence: baseConfidence,
      decayFactor: 1.0,
      hoursElapsed: 0,
    };
  }

  const hoursElapsed = Math.max(
    0,
    (now.getTime() - lastTriggeredAt.getTime()) / (1000 * 60 * 60)
  );

  // Cap hours to prevent extreme decay
  const cappedHours = Math.min(hoursElapsed, DECAY_CONFIG.maxHours);

  // Exponential decay: e^(-λ × t)
  const rawDecayFactor = Math.exp(-DECAY_CONFIG.lambda * cappedHours);

  // Apply floor to decay factor
  const decayFactor = Math.max(DECAY_CONFIG.minDecayFactor, rawDecayFactor);

  // Calculate final confidence
  const finalConfidence = Math.round(baseConfidence * decayFactor);

  return {
    finalConfidence,
    decayFactor: Math.round(decayFactor * 1000) / 1000, // Round to 3 decimals
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,   // Round to 1 decimal
  };
}

/**
 * Check if signal needs refresh based on decay
 * Returns true if confidence has decayed significantly
 */
export function needsRefresh(
  currentConfidence: number,
  lastTriggeredAt: Date,
  threshold = 0.7 // 70% of original
): boolean {
  const { decayFactor } = applyTemporalDecay(100, lastTriggeredAt);
  return decayFactor < threshold;
}

/**
 * Calculate time until confidence drops below threshold
 * 
 * @param currentConfidence - Current confidence (0-100)
 * @param threshold - Target threshold (0-100)
 * @returns Hours until threshold reached, or null if already below
 */
export function hoursUntilThreshold(
  currentConfidence: number,
  threshold: number
): number | null {
  if (currentConfidence <= threshold) return null;
  
  // Solve: confidence × e^(-λ × t) = threshold
  // t = -ln(threshold/confidence) / λ
  const ratio = threshold / currentConfidence;
  const hours = -Math.log(ratio) / DECAY_CONFIG.lambda;
  
  return Math.round(hours * 10) / 10;
}
