/**
 * Outcome Tracker Service (Block F - F1 + F2)
 * 
 * Отслеживает результаты решений через временные окна
 * Создает Results (F1) и Labels (F2)
 */
import { OutcomeResultModel } from './outcome_result.model.js';
import { OutcomeLabelModel, OutcomeType } from './outcome_label.model.js';
import { 
  getSnapshotsForTracking, 
  markSnapshotTracked 
} from './outcome_snapshot.service.js';
import { TokenUniverseModel } from '../token_universe/token_universe.model.js';
import { calculateAttribution } from './attribution.service.js';
import { createTrainingSample } from '../ml/dataset_builder.service.js';

/**
 * Track outcomes for specific window
 * Should be called periodically (cron job)
 * 
 * Now includes F3 (Attribution) and F4 (Training Samples)
 */
export async function trackOutcomesForWindow(
  windowHours: 24 | 72 | 168
): Promise<{
  processed: number;
  results: number;
  labels: number;
  attributions: number;
  trainingSamples: number;
}> {
  console.log(`[Outcome F1] Tracking outcomes for T+${windowHours}h window...`);
  
  // Get snapshots ready for tracking
  const snapshots = await getSnapshotsForTracking(windowHours);
  
  if (snapshots.length === 0) {
    console.log(`[Outcome F1] No snapshots to track for T+${windowHours}h`);
    return { processed: 0, results: 0, labels: 0, attributions: 0, trainingSamples: 0 };
  }
  
  console.log(`[Outcome F1] Found ${snapshots.length} snapshots to track`);
  
  let resultsCreated = 0;
  let labelsCreated = 0;
  let attributionsCreated = 0;
  let trainingSamplesCreated = 0;
  
  for (const snapshot of snapshots) {
    try {
      // Get current token data
      const token = await TokenUniverseModel.findOne({
        contractAddress: snapshot.tokenAddress,
      }).lean();
      
      if (!token) {
        console.log(`[Outcome F1] Token not found: ${snapshot.symbol}, skipping`);
        await markSnapshotTracked(snapshot._id.toString(), windowHours);
        continue;
      }
      
      // F1: Create Result
      const result = await createOutcomeResult(
        snapshot,
        token,
        windowHours
      );
      
      if (result) {
        resultsCreated++;
        
        // F2: Create Label
        const label = await createOutcomeLabel(
          snapshot,
          result
        );
        
        if (label) {
          labelsCreated++;
          
          // F3: Calculate Attribution
          try {
            const attribution = await calculateAttribution(
              snapshot._id.toString(),
              result._id.toString(),
              label._id.toString()
            );
            
            if (attribution) {
              attributionsCreated++;
              
              // F4: Create Training Sample
              try {
                const trainingSample = await createTrainingSample(
                  attribution._id.toString()
                );
                
                if (trainingSample) {
                  trainingSamplesCreated++;
                }
              } catch (error) {
                console.error(`[F4] Training sample creation failed for ${snapshot.symbol}:`, error);
              }
            }
          } catch (error) {
            console.error(`[F3] Attribution failed for ${snapshot.symbol}:`, error);
          }
        }
      }
      
      // Mark as tracked
      await markSnapshotTracked(snapshot._id.toString(), windowHours);
      
    } catch (error) {
      console.error(`[Outcome F1] Error tracking ${snapshot.symbol}:`, error);
      // Continue with next snapshot
    }
  }
  
  console.log(`[Outcome] Completed T+${windowHours}h:`);
  console.log(`  - Results: ${resultsCreated}`);
  console.log(`  - Labels: ${labelsCreated}`);
  console.log(`  - Attributions: ${attributionsCreated}`);
  console.log(`  - Training Samples: ${trainingSamplesCreated}`);
  
  return {
    processed: snapshots.length,
    results: resultsCreated,
    labels: labelsCreated,
    attributions: attributionsCreated,
    trainingSamples: trainingSamplesCreated,
  };
}

