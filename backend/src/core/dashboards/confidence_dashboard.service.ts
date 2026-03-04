/**
 * P2.A — Confidence Dashboard Service
 * 
 * MongoDB aggregations for confidence quality metrics.
 */

import { D1SignalModel } from '../d1_signals/d1_signal.model.js';
import type {
  ConfidenceDashboardDTO,
  ConfidenceHistogramRow,
  LifecycleRow,
  ActorScatterPoint,
  DriftRow,
  ActorTypeRow,
  ConfidenceBucket,
} from './confidence_dashboard.types.js';

interface BuildParams {
  days: number;
  limit: number;
}

/**
 * Build confidence dashboard data from signals
 */
export async function buildConfidenceDashboard(params: BuildParams): Promise<ConfidenceDashboardDTO> {
  const { days, limit } = params;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  // 1) Histogram - confidence score distribution
  const histogramAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since }, confidenceScore: { $type: 'number' } } },
    {
      $addFields: {
        _bucket: {
          $switch: {
            branches: [
              { case: { $lte: ['$confidenceScore', 40] }, then: '0-40' },
              { case: { $lte: ['$confidenceScore', 60] }, then: '41-60' },
              { case: { $lte: ['$confidenceScore', 79] }, then: '61-79' },
              { case: { $lte: ['$confidenceScore', 90] }, then: '80-90' },
            ],
            default: '91-100',
          },
        },
      },
    },
    { $group: { _id: '$_bucket', count: { $sum: 1 } } },
    { $project: { _id: 0, bucket: '$_id', count: 1 } },
  ]);

  // Normalize missing buckets
  const buckets: ConfidenceBucket[] = ['0-40', '41-60', '61-79', '80-90', '91-100'];
  const histogramMap = new Map(histogramAgg.map((r: any) => [r.bucket, r.count]));
  const histogram: ConfidenceHistogramRow[] = buckets.map((b) => ({
    bucket: b,
    count: (histogramMap.get(b) ?? 0) as number,
  }));

  // 2) Lifecycle funnel - status distribution
  const lifecycleAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $addFields: {
        normalizedStatus: {
          $switch: {
            branches: [
              { case: { $eq: ['$lifecycleStatus', 'NEW'] }, then: 'NEW' },
              { case: { $eq: ['$lifecycleStatus', 'ACTIVE'] }, then: 'ACTIVE' },
              { case: { $eq: ['$lifecycleStatus', 'COOLDOWN'] }, then: 'COOLDOWN' },
              { case: { $eq: ['$lifecycleStatus', 'RESOLVED'] }, then: 'RESOLVED' },
              // Legacy status mapping
              { case: { $eq: ['$status', 'new'] }, then: 'NEW' },
              { case: { $eq: ['$status', 'active'] }, then: 'ACTIVE' },
              { case: { $eq: ['$status', 'cooling'] }, then: 'COOLDOWN' },
              { case: { $eq: ['$status', 'archived'] }, then: 'RESOLVED' },
            ],
            default: 'NEW',
          },
        },
      },
    },
    {
      $group: {
        _id: '$normalizedStatus',
        count: { $sum: 1 },
        avgConfidence: { $avg: '$confidenceScore' },
      },
    },
    { 
      $project: { 
        _id: 0, 
        status: '$_id', 
        count: 1, 
        avgConfidence: { $round: [{ $ifNull: ['$avgConfidence', 0] }, 1] } 
      } 
    },
  ]);

  const lifecycle: LifecycleRow[] = lifecycleAgg as LifecycleRow[];

  // 3) Scatter sample - actorCount vs confidence
  const scatterAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since }, confidenceScore: { $type: 'number' } } },
    {
      $addFields: {
        actorCount: {
          $cond: [
            { $isArray: '$confidenceTrace.penalties' },
            { $size: { $ifNull: ['$confidenceTrace.penalties', []] } },
            { $cond: [{ $gt: ['$confidenceBreakdown.actors', 50] }, 2, 1] }
          ],
        },
        // Calculate diversity from actor breakdown
        diversityIndex: {
          $cond: [
            { $gt: ['$confidenceBreakdown.actors', 0] },
            { $divide: ['$confidenceBreakdown.actors', 100] },
            0,
          ],
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        signalId: '$id',
        confidence: '$confidenceScore',
        actorCount: 1,
        diversityIndex: { $round: ['$diversityIndex', 3] },
        status: { $ifNull: ['$lifecycleStatus', '$status'] },
      },
    },
  ]);

  const scatterSample: ActorScatterPoint[] = scatterAgg as ActorScatterPoint[];

  // 4) Drift timeline - daily confidence trend
  const driftAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since }, confidenceScore: { $type: 'number' } } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      },
    },
    {
      $group: {
        _id: '$day',
        count: { $sum: 1 },
        avgConfidence: { $avg: '$confidenceScore' },
      },
    },
    { $sort: { _id: 1 } },
    { 
      $project: { 
        _id: 0, 
        day: '$_id', 
        count: 1, 
        avgConfidence: { $round: ['$avgConfidence', 1] } 
      } 
    },
  ]);

  const drift: DriftRow[] = driftAgg as DriftRow[];

  // 5) Actor types distribution (from signal types for now)
  const actorTypesAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, actorType: '$_id', count: 1 } },
  ]);

  const actorTypes: ActorTypeRow[] = actorTypesAgg as ActorTypeRow[];

  // 6) Summary stats
  const summaryAgg = await D1SignalModel.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalSignals: { $sum: 1 },
        avgConfidence: { $avg: '$confidenceScore' },
        highConfidenceCount: {
          $sum: { $cond: [{ $gte: ['$confidenceScore', 80] }, 1, 0] },
        },
        resolvedCount: {
          $sum: {
            $cond: [
              { $or: [
                { $eq: ['$lifecycleStatus', 'RESOLVED'] },
                { $eq: ['$status', 'archived'] }
              ]},
              1,
              0
            ],
          },
        },
      },
    },
  ]);

  const summary = summaryAgg[0] || {
    totalSignals: 0,
    avgConfidence: 0,
    highConfidenceCount: 0,
    resolvedCount: 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    histogram,
    lifecycle,
    scatterSample,
    drift,
    actorTypes,
    summary: {
      totalSignals: summary.totalSignals,
      avgConfidence: Math.round((summary.avgConfidence || 0) * 10) / 10,
      highConfidenceCount: summary.highConfidenceCount,
      resolvedCount: summary.resolvedCount,
    },
  };
}
