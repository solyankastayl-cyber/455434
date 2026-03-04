/**
 * Attribution Dashboard Service (Block F3.5)
 * 
 * Provides aggregated analytics for the Attribution Dashboard:
 * - Signal effectiveness metrics
 * - Confidence calibration analysis
 * - Bucket performance over time
 * - Top/bottom performing signals
 * - ML READY checklist verification
 */
import { OutcomeAttributionModel } from './outcome_attribution.model.js';
import { OutcomeSnapshotModel } from './outcome_snapshot.model.js';
import { OutcomeLabelModel } from './outcome_label.model.js';
import { OutcomeResultModel } from './outcome_result.model.js';
import { TrainingSampleModel } from '../ml/training_sample.model.js';

// ============================================================
// SIGNAL EFFECTIVENESS ANALYSIS
// ============================================================

export interface SignalEffectiveness {
  signal: string;
  totalOccurrences: number;
  successCount: number;
  failCount: number;
  flatCount: number;
  successRate: number;
  avgContribution: number;
  reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
}

/**
 * Get signal effectiveness metrics
 * Answers: "Which signals predict success?"
 */
export async function getSignalEffectiveness(
  windowDays = 30
): Promise<SignalEffectiveness[]> {
  const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  // Aggregate attributions by signal
  const attributions = await OutcomeAttributionModel.find({
    createdAt: { $gte: cutoffDate },
  }).lean();
  
  // Build signal statistics
  const signalStats: Record<string, {
    total: number;
    success: number;
    fail: number;
    flat: number;
    contributions: number[];
  }> = {};
  
  for (const attr of attributions) {
    // Process dominant signals (contributed to decision)
    for (const signal of attr.dominantSignals || []) {
      if (!signalStats[signal]) {
        signalStats[signal] = { total: 0, success: 0, fail: 0, flat: 0, contributions: [] };
      }
      signalStats[signal].total++;
      
      if (attr.outcome === 'SUCCESS') signalStats[signal].success++;
      else if (attr.outcome === 'FAIL') signalStats[signal].fail++;
      else signalStats[signal].flat++;
      
      const contrib = attr.signalContributions?.[signal] || 0;
      signalStats[signal].contributions.push(contrib);
    }
    
    // Process misleading signals (negative contribution)
    for (const signal of attr.misleadingSignals || []) {
      if (!signalStats[signal]) {
        signalStats[signal] = { total: 0, success: 0, fail: 0, flat: 0, contributions: [] };
      }
      // For misleading signals, outcomes are inverted (misleading in FAIL = did harm)
      signalStats[signal].total++;
      
      if (attr.outcome === 'FAIL') signalStats[signal].fail++;
      else if (attr.outcome === 'SUCCESS') signalStats[signal].success++;
      else signalStats[signal].flat++;
      
      const contrib = attr.signalContributions?.[signal] || 0;
      signalStats[signal].contributions.push(contrib);
    }
  }
  
  // Convert to effectiveness metrics
  const effectiveness: SignalEffectiveness[] = [];
  
  for (const [signal, stats] of Object.entries(signalStats)) {
    const successRate = stats.total > 0 
      ? (stats.success / stats.total) * 100 
      : 0;
    
    const avgContribution = stats.contributions.length > 0
      ? stats.contributions.reduce((a, b) => a + b, 0) / stats.contributions.length
      : 0;
    
    // Determine reliability
    let reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' = 'UNKNOWN';
    if (stats.total >= 20) {
      if (successRate >= 65) reliability = 'HIGH';
      else if (successRate >= 45) reliability = 'MEDIUM';
      else reliability = 'LOW';
    } else if (stats.total >= 5) {
      reliability = 'MEDIUM';
    }
    
    effectiveness.push({
      signal,
      totalOccurrences: stats.total,
      successCount: stats.success,
      failCount: stats.fail,
      flatCount: stats.flat,
      successRate: Math.round(successRate * 10) / 10,
      avgContribution: Math.round(avgContribution * 100) / 100,
      reliability,
    });
  }
  
  // Sort by total occurrences
  return effectiveness.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
}