/**
 * Create outcome result (F1)
 */
async function createOutcomeResult(
  snapshot: any,
  currentToken: any,
  windowHours: number
) {
  const priceAtDecision = snapshot.priceAtDecision;
  const priceAfter = currentToken.priceUsd;
  
  if (!priceAfter || priceAfter <= 0) {
    console.log(`[Outcome F1] Invalid price for ${snapshot.symbol}`);
    return null;
  }
  
  const deltaAbs = priceAfter - priceAtDecision;
  const deltaPct = ((priceAfter - priceAtDecision) / priceAtDecision) * 100;
  
  // Simple metrics (can be enhanced later)
  const maxDrawdown = Math.min(0, deltaPct); // Simplified
  const volatility = Math.abs(deltaPct); // Simplified
  
  const marketCapChange = currentToken.marketCap && snapshot.marketCapAtDecision
    ? ((currentToken.marketCap - snapshot.marketCapAtDecision) / snapshot.marketCapAtDecision) * 100
    : 0;
  
  const volumeChange = currentToken.volume24h && snapshot.volumeAtDecision
    ? ((currentToken.volume24h - snapshot.volumeAtDecision) / snapshot.volumeAtDecision) * 100
    : 0;
  
  const result = await OutcomeResultModel.create({
    snapshotId: snapshot._id,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    bucket: snapshot.bucket,
    windowHours,
    priceAtDecision,
    priceAfter,
    deltaPct,
    deltaAbs,
    maxDrawdown,
    volatility,
    marketCapChange,
    volumeChange,
    evaluatedAt: new Date(),
    decidedAt: snapshot.decidedAt,
  });
  
  console.log(`[Outcome F1] Result created: ${snapshot.symbol} ${snapshot.bucket} → ${deltaPct.toFixed(2)}% (T+${windowHours}h)`);
  
  return result;
}

/**
 * Create outcome label (F2)
 * Applies bucket-specific rules
 */
async function createOutcomeLabel(
  snapshot: any,
  result: any
) {
  const { bucket, deltaPct } = result;
  
  // Apply bucket-specific labeling rules
  const { outcome, severity, reasons } = labelOutcome(bucket, deltaPct);
  
  const label = await OutcomeLabelModel.create({
    snapshotId: snapshot._id,
    resultId: result._id,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    bucket,
    windowHours: result.windowHours,
    outcome,
    severity,
    deltaPct,
    confidenceAtDecision: snapshot.confidence,
    coverageAtDecision: snapshot.coverageLevel,
    reasons,
    labeledAt: new Date(),
    decidedAt: snapshot.decidedAt,
  });
  
  console.log(`[Outcome F2] Label: ${snapshot.symbol} ${bucket} → ${outcome} (${severity.toFixed(2)})`);
  
  return label;
}

/**
 * Labeling rules by bucket
 */
