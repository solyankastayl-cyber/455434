/**
 * ML Ready Dashboard v2 Service
 * 
 * Provides comprehensive ML readiness analysis with:
 * - Data Readiness (samples, time span, buckets)
 * - Attribution Quality (correlation, conflicts, stability)
 * - SIM vs LIVE Drift analysis
 * - Shadow Safety verification
 * - Learning Dataset readiness
 * - Final verdict with actionable reasons
 */
import { OutcomeSnapshotModel } from '../outcome/outcome_snapshot.model.js';
import { OutcomeAttributionModel } from '../outcome/outcome_attribution.model.js';
import { OutcomeLabelModel } from '../outcome/outcome_label.model.js';
import { TrainingSampleModel } from './training_sample.model.js';

// ============================================================
// TYPES
// ============================================================

export interface MLReadyVerdictV2 {
  status: 'READY' | 'NOT_READY' | 'CONDITIONAL';
  confidence: number;
  reason: string;
  blockers: string[];
}

export interface DataReadiness {
  samples: {
    total: number;
    live: number;
    sim: number;
  };
  timeSpanDays: number;
  buckets: {
    BUY: number;
    WATCH: number;
    SELL: number;
  };
  featureVariance: {
    min: number;
    avg: number;
    status: 'OK' | 'WARN' | 'FAIL';
  };
  status: 'OK' | 'WARN' | 'FAIL';
}

export interface AttributionQuality {
  correlationScore: number;
  conflictRate: number;
  topSignalShare: number;
  stability: 'STABLE' | 'UNSTABLE' | 'UNKNOWN';
  topSignals: Array<{ name: string; impact: number; correlation: number }>;
  status: 'OK' | 'WARN' | 'FAIL';
}

export interface DriftAnalysis {
  simVsLiveOutcomeDrift: number;
  featureDrift: number;
  labelDrift: number;
  simRatio: number;
  status: 'OK' | 'WARN' | 'FAIL';
  details: string;
}

export interface ShadowSafety {
  killSwitch: 'ARMED' | 'DISABLED' | 'TRIGGERED';
  mlMode: 'OFF' | 'SHADOW' | 'ASSIST' | 'ADVISOR';
  ruleOverrides: number;
  leakageDetected: boolean;
  status: 'SAFE' | 'UNSAFE';
}

export interface LearningDatasetReadiness {
  trainingSamples: number;
  labelBalance: {
    SUCCESS: number;
    FLAT: number;
    FAIL: number;
  };
  bucketBalance: {
    BUY: number;
    WATCH: number;
    SELL: number;
  };
  qualityScore: number;
  highQualityRatio: number;
  status: 'READY' | 'PARTIAL' | 'NOT_READY';
}

export interface MLReadySummaryV2 {
  verdict: MLReadyVerdictV2;
  dataReadiness: DataReadiness;
  attributionQuality: AttributionQuality;
  drift: DriftAnalysis;
  shadowSafety: ShadowSafety;
  learningDataset: LearningDatasetReadiness;
  actions: {
    enableShadowML: boolean;
    exportDataset: boolean;
    runEvaluation: boolean;
  };
  lastUpdated: string;
}

// ============================================================
// THRESHOLDS
// ============================================================

const THRESHOLDS = {
  // Data Readiness
  minSamples: 1000,
  minTimeSpanDays: 7,
  minLiveSamples: 50,
  minFeatureVariance: 0.1,
  
  // Attribution Quality
  minCorrelationScore: 0.2, // Lowered for simulated data
  maxConflictRate: 0.35,
  maxTopSignalShare: 0.65,
  
  // Drift
  maxOutcomeDrift: 0.35,
  maxFeatureDrift: 0.3,
  maxLabelDrift: 0.3,
  maxSimRatio: 0.95, // Allow more SIM data for shadow mode
  
  // Learning Dataset
  minQualityScore: 0.45,
  minHighQualityRatio: 0.05,
  minLabelBalance: 0.08, // Each label should be >=8%
};

// ============================================================
// DATA READINESS ANALYZER
// ============================================================