// ============================================================
// CONFIDENCE CALIBRATION ANALYSIS
// ============================================================

export interface ConfidenceCalibration {
  bucket: string;
  confidenceRange: string;
  totalDecisions: number;
  successCount: number;
  actualSuccessRate: number;
  expectedSuccessRate: number;
  calibrationError: number;
  isOverconfident: boolean;
  isUnderconfident: boolean;
}

/**
 * Analyze confidence calibration
 * Answers: "Is our confidence score accurate?"
 */
export async function getConfidenceCalibration(
  windowDays = 30
): Promise<ConfidenceCalibration[]> {
  const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  // Get snapshots with their labels
  const snapshots = await OutcomeSnapshotModel.find({
    decidedAt: { $gte: cutoffDate },
  }).lean();
  
  const labels = await OutcomeLabelModel.find({
    createdAt: { $gte: cutoffDate },
  }).lean();
  
  // Map snapshot IDs to labels
  const labelMap = new Map(
    labels.map(l => [l.snapshotId.toString(), l])
  );
  
  // Define confidence ranges
  const ranges = [
    { min: 0, max: 30, label: '0-30%', expected: 15 },
    { min: 30, max: 50, label: '30-50%', expected: 40 },
    { min: 50, max: 70, label: '50-70%', expected: 60 },
    { min: 70, max: 100, label: '70-100%', expected: 85 },
  ];
  
  // Aggregate by bucket and confidence range
  const calibrationData: Record<string, {
    total: number;
    success: number;
  }> = {};
  
  for (const snapshot of snapshots) {
    const label = labelMap.get(snapshot._id.toString());
    if (!label) continue;
    
    const range = ranges.find(r => 
      snapshot.confidence >= r.min && snapshot.confidence < r.max
    );
    if (!range) continue;
    
    const key = `${snapshot.bucket}_${range.label}`;
    if (!calibrationData[key]) {
      calibrationData[key] = { total: 0, success: 0 };
    }
    
    calibrationData[key].total++;
    if (label.outcome === 'SUCCESS') {
      calibrationData[key].success++;
    }
  }
  
  // Build calibration metrics
  const calibration: ConfidenceCalibration[] = [];
  
  for (const bucket of ['BUY', 'WATCH', 'SELL']) {
    for (const range of ranges) {
      const key = `${bucket}_${range.label}`;
      const data = calibrationData[key] || { total: 0, success: 0 };
      
      const actualRate = data.total > 0 
        ? (data.success / data.total) * 100 
        : 0;
      
      const error = Math.abs(actualRate - range.expected);
      
      calibration.push({
        bucket,
        confidenceRange: range.label,
        totalDecisions: data.total,
        successCount: data.success,
        actualSuccessRate: Math.round(actualRate * 10) / 10,
        expectedSuccessRate: range.expected,
        calibrationError: Math.round(error * 10) / 10,
        isOverconfident: actualRate < range.expected - 10,
        isUnderconfident: actualRate > range.expected + 10,
      });
    }
  }
  
  return calibration;
}

// ============================================================
// BUCKET PERFORMANCE OVER TIME
// ============================================================

export interface BucketPerformance {
  date: string;
  bucket: string;
  totalDecisions: number;
  successCount: number;
  failCount: number;
  flatCount: number;
  successRate: number;
  avgDeltaPct: number;
}

/**
 * Get bucket performance over time
 * Answers: "How are our buckets performing daily?"
 */
