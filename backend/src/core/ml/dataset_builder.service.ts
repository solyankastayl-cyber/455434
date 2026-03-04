/**
 * Dataset Builder Service (Block F4)
 * 
 * Формирует чистый training dataset
 * 
 * Pipeline: Snapshot + Outcome + Attribution → TrainingSample
 * 
 * Правило: НЕТ sample без attribution
 * Quality gates фильтруют мусор
 */
import { TrainingSampleModel } from './training_sample.model.js';
import { OutcomeSnapshotModel } from '../outcome/outcome_snapshot.model.js';
import { OutcomeAttributionModel } from '../outcome/outcome_attribution.model.js';
import { OutcomeLabelModel } from '../outcome/outcome_label.model.js';

/**
 * Create training sample from attribution
 * Core F4 logic
 */
export async function createTrainingSample(
  attributionId: string
): Promise<any | null> {
  // Fetch attribution
  const attribution = await OutcomeAttributionModel.findById(attributionId).lean();
  
  if (!attribution) {
    throw new Error('Attribution not found');
  }
  
  // Fetch snapshot and label
  const [snapshot, label] = await Promise.all([
    OutcomeSnapshotModel.findById(attribution.snapshotId).lean(),
    OutcomeLabelModel.findById(attribution.labelId).lean(),
  ]);
  
  if (!snapshot || !label) {
    throw new Error('Missing snapshot or label');
  }
  
  // Extract features
  const features = {
    dexFlow: attribution.signalContributions.dexFlow,
    whale: attribution.signalContributions.whale,
    conflict: attribution.signalContributions.conflict,
    momentum: attribution.signalContributions.momentum,
    volatility: attribution.signalContributions.volatility,
    liquidity: attribution.signalContributions.liquidity,
    coverage: snapshot.coverage,
    confidence: snapshot.confidence,
    risk: snapshot.risk,
  };
  
  // Calculate quality score
  const qualityScore = calculateQualityScore(snapshot, attribution, label);
  
  // Apply quality gates
  if (!passesQualityGates(snapshot, attribution, label, qualityScore)) {
    console.log(`[F4] Quality gate failed for ${snapshot.symbol} (score: ${qualityScore.toFixed(2)})`);
    return null;
  }
  
  // Create training sample
  const sample = await TrainingSampleModel.create({
    snapshotId: snapshot._id,
    attributionId: attribution._id,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    features,
    bucket: snapshot.bucket,
    engineMode: snapshot.engineMode,
    signalFreshness: snapshot.signalFreshness?.engine?.freshness || 'unknown',
    outcomeLabel: label.outcome,
    severity: label.severity,
    deltaPct: label.deltaPct,
    dominantSignals: attribution.dominantSignals,
    misleadingSignals: attribution.misleadingSignals,
    confidenceDelta: attribution.confidenceDelta,
    qualityScore,
    timestamp: snapshot.decidedAt,
    windowHours: attribution.windowHours,
    usedInTraining: false,
  });
  
  console.log(`[F4] Training sample created: ${snapshot.symbol} ${snapshot.bucket} ${label.outcome} (quality: ${qualityScore.toFixed(2)})`);
  
  return sample;
}

/**
 * Calculate quality score for sample
 * 0 = trash, 1 = perfect
 */
