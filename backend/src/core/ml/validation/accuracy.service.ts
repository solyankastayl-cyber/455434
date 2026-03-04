/**
 * Accuracy Service - ML v2.1 STEP 2
 * 
 * Computes and stores accuracy snapshots.
 */

import { SignalOutcomeModel } from './signal_outcome.model.js';
import { 
  AccuracySnapshotModel, 
  IAccuracySnapshot,
  Window 
} from './accuracy_snapshot.model.js';

// ============================================
// CONFIG
// ============================================

const WINDOW_DAYS: Record<Window, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '14d': 14,
};

// ============================================
// SERVICE
// ============================================

/**
 * Compute accuracy snapshot for a specific configuration
 */
export async function computeAccuracySnapshot(
  network: string,
  modelVersion: string = 'v2.0.0',
  horizon: '1h' | '4h' | '24h' = '4h',
  window: Window = '7d'
): Promise<IAccuracySnapshot | null> {
  try {
    const days = WINDOW_DAYS[window];
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // Aggregate outcomes
    const results = await SignalOutcomeModel.aggregate([
      {
        $match: {
          network,
          horizon,
          createdAt: { $gte: periodStart, $lte: periodEnd },
          ...(modelVersion !== 'ALL' && { modelVersion }),
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          correct: { 
            $sum: { $cond: [{ $eq: ['$outcome', 'CORRECT'] }, 1, 0] } 
          },
          wrong: { 
            $sum: { $cond: [{ $eq: ['$outcome', 'WRONG'] }, 1, 0] } 
          },
          neutral: { 
            $sum: { $cond: [{ $eq: ['$outcome', 'NEUTRAL'] }, 1, 0] } 
          },
          skipped: { 
            $sum: { $cond: [{ $eq: ['$outcome', 'SKIPPED'] }, 1, 0] } 
          },
          avgConfidence: { $avg: '$confidence' },
          sumConfidenceCorrect: {
            $sum: { 
              $cond: [
                { $eq: ['$outcome', 'CORRECT'] }, 
                '$confidence', 
                0
              ] 
            }
          },
        },
      },
    ]);
    
    if (results.length === 0) {
      return null;
    }
    
    const r = results[0];
    const evaluated = r.correct + r.wrong;
    const accuracy = evaluated > 0 ? r.correct / evaluated : 0;
    
    // Confidence weighted accuracy
    const cwAccuracy = evaluated > 0 
      ? r.sumConfidenceCorrect / (evaluated * (r.avgConfidence || 1))
      : 0;
    
    // Create snapshot
    const snapshot = new AccuracySnapshotModel({
      modelVersion,
      network,
      horizon,
      window,
      total: r.total,
      correct: r.correct,
      wrong: r.wrong,
      neutral: r.neutral,
      skipped: r.skipped,
      accuracy,
      confidenceWeightedAccuracy: cwAccuracy,
      avgConfidence: r.avgConfidence || 0,
      periodStart,
      periodEnd,
    });
    
    await snapshot.save();
    
    console.log(`[Accuracy] Snapshot created: ${network}/${window} = ${(accuracy * 100).toFixed(1)}%`);
    
    return snapshot;
  } catch (err: any) {
    console.error(`[Accuracy] Snapshot computation failed:`, err.message);
    return null;
  }
}

/**
 * Get accuracy history for a network
 */
export async function getAccuracyHistory(
  network: string,
  window: Window = '7d',
  limit: number = 30
): Promise<IAccuracySnapshot[]> {
  return AccuracySnapshotModel.find({ network, window })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get latest snapshot for each network
 */
export async function getLatestSnapshots(
  window: Window = '7d'
): Promise<IAccuracySnapshot[]> {
  const snapshots = await AccuracySnapshotModel.aggregate([
    { $match: { window } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$network',
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { total: -1 } },
  ]);
  
  return snapshots;
}

/**
 * Compute snapshots for all networks
 */
export async function computeAllSnapshots(
  windows: Window[] = ['1d', '7d']
): Promise<{ computed: number }> {
  const networks = await SignalOutcomeModel.distinct('network');
  let computed = 0;
  
  for (const network of networks) {
    for (const window of windows) {
      const snapshot = await computeAccuracySnapshot(network, 'ALL', '4h', window);
      if (snapshot) computed++;
    }
  }
  
  return { computed };
}

export default {
  computeAccuracySnapshot,
  getAccuracyHistory,
  getLatestSnapshots,
  computeAllSnapshots,
};