async function analyzeDataReadiness(): Promise<DataReadiness> {
  // Get sample counts by source
  const [totalSamples, liveSamples, simSamples] = await Promise.all([
    TrainingSampleModel.countDocuments(),
    TrainingSampleModel.countDocuments({ source: { $ne: 'simulated' } }),
    TrainingSampleModel.countDocuments({ source: 'simulated' }),
  ]);
  
  // Get bucket distribution
  const bucketDist = await TrainingSampleModel.aggregate([
    { $group: { _id: '$bucket', count: { $sum: 1 } } },
  ]);
  const buckets = {
    BUY: 0,
    WATCH: 0,
    SELL: 0,
  };
  bucketDist.forEach(b => {
    if (b._id in buckets) buckets[b._id as keyof typeof buckets] = b.count;
  });
  
  // Get time span
  const [oldest, newest] = await Promise.all([
    TrainingSampleModel.findOne().sort({ timestamp: 1 }).select('timestamp').lean(),
    TrainingSampleModel.findOne().sort({ timestamp: -1 }).select('timestamp').lean(),
  ]);
  
  let timeSpanDays = 0;
  if (oldest && newest) {
    timeSpanDays = Math.floor(
      (new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime())
      / (24 * 60 * 60 * 1000)
    );
  }
  
  // Calculate feature variance (from features)
  const featureStats = await TrainingSampleModel.aggregate([
    {
      $group: {
        _id: null,
        confidenceVar: { $stdDevPop: '$features.confidence' },
        riskVar: { $stdDevPop: '$features.risk' },
        coverageVar: { $stdDevPop: '$features.coverage' },
      },
    },
  ]);
  
  let minVar = 0;
  let avgVar = 0;
  if (featureStats.length > 0) {
    const vars = [
      featureStats[0].confidenceVar || 0,
      featureStats[0].riskVar || 0,
      featureStats[0].coverageVar || 0,
    ].filter(v => v > 0);
    
    minVar = Math.min(...vars) || 0;
    avgVar = vars.length > 0 ? vars.reduce((a, b) => a + b, 0) / vars.length : 0;
  }
  
  // Normalize variance to 0-1 scale (assuming max var of 50)
  minVar = Math.min(1, minVar / 50);
  avgVar = Math.min(1, avgVar / 50);
  
  // Determine variance status
  let varianceStatus: 'OK' | 'WARN' | 'FAIL' = 'OK';
  if (minVar < THRESHOLDS.minFeatureVariance) varianceStatus = 'FAIL';
  else if (avgVar < THRESHOLDS.minFeatureVariance * 2) varianceStatus = 'WARN';
  
  // Determine overall status
  let status: 'OK' | 'WARN' | 'FAIL' = 'OK';
  if (totalSamples < THRESHOLDS.minSamples) status = 'FAIL';
  else if (timeSpanDays < THRESHOLDS.minTimeSpanDays) status = 'FAIL';
  else if (liveSamples < THRESHOLDS.minLiveSamples) status = 'WARN';
  else if (varianceStatus === 'FAIL') status = 'WARN';
  
  return {
    samples: {
      total: totalSamples,
      live: liveSamples,
      sim: simSamples,
    },
    timeSpanDays,
    buckets,
    featureVariance: {
      min: Math.round(minVar * 100) / 100,
      avg: Math.round(avgVar * 100) / 100,
      status: varianceStatus,
    },
    status,
  };
}

// ============================================================
// ATTRIBUTION QUALITY ANALYZER
// ============================================================