function labelOutcome(
  bucket: string,
  deltaPct: number
): {
  outcome: OutcomeType;
  severity: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let outcome: OutcomeType;
  let severity: number;
  
  if (bucket === 'BUY') {
    // BUY: expect price increase
    if (deltaPct >= 5) {
      outcome = 'SUCCESS';
      severity = Math.min(1, deltaPct / 20); // Max at +20%
      reasons.push(`Price increased ${deltaPct.toFixed(2)}% (expected ≥5%)`);
    } else if (deltaPct >= -3) {
      outcome = 'FLAT';
      severity = 0.3;
      reasons.push(`Price stable at ${deltaPct.toFixed(2)}%`);
    } else {
      outcome = 'FAIL';
      severity = Math.min(1, Math.abs(deltaPct) / 10); // Max at -10%
      reasons.push(`Price dropped ${deltaPct.toFixed(2)}% (threshold: -3%)`);
    }
  } else if (bucket === 'WATCH') {
    // WATCH: expect stability
    const absDelta = Math.abs(deltaPct);
    if (absDelta <= 5) {
      outcome = 'SUCCESS';
      severity = 1 - (absDelta / 5); // Higher stability = higher severity
      reasons.push(`Price stable within ±5% (${deltaPct.toFixed(2)}%)`);
    } else if (absDelta <= 10) {
      outcome = 'FLAT';
      severity = 0.5;
      reasons.push(`Price moved ${deltaPct.toFixed(2)}% (acceptable range)`);
    } else {
      outcome = 'FAIL';
      severity = Math.min(1, absDelta / 20); // Max at ±20%
      reasons.push(`Price moved ${deltaPct.toFixed(2)}% (exceeded ±10%, missed signal)`);
    }
  } else { // SELL
    // SELL: expect price decrease
    if (deltaPct <= -5) {
      outcome = 'SUCCESS';
      severity = Math.min(1, Math.abs(deltaPct) / 20); // Max at -20%
      reasons.push(`Price dropped ${deltaPct.toFixed(2)}% (expected ≤-5%)`);
    } else if (deltaPct <= 3) {
      outcome = 'FLAT';
      severity = 0.3;
      reasons.push(`Price stable at ${deltaPct.toFixed(2)}%`);
    } else {
      outcome = 'FAIL';
      severity = Math.min(1, deltaPct / 10); // Max at +10%
      reasons.push(`Price increased ${deltaPct.toFixed(2)}% (threshold: +3%)`);
    }
  }
  
  return { outcome, severity, reasons };
}

/**
 * Get outcome statistics
 */
export async function getOutcomeStats(windowHours?: number) {
  const matchStage: any = {};
  if (windowHours) {
    matchStage.windowHours = windowHours;
  }
  
  const stats = await OutcomeLabelModel.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { bucket: '$bucket', outcome: '$outcome' },
        count: { $sum: 1 },
        avgSeverity: { $avg: '$severity' },
        avgDelta: { $avg: '$deltaPct' },
      },
    },
    { $sort: { '_id.bucket': 1, '_id.outcome': 1 } },
  ]);
  
  // Format results
  const formatted: any = {
    BUY: { SUCCESS: 0, FLAT: 0, FAIL: 0 },
    WATCH: { SUCCESS: 0, FLAT: 0, FAIL: 0 },
    SELL: { SUCCESS: 0, FLAT: 0, FAIL: 0 },
  };
  
  for (const stat of stats) {
    const bucket = stat._id.bucket;
    const outcome = stat._id.outcome;
    formatted[bucket][outcome] = {
      count: stat.count,
      avgSeverity: stat.avgSeverity,
      avgDelta: stat.avgDelta,
    };
  }
  
  return formatted;
}

/**
 * Get accuracy metrics by bucket
 */
export async function getAccuracyMetrics(windowHours: number = 168) {
  const labels = await OutcomeLabelModel.find({ windowHours }).lean();
  
  if (labels.length === 0) {
    return null;
  }
  
  const byBucket: any = {
    BUY: { total: 0, success: 0, fail: 0 },
    WATCH: { total: 0, success: 0, fail: 0 },
    SELL: { total: 0, success: 0, fail: 0 },
  };
  
  for (const label of labels) {
    byBucket[label.bucket].total++;
    if (label.outcome === 'SUCCESS') {
      byBucket[label.bucket].success++;
    } else if (label.outcome === 'FAIL') {
      byBucket[label.bucket].fail++;
    }
  }
  
  // Calculate accuracy
  const accuracy: any = {};
  for (const bucket of ['BUY', 'WATCH', 'SELL']) {
    const data = byBucket[bucket];
    accuracy[bucket] = {
      total: data.total,
      accuracy: data.total > 0 ? (data.success / data.total) * 100 : 0,
      successRate: data.total > 0 ? (data.success / data.total) * 100 : 0,
      failRate: data.total > 0 ? (data.fail / data.total) * 100 : 0,
    };
  }
  
  return accuracy;
}
