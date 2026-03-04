/**
 * Dataset Quality Service
 * 
 * ETAP 3.4: Analytics and quality checks for the training dataset.
 * 
 * Provides:
 * - Coverage metrics
 * - Class imbalance detection
 * - Leakage guards
 * - Distribution analysis
 */
import { LearningSampleModel } from './learning_sample.model.js';
import type { Horizon } from '../learning.types.js';
import type { TrendLabel } from '../types/trend.types.js';
import type { Verdict } from '../types/attribution.types.js';

// ==================== TYPES ====================

export interface DatasetStats {
  total: number;
  trainEligible: number;
  trainIneligible: number;
  
  // Coverage
  byLiveCoverage: {
    FULL: number;
    PARTIAL: number;
    NONE: number;
  };
  
  // Distribution by bucket
  byBucket: {
    BUY: number;
    WATCH: number;
    SELL: number;
  };
  
  // Distribution by verdict (7d)
  byVerdict: Record<Verdict | 'null', number>;
  
  // Distribution by trend (7d)
  byTrend: Record<TrendLabel | 'null', number>;
  
  // Class imbalance metrics
  imbalance: {
    bucketImbalanceRatio: number;  // max/min bucket ratio
    verdictImbalanceRatio: number;
    trendImbalanceRatio: number;
  };
  
  // Quality metrics
  avgDataCompleteness: number;
  avgTrendCoverage: number;
  avgVerdictCoverage: number;
  
  // Schema version distribution
  bySchemaVersion: Record<string, number>;
}

