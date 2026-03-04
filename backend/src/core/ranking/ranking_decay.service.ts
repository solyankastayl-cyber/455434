/**
 * Temporal Decay Service (Block D - D4)
 * 
 * Applies time-based decay to signals and confidence scores
 * Old signals should not weigh as much as fresh ones
 */

/**
 * Calculate exponential decay factor
 * 
 * Formula: decay = exp(-Δt / τ)
 * 
 * @param deltaMinutes - Time since signal (in minutes)
 * @param halfLifeMinutes - Half-life period (default: 6 hours = 360 minutes)
 * @returns Decay factor between 0 and 1
 */
export function calculateDecayFactor(
  deltaMinutes: number,
  halfLifeMinutes = 360 // 6 hours default
): number {
  if (deltaMinutes <= 0) return 1.0;
  
  // Exponential decay: e^(-t/τ)
  const tau = halfLifeMinutes / Math.LN2; // Convert half-life to time constant
  const decay = Math.exp(-deltaMinutes / tau);
  
  return Math.max(0, Math.min(1, decay));
}

/**
 * Apply decay to actor signal score
 * C5.2 - Signal Freshness integration
 */
export function applyActorSignalDecay(
  actorSignalScore: number,
  signalTimestamp: Date,
  currentTime: Date = new Date()
): {
  originalScore: number;
  decayedScore: number;
  decayFactor: number;
  ageMinutes: number;
  freshness: 'fresh' | 'recent' | 'stale';
} {
  const ageMinutes = (currentTime.getTime() - signalTimestamp.getTime()) / 1000 / 60;
  
  // Apply decay
  const decayFactor = calculateDecayFactor(ageMinutes);
  const decayedScore = actorSignalScore * decayFactor;
  
  // Determine freshness level
  let freshness: 'fresh' | 'recent' | 'stale';
  if (ageMinutes < 60) {
    freshness = 'fresh'; // < 1 hour
  } else if (ageMinutes < 360) {
    freshness = 'recent'; // < 6 hours
  } else {
    freshness = 'stale'; // >= 6 hours
  }
  
  return {
    originalScore: actorSignalScore,
    decayedScore: Math.round(decayedScore * 100) / 100,
    decayFactor: Math.round(decayFactor * 100) / 100,
    ageMinutes: Math.round(ageMinutes),
    freshness,
  };
}

/**
 * Apply decay to engine confidence
 */
export function applyEngineConfidenceDecay(
  confidence: number,
  analysisTimestamp: Date,
  currentTime: Date = new Date(),
  halfLifeMinutes = 720 // 12 hours for engine (slower decay)
): {
  originalConfidence: number;
  decayedConfidence: number;
  decayFactor: number;
  ageMinutes: number;
} {
  const ageMinutes = (currentTime.getTime() - analysisTimestamp.getTime()) / 1000 / 60;
  
  // Apply decay to the deviation from neutral (50)
  const deviation = confidence - 50;
  const decayFactor = calculateDecayFactor(ageMinutes, halfLifeMinutes);
  const decayedDeviation = deviation * decayFactor;
  const decayedConfidence = 50 + decayedDeviation;
  
  return {
    originalConfidence: confidence,
    decayedConfidence: Math.round(decayedConfidence * 100) / 100,
    decayFactor: Math.round(decayFactor * 100) / 100,
    ageMinutes: Math.round(ageMinutes),
  };
}

/**
 * Format age for display (C5.2)
 */
export function formatSignalAge(ageMinutes: number): string {
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m ago`;
  if (ageMinutes < 1440) return `${Math.round(ageMinutes / 60)}h ago`;
  return `${Math.round(ageMinutes / 1440)}d ago`;
}

/**
 * Get signal freshness indicator for UI (C5.2)
 */
export interface SignalFreshnessIndicator {
  engine: {
    age: string;
    freshness: 'fresh' | 'recent' | 'stale';
    decayFactor: number;
  };
  dexFlow?: {
    age: string;
    freshness: 'fresh' | 'recent' | 'stale';
    decayFactor: number;
  };
  whale?: {
    age: string;
    freshness: 'fresh' | 'recent' | 'stale';
    decayFactor: number;
  };
}

export function buildSignalFreshnessIndicator(
  engineTimestamp: Date,
  dexFlowTimestamp?: Date,
  whaleTimestamp?: Date,
  currentTime: Date = new Date()
): SignalFreshnessIndicator {
  const indicator: SignalFreshnessIndicator = {
    engine: buildFreshnessEntry(engineTimestamp, currentTime, 720),
  };

  if (dexFlowTimestamp) {
    indicator.dexFlow = buildFreshnessEntry(dexFlowTimestamp, currentTime, 360);
  }

  if (whaleTimestamp) {
    indicator.whale = buildFreshnessEntry(whaleTimestamp, currentTime, 360);
  }

  return indicator;
}

function buildFreshnessEntry(
  timestamp: Date,
  currentTime: Date,
  halfLifeMinutes: number
) {
  const ageMinutes = (currentTime.getTime() - timestamp.getTime()) / 1000 / 60;
  const decayFactor = calculateDecayFactor(ageMinutes, halfLifeMinutes);

  let freshness: 'fresh' | 'recent' | 'stale';
  if (ageMinutes < 60) {
    freshness = 'fresh';
  } else if (ageMinutes < 360) {
    freshness = 'recent';
  } else {
    freshness = 'stale';
  }

  return {
    age: formatSignalAge(ageMinutes),
    freshness,
    decayFactor: Math.round(decayFactor * 100) / 100,
  };
}

/**
 * Calculate overall signal quality based on freshness
 */
export function calculateSignalQuality(
  engineAge: number,
  actorSignalsAge?: number
): {
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  score: number;
} {
  const engineFactor = calculateDecayFactor(engineAge, 720);
  const actorFactor = actorSignalsAge ? calculateDecayFactor(actorSignalsAge, 360) : 1;

  const qualityScore = (engineFactor * 0.5 + actorFactor * 0.5) * 100;

  let quality: 'excellent' | 'good' | 'fair' | 'poor';
  if (qualityScore >= 80) {
    quality = 'excellent';
  } else if (qualityScore >= 60) {
    quality = 'good';
  } else if (qualityScore >= 40) {
    quality = 'fair';
  } else {
    quality = 'poor';
  }

  return {
    quality,
    score: Math.round(qualityScore),
  };
}
