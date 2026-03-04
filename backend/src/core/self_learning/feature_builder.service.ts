/**
 * Feature Builder Service (ETAP 5.3)
 * 
 * Builds deterministic feature vectors from LearningSample.
 * 
 * CRITICAL REQUIREMENTS:
 * - NO Date.now() or random values
 * - Stable feature ordering
 * - Schema hashing for integrity
 * - Reproducible across runs
 */
import crypto from 'crypto';

export interface FeatureVector {
  features: Record<string, number>;
  featureNames: string[];
  schemaHash: string;
}

/**
 * Build feature vector from learning sample
 * 
 * @param sample - LearningSample from ETAP 3.4
 * @returns FeatureVector with stable ordering
 */
export function buildFeatures(sample: any): FeatureVector {
  const features: Record<string, number> = {};
  
  // ========== CORE RANKING FEATURES ==========
  
  // Composite score (from engine)
  features['composite_score'] = sample.features?.compositeScore ?? 0;
  
  // Engine confidence
  features['engine_confidence'] = sample.features?.engineConfidence ?? 0;
  
  // Risk score
  features['risk_score'] = sample.features?.risk ?? 0;
  
  // ========== ACTOR SIGNALS ==========
  
  // Actor signal score (aggregated)
  features['actor_signal_score'] = sample.features?.actorSignalScore ?? 0;
  
  // Individual signal strengths
  features['signal_dex_flow'] = sample.features?.signals?.dexFlow ?? 0;
  features['signal_whale_transfer'] = sample.features?.signals?.whaleTransfer ?? 0;
  features['signal_conflict'] = sample.features?.signals?.conflict ?? 0;
  features['signal_corridor_spike'] = sample.features?.signals?.corridorSpike ?? 0;
  features['signal_behavior_shift'] = sample.features?.signals?.behaviorShift ?? 0;
  
  // ========== DRIFT & QUALITY ==========
  
  // Drift score
  features['drift_score'] = sample.dataQuality?.driftScore ?? 0;
  
  // Drift level (encoded)
  const driftLevel = sample.dataQuality?.driftLevel || 'LOW';
  features['drift_low'] = driftLevel === 'LOW' ? 1 : 0;
  features['drift_medium'] = driftLevel === 'MEDIUM' ? 1 : 0;
  features['drift_high'] = driftLevel === 'HIGH' ? 1 : 0;
  features['drift_critical'] = driftLevel === 'CRITICAL' ? 1 : 0;
  
  // Quality score
  features['quality_score'] = sample.dataQuality?.qualityScore ?? 0;
  
  // Approval status (LIVE data)
  features['approved'] = sample.dataQuality?.approved === true ? 1 : 0;
  
  // ========== LIVE COVERAGE ==========
  
  // LIVE data share
  features['live_coverage'] = sample.dataQuality?.liveCoverage ?? 0;
  
  // Source (1 = LIVE, 0 = SIMULATION)
  features['is_live'] = sample.source === 'LIVE' ? 1 : 0;
  
  // ========== BUCKET (ONE-HOT) ==========
  
  const bucket = sample.predictionBucket || 'WATCH';
  features['bucket_buy'] = bucket === 'BUY' ? 1 : 0;
  features['bucket_watch'] = bucket === 'WATCH' ? 1 : 0;
  features['bucket_sell'] = bucket === 'SELL' ? 1 : 0;
  
  // ========== TREND LABEL (ONE-HOT) ==========
  
  const trendLabel = sample.labels?.trendLabel || 'SIDEWAYS';
  features['trend_up'] = trendLabel === 'TREND_UP' ? 1 : 0;
  features['trend_down'] = trendLabel === 'TREND_DOWN' ? 1 : 0;
  features['trend_sideways'] = trendLabel === 'SIDEWAYS' ? 1 : 0;
  features['trend_noise'] = trendLabel === 'NOISE' ? 1 : 0;
  
  // ========== SIGNAL REWEIGHTING (if available) ==========
  
  // Adjusted signal weights from Signal Reweighting v1.1
  if (sample.features?.signalTypeWeights) {
    features['weight_dex_flow'] = sample.features.signalTypeWeights.DEX_FLOW ?? 0.35;
    features['weight_whale'] = sample.features.signalTypeWeights.WHALE_TRANSFER ?? 0.30;
    features['weight_conflict'] = sample.features.signalTypeWeights.CONFLICT ?? 0.20;
  } else {
    // Default weights
    features['weight_dex_flow'] = 0.35;
    features['weight_whale'] = 0.30;
    features['weight_conflict'] = 0.20;
  }
  
  // ========== STABLE ORDERING ==========
  
  const featureNames = Object.keys(features).sort();
  
  // Rebuild with stable ordering
  const orderedFeatures: Record<string, number> = {};
  for (const name of featureNames) {
    orderedFeatures[name] = features[name];
  }
  
  // ========== SCHEMA HASH ==========
  
  const schemaHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(featureNames))
    .digest('hex')
    .slice(0, 16);
  
  return {
    features: orderedFeatures,
    featureNames,
    schemaHash,
  };
}

/**
 * Build feature matrix from multiple samples
 * 
 * @param samples - Array of LearningSample
 * @returns Feature matrix (2D array) + metadata
 */
export function buildFeatureMatrix(samples: any[]): {
  X: number[][];
  featureNames: string[];
  schemaHash: string;
  sampleCount: number;
} {
  if (samples.length === 0) {
    throw new Error('Cannot build feature matrix: no samples');
  }
  
  // Build first to get schema
  const first = buildFeatures(samples[0]);
  const featureNames = first.featureNames;
  const schemaHash = first.schemaHash;
  
  // Build matrix
  const X: number[][] = [];
  
  for (const sample of samples) {
    const fv = buildFeatures(sample);
    
    // Verify schema consistency
    if (fv.schemaHash !== schemaHash) {
      throw new Error(
        `Schema mismatch: expected ${schemaHash}, got ${fv.schemaHash}`
      );
    }
    
    // Extract values in order
    const row = featureNames.map(name => fv.features[name]);
    X.push(row);
  }
  
  return {
    X,
    featureNames,
    schemaHash,
    sampleCount: X.length,
  };
}

/**
 * Validate feature schema
 */
export function validateFeatureSchema(
  features: FeatureVector,
  expectedHash: string
): {
  valid: boolean;
  actualHash: string;
  expectedHash: string;
} {
  return {
    valid: features.schemaHash === expectedHash,
    actualHash: features.schemaHash,
    expectedHash,
  };
}

/**
 * Get feature count
 */
export function getFeatureCount(schemaHash: string, featureNames: string[]): number {
  return featureNames.length;
}