function calculateQualityScore(
  snapshot: any,
  attribution: any,
  label: any
): number {
  let score = 0.5; // Base score
  
  // Coverage bonus
  if (snapshot.coverageLevel === 'HIGH') score += 0.2;
  else if (snapshot.coverageLevel === 'MEDIUM') score += 0.1;
  else score -= 0.1; // LOW coverage penalty
  
  // Severity bonus (strong outcomes are more valuable)
  score += label.severity * 0.2;
  
  // Dominant signals bonus (clear attribution)
  if (attribution.dominantSignals.length > 0) {
    score += 0.15;
  }
  
  // Misleading signals penalty (conflicting data)
  if (attribution.misleadingSignals.length > 2) {
    score -= 0.15;
  }
  
  // Missing signals penalty (blind spots)
  if (attribution.missingSignals.length > 3) {
    score -= 0.2;
  }
  
  // Conflict detected penalty
  if (snapshot.conflictDetected) {
    score -= 0.1;
  }
  
  // Freshness bonus
  if (snapshot.signalFreshness?.engine?.freshness === 'fresh') {
    score += 0.1;
  } else if (snapshot.signalFreshness?.engine?.freshness === 'stale') {
    score -= 0.1;
  }
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Quality gates - фильтрация мусора
 * Sample НЕ ДОБАВЛЯЕТСЯ если не проходит gates
 */
function passesQualityGates(
  snapshot: any,
  attribution: any,
  label: any,
  qualityScore: number
): boolean {
  // Gate 1: Minimum quality score
  if (qualityScore < 0.3) {
    return false;
  }
  
  // Gate 2: Coverage must not be LOW for high-stakes decisions
  if (snapshot.bucket === 'BUY' && snapshot.coverageLevel === 'LOW') {
    return false;
  }
  
  // Gate 3: Severity threshold (weak outcomes are noise)
  if (label.severity < 0.2) {
    return false;
  }
  
  // Gate 4: Too many missing signals = blind decision
  if (attribution.missingSignals.length > 4) {
    return false;
  }
  
  // Gate 5: High conflict score = unreliable
  if (snapshot.conflictDetected && attribution.signalContributions.conflict < -0.3) {
    return false;
  }
  
  return true;
}

/**
 * Batch create training samples from attributions
 */
export async function batchCreateTrainingSamples(
  windowHours: 24 | 72 | 168
): Promise<{
  processed: number;
  created: number;
  rejected: number;
}> {
  console.log(`[F4] Batch creating training samples for T+${windowHours}h window...`);
  
  // Find attributions without training samples
  const attributions = await OutcomeAttributionModel.find({
    windowHours,
  }).lean();
  
  const existingSamples = await TrainingSampleModel.find({
    attributionId: { $in: attributions.map(a => a._id) },
  }).lean();
  
  const existingAttributionIds = new Set(existingSamples.map(s => s.attributionId.toString()));
  
  const newAttributions = attributions.filter(
    a => !existingAttributionIds.has(a._id.toString())
  );
  
  if (newAttributions.length === 0) {
    console.log('[F4] No new attributions to process');
    return { processed: 0, created: 0, rejected: 0 };
  }
  
  let created = 0;
  let rejected = 0;
  
  for (const attribution of newAttributions) {
    try {
      const sample = await createTrainingSample(attribution._id.toString());
      if (sample) {
        created++;
      } else {
        rejected++;
      }
    } catch (error) {
      console.error(`[F4] Failed to create sample for attribution ${attribution._id}:`, error);
      rejected++;
    }
  }
  
  console.log(`[F4] Batch complete: ${created} created, ${rejected} rejected`);
  
  return {
    processed: newAttributions.length,
    created,
    rejected,
  };
}

/**
 * Get dataset statistics
 */
export async function getDatasetStats() {
  const [total, byBucket, byOutcome, qualityDist, recentCount] = await Promise.all([
    TrainingSampleModel.countDocuments(),
    TrainingSampleModel.aggregate([
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ]),
    TrainingSampleModel.aggregate([
      { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } },
    ]),
    TrainingSampleModel.aggregate([
      { 
        $bucket: {
          groupBy: '$qualityScore',
          boundaries: [0, 0.3, 0.5, 0.7, 0.9, 1.0],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]),
    TrainingSampleModel.countDocuments({
      timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);
  
  // Format bucket counts
  const bucketCounts: any = {};
  for (const item of byBucket) {
    bucketCounts[item._id] = item.count;
  }
  
  // Format outcome counts
  const outcomeCounts: any = {};
  for (const item of byOutcome) {
    outcomeCounts[item._id] = item.count;
  }
  
  // Calculate success rate
  const successRate = total > 0 
    ? ((outcomeCounts.SUCCESS || 0) / total) * 100 
    : 0;
  
  // Top signals analysis
  const topSignals = await getTopSignals();
  
  return {
    total,
    byBucket: {
      BUY: bucketCounts.BUY || 0,
      WATCH: bucketCounts.WATCH || 0,
      SELL: bucketCounts.SELL || 0,
    },
    byOutcome: {
      SUCCESS: outcomeCounts.SUCCESS || 0,
      FLAT: outcomeCounts.FLAT || 0,
      FAIL: outcomeCounts.FAIL || 0,
    },
    successRate: Math.round(successRate * 10) / 10,
    qualityDistribution: qualityDist,
    recent7d: recentCount,
    topSignals,
  };
}

/**
 * Get top signals from dataset
 */
async function getTopSignals() {
  const samples = await TrainingSampleModel.find()
    .select('dominantSignals misleadingSignals')
    .lean();
  
  const dominantFreq: any = {};
  const misleadingFreq: any = {};
  
  for (const sample of samples) {
    for (const signal of sample.dominantSignals || []) {
      dominantFreq[signal] = (dominantFreq[signal] || 0) + 1;
    }
    for (const signal of sample.misleadingSignals || []) {
      misleadingFreq[signal] = (misleadingFreq[signal] || 0) + 1;
    }
  }
  
  const topDominant = Object.entries(dominantFreq)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([signal, count]) => ({ signal, count }));
  
  const topMisleading = Object.entries(misleadingFreq)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([signal, count]) => ({ signal, count }));
  
  return {
    dominant: topDominant,
    misleading: topMisleading,
  };
}

/**
 * Get recent training samples
 */
export async function getRecentSamples(limit = 50, minQuality = 0) {
  return TrainingSampleModel.find({
    qualityScore: { $gte: minQuality },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get training samples for token
 */
export async function getTokenSamples(
  tokenAddress: string,
  limit = 20
) {
  return TrainingSampleModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}