export interface QualityAlert {
  type: 'warning' | 'error';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

// ==================== THRESHOLDS ====================

const QUALITY_THRESHOLDS = {
  minSamples: 100,
  maxImbalanceRatio: 10,
  minDataCompleteness: 0.5,
  minLiveCoverage: 0.3,
};

// ==================== FUNCTIONS ====================

/**
 * Get comprehensive dataset statistics
 */
export async function getDatasetStats(): Promise<DatasetStats> {
  const [
    total,
    trainEligible,
    liveCoverageCounts,
    bucketCounts,
    verdictCounts,
    trendCounts,
    avgMetrics,
    schemaCounts,
  ] = await Promise.all([
    LearningSampleModel.countDocuments(),
    LearningSampleModel.countDocuments({ 'quality.trainEligible': true }),
    LearningSampleModel.aggregate([
      { $group: { _id: '$features.live.liveCoverage', count: { $sum: 1 } } },
    ]),
    LearningSampleModel.aggregate([
      { $group: { _id: '$features.snapshot.bucket', count: { $sum: 1 } } },
    ]),
    LearningSampleModel.aggregate([
      { $group: { _id: '$labels.verdicts.verdict_7d', count: { $sum: 1 } } },
    ]),
    LearningSampleModel.aggregate([
      { $group: { _id: '$labels.trends.trend_7d', count: { $sum: 1 } } },
    ]),
    LearningSampleModel.aggregate([
      {
        $group: {
          _id: null,
          avgDataCompleteness: { $avg: '$quality.dataCompleteness' },
          avgTrendCoverage: { $avg: '$quality.trendCoverage' },
          avgVerdictCoverage: { $avg: '$quality.verdictCoverage' },
        },
      },
    ]),
    LearningSampleModel.aggregate([
      { $group: { _id: '$schemaVersion', count: { $sum: 1 } } },
    ]),
  ]);
  
  // Build distribution maps
  const byLiveCoverage = { FULL: 0, PARTIAL: 0, NONE: 0 };
  liveCoverageCounts.forEach(c => {
    if (c._id in byLiveCoverage) {
      byLiveCoverage[c._id as keyof typeof byLiveCoverage] = c.count;
    }
  });
  
  const byBucket = { BUY: 0, WATCH: 0, SELL: 0 };
  bucketCounts.forEach(c => {
    if (c._id in byBucket) {
      byBucket[c._id as keyof typeof byBucket] = c.count;
    }
  });
  
  const byVerdict: Record<Verdict | 'null', number> = {
    TRUE_POSITIVE: 0,
    FALSE_POSITIVE: 0,
    TRUE_NEGATIVE: 0,
    FALSE_NEGATIVE: 0,
    MISSED: 0,
    DELAYED_TRUE: 0,
    'null': 0,
  };
  verdictCounts.forEach(c => {
    const key = c._id === null ? 'null' : c._id;
    if (key in byVerdict) {
      byVerdict[key as keyof typeof byVerdict] = c.count;
    }
  });
  
  const byTrend: Record<TrendLabel | 'null', number> = {
    NOISE: 0,
    SIDEWAYS: 0,
    TREND_UP: 0,
    TREND_DOWN: 0,
    'null': 0,
  };
  trendCounts.forEach(c => {
    const key = c._id === null ? 'null' : c._id;
    if (key in byTrend) {
      byTrend[key as keyof typeof byTrend] = c.count;
    }
  });
  
  const bySchemaVersion: Record<string, number> = {};
  schemaCounts.forEach(c => {
    bySchemaVersion[c._id || 'unknown'] = c.count;
  });
  
  // Calculate imbalance ratios
  const bucketValues = Object.values(byBucket).filter(v => v > 0);
  const verdictValues = Object.values(byVerdict).filter(v => v > 0);
  const trendValues = Object.values(byTrend).filter(v => v > 0);
  
  const bucketImbalanceRatio = bucketValues.length > 1
    ? Math.max(...bucketValues) / Math.min(...bucketValues)
    : 1;
  const verdictImbalanceRatio = verdictValues.length > 1
    ? Math.max(...verdictValues) / Math.min(...verdictValues)
    : 1;
  const trendImbalanceRatio = trendValues.length > 1
    ? Math.max(...trendValues) / Math.min(...trendValues)
    : 1;
  
  const metrics = avgMetrics[0] || {};
  
  return {
    total,
    trainEligible,
    trainIneligible: total - trainEligible,
    byLiveCoverage,
    byBucket,
    byVerdict,
    byTrend,
    imbalance: {
      bucketImbalanceRatio: Math.round(bucketImbalanceRatio * 100) / 100,
      verdictImbalanceRatio: Math.round(verdictImbalanceRatio * 100) / 100,
      trendImbalanceRatio: Math.round(trendImbalanceRatio * 100) / 100,
    },
    avgDataCompleteness: Math.round((metrics.avgDataCompleteness || 0) * 100) / 100,
    avgTrendCoverage: Math.round((metrics.avgTrendCoverage || 0) * 100) / 100,
    avgVerdictCoverage: Math.round((metrics.avgVerdictCoverage || 0) * 100) / 100,
    bySchemaVersion,
  };
}

/**
 * Check quality and return alerts
 */
export async function checkDatasetQuality(): Promise<QualityAlert[]> {
  const stats = await getDatasetStats();
  const alerts: QualityAlert[] = [];
  
  // Check sample count
  if (stats.total < QUALITY_THRESHOLDS.minSamples) {
    alerts.push({
      type: 'warning',
      message: `Dataset has only ${stats.total} samples, minimum recommended is ${QUALITY_THRESHOLDS.minSamples}`,
      metric: 'total_samples',
      value: stats.total,
      threshold: QUALITY_THRESHOLDS.minSamples,
    });
  }
  
  // Check bucket imbalance
  if (stats.imbalance.bucketImbalanceRatio > QUALITY_THRESHOLDS.maxImbalanceRatio) {
    alerts.push({
      type: 'warning',
      message: `Bucket class imbalance is ${stats.imbalance.bucketImbalanceRatio}:1, consider balancing`,
      metric: 'bucket_imbalance',
      value: stats.imbalance.bucketImbalanceRatio,
      threshold: QUALITY_THRESHOLDS.maxImbalanceRatio,
    });
  }
  
  // Check verdict imbalance
  if (stats.imbalance.verdictImbalanceRatio > QUALITY_THRESHOLDS.maxImbalanceRatio) {
    alerts.push({
      type: 'warning',
      message: `Verdict class imbalance is ${stats.imbalance.verdictImbalanceRatio}:1`,
      metric: 'verdict_imbalance',
      value: stats.imbalance.verdictImbalanceRatio,
      threshold: QUALITY_THRESHOLDS.maxImbalanceRatio,
    });
  }
  
  // Check data completeness
  if (stats.avgDataCompleteness < QUALITY_THRESHOLDS.minDataCompleteness) {
    alerts.push({
      type: 'error',
      message: `Average data completeness is ${stats.avgDataCompleteness}, minimum is ${QUALITY_THRESHOLDS.minDataCompleteness}`,
      metric: 'data_completeness',
      value: stats.avgDataCompleteness,
      threshold: QUALITY_THRESHOLDS.minDataCompleteness,
    });
  }
  
  // Check LIVE coverage
  const liveRatio = (stats.byLiveCoverage.FULL + stats.byLiveCoverage.PARTIAL) / 
                    Math.max(1, stats.total);
  if (liveRatio < QUALITY_THRESHOLDS.minLiveCoverage) {
    alerts.push({
      type: 'warning',
      message: `Only ${Math.round(liveRatio * 100)}% samples have LIVE data`,
      metric: 'live_coverage',
      value: liveRatio,
      threshold: QUALITY_THRESHOLDS.minLiveCoverage,
    });
  }
  
  return alerts;
}

/**
 * Get skip reason distribution from recent builds
 */
export async function getSkipReasonStats(): Promise<Record<string, number>> {
  const samples = await LearningSampleModel.aggregate([
    { $match: { 'quality.trainEligible': false } },
    { $unwind: '$quality.reasons' },
    { $group: { _id: '$quality.reasons', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  
  const result: Record<string, number> = {};
  samples.forEach(s => {
    result[s._id] = s.count;
  });
  
  return result;
}
