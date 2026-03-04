/**
 * Build Trust Snapshots Job (Phase 15.4)
 * 
 * Creates UI-ready trust indicators for signals, strategies, and actors.
 * Runs every 5 minutes.
 */
import { Types } from 'mongoose';
import {
  generateSignalSnapshot,
  generateStrategySnapshot,
  generateActorSnapshot,
} from '../core/reputation/trust_snapshots.service.js';
import { SignalReputationModel } from '../core/reputation/signal_reputation.model.js';
import { StrategyReputationModel } from '../core/reputation/strategy_reputation.model.js';
import { ActorReputationModel } from '../core/reputation/actor_reputation.model.js';
import { TrustSnapshotModel } from '../core/reputation/trust_snapshots.model.js';

interface BuildTrustSnapshotsResult {
  signals: number;
  strategies: number;
  actors: number;
  errors: number;
  duration: number;
}

export async function buildTrustSnapshots(): Promise<BuildTrustSnapshotsResult> {
  const start = Date.now();
  let signalsProcessed = 0;
  let strategiesProcessed = 0;
  let actorsProcessed = 0;
  let errors = 0;
  
  try {
    // 1. Process signals with recent reputation updates
    const recentSignals = await SignalReputationModel.find({
      lastUpdatedAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) },  // Last 30 min
    })
      .limit(50)
      .lean();
    
    for (const rep of recentSignals) {
      try {
        await generateSignalSnapshot(rep.signalId);
        signalsProcessed++;
      } catch (err) {
        console.error(`[Build Trust Snapshots] Error processing signal ${rep.signalId}:`, err);
        errors++;
      }
    }
    
    // 2. Process all strategies (small number)
    const strategies = await StrategyReputationModel.find().lean();
    
    for (const rep of strategies) {
      try {
        await generateStrategySnapshot(rep.strategyType);
        strategiesProcessed++;
      } catch (err) {
        console.error(`[Build Trust Snapshots] Error processing strategy ${rep.strategyType}:`, err);
        errors++;
      }
    }
    
    // 3. Process actors with recent updates
    const recentActors = await ActorReputationModel.find({
      lastUpdatedAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },  // Last hour
    })
      .limit(30)
      .lean();
    
    for (const rep of recentActors) {
      try {
        await generateActorSnapshot(rep.address);
        actorsProcessed++;
      } catch (err) {
        console.error(`[Build Trust Snapshots] Error processing actor ${rep.address}:`, err);
        errors++;
      }
    }
    
    return {
      signals: signalsProcessed,
      strategies: strategiesProcessed,
      actors: actorsProcessed,
      errors,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Build Trust Snapshots] Job failed:', err);
    return {
      signals: signalsProcessed,
      strategies: strategiesProcessed,
      actors: actorsProcessed,
      errors: errors + 1,
      duration: Date.now() - start,
    };
  }
}

export async function getBuildTrustSnapshotsStatus() {
  const [totalSnapshots, byType] = await Promise.all([
    TrustSnapshotModel.countDocuments(),
    TrustSnapshotModel.aggregate([
      { $group: { _id: '$targetType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const counts: Record<string, number> = {};
  for (const item of byType) {
    counts[item._id] = item.count;
  }
  
  return {
    total: totalSnapshots,
    byType: counts,
  };
}