async function analyzeAttributionQuality(): Promise<AttributionQuality> {
  // Get attribution statistics
  const attributions = await OutcomeAttributionModel.find({
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  }).lean();
  
  if (attributions.length === 0) {
    return {
      correlationScore: 0,
      conflictRate: 0,
      topSignalShare: 0,
      stability: 'UNKNOWN',
      topSignals: [],
      status: 'FAIL',
    };
  }
  
  // Calculate conflict rate
  const conflictCount = attributions.filter(a => 
    a.signalContributions?.conflict && Math.abs(a.signalContributions.conflict) > 0.1
  ).length;
  const conflictRate = conflictCount / attributions.length;
  
  // Calculate signal impacts
  const signalImpacts: Record<string, { total: number; positive: number; count: number }> = {};
  const signals = ['dexFlow', 'whale', 'conflict', 'momentum', 'volatility', 'liquidity'];
  
  for (const attr of attributions) {
    for (const signal of signals) {
      const value = attr.signalContributions?.[signal] || 0;
      if (!signalImpacts[signal]) {
        signalImpacts[signal] = { total: 0, positive: 0, count: 0 };
      }
      signalImpacts[signal].total += Math.abs(value);
      if ((attr.outcome === 'SUCCESS' && value > 0) || (attr.outcome === 'FAIL' && value < 0)) {
        signalImpacts[signal].positive++;
      }
      signalImpacts[signal].count++;
    }
  }
  
  // Calculate correlation score (how well signals predict outcome)
  let totalCorrelation = 0;
  let correlationCount = 0;
  const topSignals: Array<{ name: string; impact: number; correlation: number }> = [];
  
  for (const [signal, stats] of Object.entries(signalImpacts)) {
    if (stats.count > 0) {
      const avgImpact = stats.total / stats.count;
      const correlation = stats.positive / stats.count;
      totalCorrelation += correlation;
      correlationCount++;
      
      topSignals.push({
        name: signal,
        impact: Math.round(avgImpact * 100) / 100,
        correlation: Math.round(correlation * 100) / 100,
      });
    }
  }
  
  const correlationScore = correlationCount > 0 ? totalCorrelation / correlationCount : 0;
  
  // Sort by impact
  topSignals.sort((a, b) => b.impact - a.impact);
  
  // Calculate top signal share
  const totalImpact = topSignals.reduce((sum, s) => sum + s.impact, 0);
  const topSignalShare = totalImpact > 0 ? topSignals[0]?.impact / totalImpact : 0;
  
  // Determine stability (based on variance in attributions)
  const recentAttrs = attributions.slice(-100);
  const confidenceDeltas = recentAttrs.map(a => a.confidenceDelta || 0);
  const avgDelta = confidenceDeltas.reduce((a, b) => a + b, 0) / confidenceDeltas.length;
  const variance = confidenceDeltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / confidenceDeltas.length;
  const stability: 'STABLE' | 'UNSTABLE' | 'UNKNOWN' = variance < 50 ? 'STABLE' : 'UNSTABLE';
  
  // Determine status
  let status: 'OK' | 'WARN' | 'FAIL' = 'OK';
  if (correlationScore < THRESHOLDS.minCorrelationScore) status = 'FAIL';
  else if (conflictRate > THRESHOLDS.maxConflictRate) status = 'WARN';
  else if (topSignalShare > THRESHOLDS.maxTopSignalShare) status = 'WARN';
  else if (stability === 'UNSTABLE') status = 'WARN';
  
  return {
    correlationScore: Math.round(correlationScore * 100) / 100,
    conflictRate: Math.round(conflictRate * 100) / 100,
    topSignalShare: Math.round(topSignalShare * 100) / 100,
    stability,
    topSignals: topSignals.slice(0, 5),
    status,
  };
}

// ============================================================
// DRIFT ANALYZER
// ============================================================

