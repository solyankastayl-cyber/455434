/**
 * Drift Detection Service - ML v2.1 STEP 2
 * 
 * Detects model degradation by comparing accuracy windows.
 */

import { AccuracySnapshotModel, IAccuracySnapshot } from './accuracy_snapshot.model.js';
import { 
  DriftEventModel, 
  IDriftEvent,
  DriftSeverity,
  DriftAction 
} from './drift_event.model.js';

// ============================================
// CONFIG - DRIFT THRESHOLDS
// ============================================

const DRIFT_THRESHOLDS = {
  LOW: -0.05,      // -5% accuracy drop
  MEDIUM: -0.10,   // -10% accuracy drop
  HIGH: -0.20,     // -20% accuracy drop
};

const ACTIONS: Record<DriftSeverity, DriftAction> = {
  LOW: 'NONE',
  MEDIUM: 'RETRAIN',
  HIGH: 'DISABLE',
};

// ============================================
// SERVICE
// ============================================

/**
 * Determine drift severity based on delta
 */
function getSeverity(delta: number): DriftSeverity {
  if (delta <= DRIFT_THRESHOLDS.HIGH) return 'HIGH';
  if (delta <= DRIFT_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (delta <= DRIFT_THRESHOLDS.LOW) return 'LOW';
  return 'LOW';
}

/**
 * Detect drift between two snapshots
 */
export async function detectDrift(
  current: IAccuracySnapshot,
  baseline: IAccuracySnapshot
): Promise<IDriftEvent | null> {
  if (!current || !baseline) return null;
  
  // Must have enough samples
  if (current.total < 10 || baseline.total < 10) {
    return null;
  }
  
  const delta = current.accuracy - baseline.accuracy;
  
  // No significant drift
  if (delta > DRIFT_THRESHOLDS.LOW) {
    return null;
  }
  
  const severity = getSeverity(delta);
  const actionSuggested = ACTIONS[severity];
  
  // Check if we already logged this drift recently (within 12 hours)
  const recentDrift = await DriftEventModel.findOne({
    network: current.network,
    modelVersion: current.modelVersion,
    severity,
    createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
  });
  
  if (recentDrift) {
    return null; // Don't duplicate
  }
  
  // Create drift event
  const event = new DriftEventModel({
    modelVersion: current.modelVersion,
    network: current.network,
    horizon: current.horizon,
    metric: 'accuracy',
    baselineWindow: baseline.window,
    currentWindow: current.window,
    baselineValue: baseline.accuracy,
    currentValue: current.accuracy,
    delta,
    severity,
    actionSuggested,
  });
  
  await event.save();
  
  console.log(`[Drift] DETECTED: ${current.network} ${severity} (Δ${(delta * 100).toFixed(1)}%)`);
  
  return event;
}

/**
 * Run drift detection for a network
 */
export async function runDriftDetection(
  network: string
): Promise<IDriftEvent | null> {
  try {
    // Get 1d snapshot (current)
    const current = await AccuracySnapshotModel.findOne({
      network,
      window: '1d',
    }).sort({ createdAt: -1 });
    
    // Get 7d snapshot (baseline)
    const baseline = await AccuracySnapshotModel.findOne({
      network,
      window: '7d',
    }).sort({ createdAt: -1 });
    
    if (!current || !baseline) {
      return null;
    }
    
    return detectDrift(current, baseline);
  } catch (err: any) {
    console.error(`[Drift] Detection failed for ${network}:`, err.message);
    return null;
  }
}

/**
 * Run drift detection for all networks
 */
export async function runAllDriftDetection(): Promise<{
  checked: number;
  drifts: number;
}> {
  const networks = await AccuracySnapshotModel.distinct('network');
  let drifts = 0;
  
  for (const network of networks) {
    const event = await runDriftDetection(network);
    if (event) drifts++;
  }
  
  return { checked: networks.length, drifts };
}

/**
 * Get recent drift events
 */
export async function getRecentDrifts(
  limit: number = 20,
  acknowledgedOnly: boolean = false
): Promise<IDriftEvent[]> {
  const query: any = {};
  if (!acknowledgedOnly) {
    query.acknowledged = false;
  }
  
  return DriftEventModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Acknowledge a drift event
 */
export async function acknowledgeDrift(
  eventId: string,
  acknowledgedBy: string,
  actionTaken: DriftAction = 'NONE'
): Promise<IDriftEvent | null> {
  return DriftEventModel.findByIdAndUpdate(
    eventId,
    {
      acknowledged: true,
      acknowledgedBy,
      acknowledgedAt: new Date(),
      actionTaken,
    },
    { new: true }
  );
}

/**
 * Get drift summary
 */
export async function getDriftSummary(): Promise<{
  total: number;
  unacknowledged: number;
  bySeverity: Record<DriftSeverity, number>;
}> {
  const all = await DriftEventModel.aggregate([
    {
      $group: {
        _id: { severity: '$severity', acknowledged: '$acknowledged' },
        count: { $sum: 1 },
      },
    },
  ]);
  
  const bySeverity: Record<DriftSeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  let total = 0;
  let unacknowledged = 0;
  
  all.forEach((r: any) => {
    total += r.count;
    bySeverity[r._id.severity as DriftSeverity] = 
      (bySeverity[r._id.severity as DriftSeverity] || 0) + r.count;
    if (!r._id.acknowledged) {
      unacknowledged += r.count;
    }
  });
  
  return { total, unacknowledged, bySeverity };
}

export default {
  detectDrift,
  runDriftDetection,
  runAllDriftDetection,
  getRecentDrifts,
  acknowledgeDrift,
  getDriftSummary,
};
