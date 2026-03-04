/**
 * Build Decisions Job
 * 
 * Generates decisions for active actors with significant activity.
 */
import { DecisionModel } from '../core/decisions/decisions.model.js';
import { generateActorDecision } from '../core/decisions/decisions.service.js';
import { StrategyProfileModel } from '../core/strategies/strategy_profiles.model.js';
import { StrategySignalModel } from '../core/strategy_signals/strategy_signals.model.js';

interface BuildDecisionsResult {
  processedActors: number;
  decisionsCreated: number;
  errors: number;
  duration: number;
}

/**
 * Build decisions for actors with recent activity
 */
export async function buildDecisions(): Promise<BuildDecisionsResult> {
  const start = Date.now();
  let processedActors = 0;
  let decisionsCreated = 0;
  let errors = 0;
  
  try {
    // Get actors with recent strategy signals (last 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const activeActors = await StrategySignalModel.aggregate([
      { $match: { createdAt: { $gt: dayAgo } } },
      { $group: { _id: '$actorAddress' } },
      { $limit: 100 },  // Process max 100 per run
    ]);
    
    for (const actor of activeActors) {
      const address = actor._id;
      
      try {
        // Check if we already have a valid decision
        const existingDecision = await DecisionModel.findOne({
          scope: 'actor',
          refId: address,
          validUntil: { $gt: new Date() },
          supersededBy: { $exists: false },
        });
        
        // Skip if decision exists and was created recently (last 6h)
        if (existingDecision) {
          const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
          if (existingDecision.createdAt > sixHoursAgo) {
            processedActors++;
            continue;
          }
        }
        
        // Generate new decision
        await generateActorDecision(address);
        decisionsCreated++;
        processedActors++;
        
      } catch (err) {
        console.error(`[Build Decisions] Error for actor ${address}:`, err);
        errors++;
      }
    }
    
  } catch (err) {
    console.error('[Build Decisions] Job failed:', err);
    errors++;
  }
  
  return {
    processedActors,
    decisionsCreated,
    errors,
    duration: Date.now() - start,
  };
}

/**
 * Get job status
 */
export async function getBuildDecisionsStatus(): Promise<{
  totalDecisions: number;
  activeDecisions: number;
  byType: Record<string, number>;
}> {
  const now = new Date();
  
  const [total, active, byTypeAgg] = await Promise.all([
    DecisionModel.countDocuments(),
    DecisionModel.countDocuments({ 
      validUntil: { $gt: now }, 
      supersededBy: { $exists: false } 
    }),
    DecisionModel.aggregate([
      { $match: { validUntil: { $gt: now }, supersededBy: { $exists: false } } },
      { $group: { _id: '$decisionType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) byType[item._id] = item.count;
  
  return {
    totalDecisions: total,
    activeDecisions: active,
    byType,
  };
}