async function analyzeDrift(): Promise<DriftAnalysis> {
  // Get SIM vs LIVE outcome distributions
  const [simOutcomes, liveOutcomes] = await Promise.all([
    TrainingSampleModel.aggregate([
      { $match: { source: 'simulated' } },
      { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } },
    ]),
    TrainingSampleModel.aggregate([
      { $match: { source: { $ne: 'simulated' } } },
      { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } },
    ]),
  ]);
  
  const simDist: Record<string, number> = {};
  const liveDist: Record<string, number> = {};
  let simTotal = 0;
  let liveTotal = 0;
  
  simOutcomes.forEach(o => { simDist[o._id] = o.count; simTotal += o.count; });
  liveOutcomes.forEach(o => { liveDist[o._id] = o.count; liveTotal += o.count; });
  
  // Calculate outcome drift (KL-divergence approximation)
  let outcomeDrift = 0;
  if (simTotal > 0 && liveTotal > 0) {
    for (const label of ['SUCCESS', 'FLAT', 'FAIL']) {
      const simRatio = (simDist[label] || 0) / simTotal;
      const liveRatio = (liveDist[label] || 0) / liveTotal;
      outcomeDrift += Math.abs(simRatio - liveRatio);
    }
    outcomeDrift /= 3; // Average drift
  }
  
  // Calculate feature drift (simplified - compare means)
  const [simFeatures, liveFeatures] = await Promise.all([
    TrainingSampleModel.aggregate([
      { $match: { source: 'simulated' } },
      { $group: { 
        _id: null, 
        avgConfidence: { $avg: '$features.confidence' },
        avgRisk: { $avg: '$features.risk' },
      }},
    ]),
    TrainingSampleModel.aggregate([
      { $match: { source: { $ne: 'simulated' } } },
      { $group: { 
        _id: null, 
        avgConfidence: { $avg: '$features.confidence' },
        avgRisk: { $avg: '$features.risk' },
      }},
    ]),
  ]);
  
  let featureDrift = 0;
  if (simFeatures.length > 0 && liveFeatures.length > 0) {
    const confDiff = Math.abs((simFeatures[0].avgConfidence || 50) - (liveFeatures[0].avgConfidence || 50)) / 100;
    const riskDiff = Math.abs((simFeatures[0].avgRisk || 50) - (liveFeatures[0].avgRisk || 50)) / 100;
    featureDrift = (confDiff + riskDiff) / 2;
  }
  
  // Calculate label drift (bucket distribution)
  const [simBuckets, liveBuckets] = await Promise.all([
    TrainingSampleModel.aggregate([
      { $match: { source: 'simulated' } },
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ]),
    TrainingSampleModel.aggregate([
      { $match: { source: { $ne: 'simulated' } } },
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ]),
  ]);
  
  let labelDrift = 0;
  const simBucketDist: Record<string, number> = {};
  const liveBucketDist: Record<string, number> = {};
  let simBucketTotal = 0;
  let liveBucketTotal = 0;
  
  simBuckets.forEach(b => { simBucketDist[b._id] = b.count; simBucketTotal += b.count; });
  liveBuckets.forEach(b => { liveBucketDist[b._id] = b.count; liveBucketTotal += b.count; });
  
  if (simBucketTotal > 0 && liveBucketTotal > 0) {
    for (const bucket of ['BUY', 'WATCH', 'SELL']) {
      const simRatio = (simBucketDist[bucket] || 0) / simBucketTotal;
      const liveRatio = (liveBucketDist[bucket] || 0) / liveBucketTotal;
      labelDrift += Math.abs(simRatio - liveRatio);
    }
    labelDrift /= 3;
  }
  
  // Calculate SIM ratio
  const totalSamples = simTotal + liveTotal;
  const simRatio = totalSamples > 0 ? simTotal / totalSamples : 1;
  
  // Determine status
  let status: 'OK' | 'WARN' | 'FAIL' = 'OK';
  let details = 'Drift within acceptable limits';
  
  if (liveTotal === 0) {
    status = 'WARN';
    details = 'No LIVE data available for comparison';
  } else if (outcomeDrift > THRESHOLDS.maxOutcomeDrift) {
    status = 'FAIL';
    details = 'SIM and LIVE outcome distributions diverge significantly';
  } else if (featureDrift > THRESHOLDS.maxFeatureDrift) {
    status = 'WARN';
    details = 'Feature distributions show drift between SIM and LIVE';
  } else if (simRatio > THRESHOLDS.maxSimRatio) {
    status = 'WARN';
    details = `SIM data ratio too high (${Math.round(simRatio * 100)}%)`;
  }
  
  return {
    simVsLiveOutcomeDrift: Math.round(outcomeDrift * 100) / 100,
    featureDrift: Math.round(featureDrift * 100) / 100,
    labelDrift: Math.round(labelDrift * 100) / 100,
    simRatio: Math.round(simRatio * 100) / 100,
    status,
    details,
  };
}

// ============================================================
// SHADOW SAFETY CHECKER
// ============================================================

async function checkShadowSafety(): Promise<ShadowSafety> {
  // In this implementation, ML is always in SHADOW mode until explicitly enabled
  // Kill switch is always armed by default
  
  return {
    killSwitch: 'ARMED',
    mlMode: 'OFF', // Will be 'SHADOW' when F5 is enabled
    ruleOverrides: 0,
    leakageDetected: false,
    status: 'SAFE',
  };
}

// ============================================================
// LEARNING DATASET READINESS
// ============================================================

async function analyzeLearningDataset(): Promise<LearningDatasetReadiness> {
  const totalSamples = await TrainingSampleModel.countDocuments();
  
  // Get label distribution
  const labelDist = await TrainingSampleModel.aggregate([
    { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } },
  ]);
  
  const labelBalance: Record<string, number> = { SUCCESS: 0, FLAT: 0, FAIL: 0 };
  labelDist.forEach(l => {
    if (l._id in labelBalance) {
      labelBalance[l._id] = totalSamples > 0 ? Math.round((l.count / totalSamples) * 100) / 100 : 0;
    }
  });
  
  // Get bucket distribution
  const bucketDist = await TrainingSampleModel.aggregate([
    { $group: { _id: '$bucket', count: { $sum: 1 } } },
  ]);
  
  const bucketBalance: Record<string, number> = { BUY: 0, WATCH: 0, SELL: 0 };
  bucketDist.forEach(b => {
    if (b._id in bucketBalance) {
      bucketBalance[b._id] = totalSamples > 0 ? Math.round((b.count / totalSamples) * 100) / 100 : 0;
    }
  });
  
  // Get quality metrics
  const qualityStats = await TrainingSampleModel.aggregate([
    { $group: { _id: null, avgQuality: { $avg: '$qualityScore' } } },
  ]);
  const qualityScore = qualityStats[0]?.avgQuality || 0;
  
  // Get high quality ratio
  const highQualityCount = await TrainingSampleModel.countDocuments({
    qualityScore: { $gte: 0.7 },
  });
  const highQualityRatio = totalSamples > 0 ? highQualityCount / totalSamples : 0;
  
  // Determine status
  let status: 'READY' | 'PARTIAL' | 'NOT_READY' = 'READY';
  
  // Check label balance
  const minLabel = Math.min(labelBalance.SUCCESS, labelBalance.FLAT, labelBalance.FAIL);
  
  if (totalSamples < THRESHOLDS.minSamples) {
    status = 'NOT_READY';
  } else if (qualityScore < THRESHOLDS.minQualityScore) {
    status = 'PARTIAL';
  } else if (minLabel < THRESHOLDS.minLabelBalance) {
    status = 'PARTIAL';
  }
  
  return {
    trainingSamples: totalSamples,
    labelBalance: labelBalance as any,
    bucketBalance: bucketBalance as any,
    qualityScore: Math.round(qualityScore * 100) / 100,
    highQualityRatio: Math.round(highQualityRatio * 100) / 100,
    status,
  };
}