export async function getBucketPerformanceTimeline(
  windowDays = 14
): Promise<BucketPerformance[]> {
  const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  const pipeline = [
    { $match: { createdAt: { $gte: cutoffDate } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          bucket: '$bucket',
        },
        total: { $sum: 1 },
        success: {
          $sum: { $cond: [{ $eq: ['$outcome', 'SUCCESS'] }, 1, 0] },
        },
        fail: {
          $sum: { $cond: [{ $eq: ['$outcome', 'FAIL'] }, 1, 0] },
        },
        flat: {
          $sum: { $cond: [{ $eq: ['$outcome', 'FLAT'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id.date': 1, '_id.bucket': 1 } as any },
  ];
  
  const results = await OutcomeAttributionModel.aggregate(pipeline);
  
  // Get average delta from labels
  const labelPipeline = [
    { $match: { createdAt: { $gte: cutoffDate } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        },
        avgDelta: { $avg: '$deltaPct' },
      },
    },
  ];
  
  const deltaResults = await OutcomeLabelModel.aggregate(labelPipeline);
  const deltaMap = new Map(deltaResults.map(d => [d._id.date, d.avgDelta]));
  
  return results.map(r => ({
    date: r._id.date,
    bucket: r._id.bucket,
    totalDecisions: r.total,
    successCount: r.success,
    failCount: r.fail,
    flatCount: r.flat,
    successRate: r.total > 0 ? Math.round((r.success / r.total) * 1000) / 10 : 0,
    avgDeltaPct: Math.round((deltaMap.get(r._id.date) || 0) * 100) / 100,
  }));
}

// ============================================================
// ML READY CHECKLIST VERIFICATION
// ============================================================

export interface MLReadyCheck {
  name: string;
  description: string;
  required: boolean;
  passed: boolean;
  currentValue: number | string;
  threshold: number | string;
  details?: string;
}

export interface MLReadyChecklist {
  isReady: boolean;
  passedCount: number;
  totalRequired: number;
  checks: MLReadyCheck[];
  recommendation: string;
}

/**
 * Verify ML READY checklist
 * Returns detailed status of all requirements
 */
export async function verifyMLReadyChecklist(): Promise<MLReadyChecklist> {
  const checks: MLReadyCheck[] = [];
  
  // 1. Minimum samples count
  const totalSamples = await TrainingSampleModel.countDocuments();
  checks.push({
    name: 'Minimum Training Samples',
    description: 'At least 1000 high-quality training samples',
    required: true,
    passed: totalSamples >= 1000,
    currentValue: totalSamples,
    threshold: 1000,
    details: totalSamples < 1000 
      ? `Need ${1000 - totalSamples} more samples` 
      : 'Threshold met',
  });
  
  // 2. Bucket distribution balance
  // Для Shadow Mode: проверяем минимум 2 bucket с данными
  // Для Production: все 3 bucket нужны
  const bucketDist = await TrainingSampleModel.aggregate([
    { $group: { _id: '$bucket', count: { $sum: 1 } } },
  ]);
  const bucketCounts = Object.fromEntries(bucketDist.map(b => [b._id, b.count]));
  const activeBuckets = Object.values(bucketCounts).filter(c => (c as number) > 0).length;
  
  // Для shadow mode достаточно 2+ bucket с данными
  const hasMinBuckets = activeBuckets >= 2;
  const minBucketCount = Math.min(
    ...[bucketCounts['BUY'] || 0, bucketCounts['WATCH'] || 0, bucketCounts['SELL'] || 0].filter(c => c > 0)
  );
  const maxBucketCount = Math.max(
    bucketCounts['BUY'] || 0,
    bucketCounts['WATCH'] || 0,
    bucketCounts['SELL'] || 0
  );
  const imbalanceRatio = maxBucketCount > 0 && minBucketCount > 0 ? minBucketCount / maxBucketCount : 0;
  
  checks.push({
    name: 'Bucket Balance',
    description: 'At least 2 buckets with data (Shadow Mode) or balanced 3 buckets (Production)',
    required: true,
    passed: hasMinBuckets && (activeBuckets < 3 || imbalanceRatio >= 0.15),
    currentValue: `${activeBuckets}/3 buckets, ${Math.round(imbalanceRatio * 100)}% balance`,
    threshold: '2+ buckets or 15%+ balance',
    details: `BUY: ${bucketCounts['BUY'] || 0}, WATCH: ${bucketCounts['WATCH'] || 0}, SELL: ${bucketCounts['SELL'] || 0}`,
  });
  
  // 3. Outcome distribution
  const outcomeDist = await TrainingSampleModel.aggregate([
    { $group: { _id: '$outcomeLabel', count: { $sum: 1 } } },
  ]);
  const outcomeCounts = Object.fromEntries(outcomeDist.map(o => [o._id, o.count]));
  const hasAllOutcomes = (outcomeCounts['SUCCESS'] || 0) > 0 &&
                         (outcomeCounts['FAIL'] || 0) > 0 &&
                         (outcomeCounts['FLAT'] || 0) > 0;
  
  checks.push({
    name: 'Outcome Diversity',
    description: 'Must have SUCCESS, FAIL, and FLAT samples',
    required: true,
    passed: hasAllOutcomes,
    currentValue: hasAllOutcomes ? 'All present' : 'Missing outcomes',
    threshold: 'All 3 outcomes',
    details: `SUCCESS: ${outcomeCounts['SUCCESS'] || 0}, FAIL: ${outcomeCounts['FAIL'] || 0}, FLAT: ${outcomeCounts['FLAT'] || 0}`,
  });
  
  // 4. Average quality score
  const qualityResult = await TrainingSampleModel.aggregate([
    { $group: { _id: null, avgQuality: { $avg: '$qualityScore' } } },
  ]);
  const avgQuality = qualityResult[0]?.avgQuality || 0;
  
  checks.push({
    name: 'Sample Quality',
    description: 'Average quality score must be >= 0.5',
    required: true,
    passed: avgQuality >= 0.5,
    currentValue: Math.round(avgQuality * 100) / 100,
    threshold: 0.5,
  });
  
  // 5. Time span coverage
  const oldestSample = await TrainingSampleModel.findOne()
    .sort({ timestamp: 1 })
    .select('timestamp')
    .lean();
  const newestSample = await TrainingSampleModel.findOne()
    .sort({ timestamp: -1 })
    .select('timestamp')
    .lean();
  
  let timeSpanDays = 0;
  if (oldestSample && newestSample) {
    timeSpanDays = Math.floor(
      (new Date(newestSample.timestamp).getTime() - new Date(oldestSample.timestamp).getTime()) 
      / (24 * 60 * 60 * 1000)
    );
  }
  
  checks.push({
    name: 'Time Coverage',
    description: 'Data must span at least 7 days',
    required: true,
    passed: timeSpanDays >= 7,
    currentValue: `${timeSpanDays} days`,
    threshold: '7 days',
  });
  
  // 6. Signal diversity
  const signalDiversity = await TrainingSampleModel.aggregate([
    { $unwind: '$dominantSignals' },
    { $group: { _id: '$dominantSignals' } },
    { $count: 'uniqueSignals' },
  ]);
  const uniqueSignals = signalDiversity[0]?.uniqueSignals || 0;
  
  checks.push({
    name: 'Signal Diversity',
    description: 'At least 3 different dominant signals identified',
    required: false,
    passed: uniqueSignals >= 3,
    currentValue: uniqueSignals,
    threshold: 3,
  });
  
  // 7. High-quality samples ratio
  const highQualityCount = await TrainingSampleModel.countDocuments({
    qualityScore: { $gte: 0.7 },
  });
  const highQualityRatio = totalSamples > 0 ? highQualityCount / totalSamples : 0;
  
  checks.push({
    name: 'High-Quality Ratio',
    description: 'At least 30% of samples should be high-quality (>= 0.7)',
    required: false,
    passed: highQualityRatio >= 0.3,
    currentValue: `${Math.round(highQualityRatio * 100)}%`,
    threshold: '30%',
    details: `${highQualityCount} of ${totalSamples} samples are high-quality`,
  });
  
  // 8. Attribution coverage
  const attributionsCount = await OutcomeAttributionModel.countDocuments();
  const attrCoverage = totalSamples > 0 ? attributionsCount / totalSamples : 0;
  
  checks.push({
    name: 'Attribution Coverage',
    description: 'All training samples must have attribution data',
    required: true,
    passed: attrCoverage >= 0.95, // 95% threshold for data quality
    currentValue: `${Math.round(attrCoverage * 100)}%`,
    threshold: '95%',
    details: `${attributionsCount} attributions for ${totalSamples} samples`,
  });
  
  // Calculate summary
  const requiredChecks = checks.filter(c => c.required);
  const passedRequired = requiredChecks.filter(c => c.passed).length;
  const isReady = passedRequired === requiredChecks.length;
  
  // Generate recommendation
  let recommendation = '';
  if (isReady) {
    recommendation = 'All requirements met. System is ready for ML training.';
  } else {
    const failedRequired = requiredChecks.filter(c => !c.passed);
    recommendation = `Waiting for: ${failedRequired.map(c => c.name).join(', ')}. ` +
      `Continue accumulating data.`;
  }
  
  return {
    isReady,
    passedCount: passedRequired,
    totalRequired: requiredChecks.length,
    checks,
    recommendation,
  };
}

// ============================================================
// DASHBOARD SUMMARY
// ============================================================

export interface AttributionDashboardData {
  summary: {
    totalSnapshots: number;
    totalAttributions: number;
    totalSamples: number;
    overallSuccessRate: number;
    avgConfidenceDelta: number;
    dataSpanDays: number;
  };
  signalEffectiveness: SignalEffectiveness[];
  confidenceCalibration: ConfidenceCalibration[];
  bucketPerformance: BucketPerformance[];
  mlReadyChecklist: MLReadyChecklist;
  lastUpdated: string;
}

/**
 * Get complete attribution dashboard data
 */
export async function getAttributionDashboard(): Promise<AttributionDashboardData> {
  // Get counts
  const [snapshotCount, attrCount, sampleCount] = await Promise.all([
    OutcomeSnapshotModel.countDocuments(),
    OutcomeAttributionModel.countDocuments(),
    TrainingSampleModel.countDocuments(),
  ]);
  
  // Get overall success rate
  const successResult = await TrainingSampleModel.aggregate([
    { $group: { _id: null, 
      total: { $sum: 1 },
      success: { $sum: { $cond: [{ $eq: ['$outcomeLabel', 'SUCCESS'] }, 1, 0] } }
    }}
  ]);
  const overallSuccessRate = successResult[0]?.total > 0
    ? Math.round((successResult[0].success / successResult[0].total) * 1000) / 10
    : 0;
  
  // Get avg confidence delta
  const deltaResult = await OutcomeAttributionModel.aggregate([
    { $group: { _id: null, avgDelta: { $avg: '$confidenceDelta' } } }
  ]);
  const avgConfidenceDelta = Math.round((deltaResult[0]?.avgDelta || 0) * 100) / 100;
  
  // Calculate data span
  const [oldest, newest] = await Promise.all([
    OutcomeSnapshotModel.findOne().sort({ decidedAt: 1 }).select('decidedAt').lean(),
    OutcomeSnapshotModel.findOne().sort({ decidedAt: -1 }).select('decidedAt').lean(),
  ]);
  
  let dataSpanDays = 0;
  if (oldest && newest) {
    dataSpanDays = Math.floor(
      (new Date(newest.decidedAt).getTime() - new Date(oldest.decidedAt).getTime())
      / (24 * 60 * 60 * 1000)
    );
  }
  
  // Get all dashboard components
  const [signalEffectiveness, confidenceCalibration, bucketPerformance, mlReadyChecklist] = 
    await Promise.all([
      getSignalEffectiveness(30),
      getConfidenceCalibration(30),
      getBucketPerformanceTimeline(14),
      verifyMLReadyChecklist(),
    ]);
  
  return {
    summary: {
      totalSnapshots: snapshotCount,
      totalAttributions: attrCount,
      totalSamples: sampleCount,
      overallSuccessRate,
      avgConfidenceDelta,
      dataSpanDays,
    },
    signalEffectiveness,
    confidenceCalibration,
    bucketPerformance,
    mlReadyChecklist,
    lastUpdated: new Date().toISOString(),
  };
}
