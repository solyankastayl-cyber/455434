/**
 * Update Trust Scores Job
 * 
 * Recalculates trust scores based on simulation outcomes and feedback.
 */
import { DecisionType } from '../core/decisions/decisions.model.js';
import {
  calculateSystemTrust,
  calculateDecisionTypeTrust,
  calculateActorTrust,
} from '../core/trust/trust.service.js';
import { updateActiveSimulations } from '../core/simulations/simulations.service.js';
import { expireOldActions } from '../core/actions/actions.service.js';
import { TrustModel } from '../core/trust/trust.model.js';
import { SimulationModel } from '../core/simulations/simulations.model.js';

interface UpdateTrustResult {
  simulationsUpdated: number;
  simulationsCompleted: number;
  trustScoresUpdated: number;
  expiredActions: number;
  errors: number;
  duration: number;
}

const DECISION_TYPES: DecisionType[] = [
  'follow',
  'copy',
  'watch',
  'ignore',
  'reduce_exposure',
  'increase_exposure',
];

/**
 * Update trust scores and simulations
 */
export async function updateTrustScores(): Promise<UpdateTrustResult> {
  const start = Date.now();
  let trustScoresUpdated = 0;
  let errors = 0;
  
  try {
    // 1. Update active simulations
    const simResult = await updateActiveSimulations();
    
    // 2. Expire old actions
    const expiredActions = await expireOldActions();
    
    // 3. Recalculate system trust
    try {
      await calculateSystemTrust();
      trustScoresUpdated++;
    } catch (err) {
      console.error('[Update Trust] System trust calculation failed:', err);
      errors++;
    }
    
    // 4. Recalculate trust for each decision type
    for (const decisionType of DECISION_TYPES) {
      try {
        await calculateDecisionTypeTrust(decisionType);
        trustScoresUpdated++;
      } catch (err) {
        console.error(`[Update Trust] Decision type ${decisionType} failed:`, err);
        errors++;
      }
    }
    
    // 5. Recalculate trust for actors with completed simulations (last 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentlyCompletedSims = await SimulationModel.find({
      status: 'completed',
      updatedAt: { $gt: dayAgo },
    }).lean();
    
    const actorsToUpdate = [...new Set(recentlyCompletedSims.map(s => s.targetId))];
    
    for (const address of actorsToUpdate.slice(0, 50)) {  // Limit to 50 actors per run
      try {
        await calculateActorTrust(address);
        trustScoresUpdated++;
      } catch (err) {
        console.error(`[Update Trust] Actor ${address} failed:`, err);
        errors++;
      }
    }
    
    return {
      simulationsUpdated: simResult.updated,
      simulationsCompleted: simResult.completed,
      trustScoresUpdated,
      expiredActions,
      errors: errors + simResult.errors,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Update Trust] Job failed:', err);
    return {
      simulationsUpdated: 0,
      simulationsCompleted: 0,
      trustScoresUpdated,
      expiredActions: 0,
      errors: errors + 1,
      duration: Date.now() - start,
    };
  }
}

/**
 * Get job status
 */
export async function getUpdateTrustStatus(): Promise<{
  totalTrustRecords: number;
  byLevel: Record<string, number>;
  avgTrustScore: number;
  activeSimulations: number;
}> {
  const [total, byLevelAgg, avgAgg, activeSims] = await Promise.all([
    TrustModel.countDocuments(),
    TrustModel.aggregate([
      { $group: { _id: '$trustLevel', count: { $sum: 1 } } },
    ]),
    TrustModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$trustScore' } } },
    ]),
    SimulationModel.countDocuments({ status: 'active' }),
  ]);
  
  const byLevel: Record<string, number> = {};
  for (const item of byLevelAgg) byLevel[item._id] = item.count;
  
  return {
    totalTrustRecords: total,
    byLevel,
    avgTrustScore: avgAgg[0]?.avg || 0,
    activeSimulations: activeSims,
  };
}