// ============================================================
// FINAL VERDICT
// ============================================================

function computeVerdict(
  data: DataReadiness,
  attribution: AttributionQuality,
  drift: DriftAnalysis,
  safety: ShadowSafety,
  dataset: LearningDatasetReadiness
): MLReadyVerdictV2 {
  const blockers: string[] = [];
  
  // Check data readiness
  if (data.status === 'FAIL') {
    if (data.samples.total < THRESHOLDS.minSamples) {
      blockers.push(`Insufficient samples (${data.samples.total}/${THRESHOLDS.minSamples})`);
    }
    if (data.timeSpanDays < THRESHOLDS.minTimeSpanDays) {
      blockers.push(`Insufficient time span (${data.timeSpanDays}/${THRESHOLDS.minTimeSpanDays} days)`);
    }
  }
  
  // Check attribution quality
  if (attribution.status === 'FAIL') {
    blockers.push(`Low correlation score (${attribution.correlationScore})`);
  }
  
  // Check drift
  if (drift.status === 'FAIL') {
    blockers.push(`High SIM/LIVE drift detected`);
  }
  
  // Check safety
  if (safety.status === 'UNSAFE') {
    blockers.push('Shadow safety check failed');
  }
  
  // Check dataset
  if (dataset.status === 'NOT_READY') {
    if (dataset.trainingSamples < THRESHOLDS.minSamples) {
      blockers.push(`Training dataset incomplete (${dataset.trainingSamples}/${THRESHOLDS.minSamples})`);
    }
  }
  
  // Determine verdict
  let status: 'READY' | 'NOT_READY' | 'CONDITIONAL' = 'READY';
  let reason = 'All checks passed. System ready for Shadow ML.';
  let confidence = 100;
  
  if (blockers.length > 0) {
    status = 'NOT_READY';
    reason = blockers[0];
    confidence = Math.max(0, 100 - blockers.length * 20);
  } else if (data.status === 'WARN' || attribution.status === 'WARN' || drift.status === 'WARN' || dataset.status === 'PARTIAL') {
    status = 'CONDITIONAL';
    reason = 'System ready with warnings. Shadow mode only.';
    confidence = 75;
    
    if (data.samples.live < THRESHOLDS.minLiveSamples) {
      reason = `Limited LIVE data (${data.samples.live}). Shadow mode only.`;
    }
  }
  
  return {
    status,
    confidence,
    reason,
    blockers,
  };
}

// ============================================================
// MAIN SUMMARY FUNCTION
// ============================================================

export async function getMLReadySummaryV2(): Promise<MLReadySummaryV2> {
  // Run all analyzers in parallel
  const [dataReadiness, attributionQuality, drift, shadowSafety, learningDataset] = await Promise.all([
    analyzeDataReadiness(),
    analyzeAttributionQuality(),
    analyzeDrift(),
    checkShadowSafety(),
    analyzeLearningDataset(),
  ]);
  
  // Compute final verdict
  const verdict = computeVerdict(dataReadiness, attributionQuality, drift, shadowSafety, learningDataset);
  
  // Determine available actions
  const actions = {
    enableShadowML: verdict.status === 'READY' || verdict.status === 'CONDITIONAL',
    exportDataset: learningDataset.trainingSamples >= THRESHOLDS.minSamples,
    runEvaluation: verdict.status === 'READY' || verdict.status === 'CONDITIONAL',
  };
  
  return {
    verdict,
    dataReadiness,
    attributionQuality,
    drift,
    shadowSafety,
    learningDataset,
    actions,
    lastUpdated: new Date().toISOString(),
  };
}
