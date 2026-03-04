/**
 * Build Actor Profiles Job
 * 
 * Rebuilds actor profiles from all sources.
 * Period: 2-5 minutes
 * 
 * Sources:
 * - strategies
 * - scores
 * - bundles
 * - signals
 * - relations
 * 
 * Output: 1 document = 1 actor
 */
import { ActorProfileModel } from '../core/profiles/actor_profiles.model.js';
import { buildActorProfile } from '../core/profiles/actor_profiles.service.js';
import { StrategyProfileModel } from '../core/strategies/strategy_profiles.model.js';
import { ScoreModel } from '../core/scores/scores.model.js';
import { TransferModel } from '../core/transfers/transfers.model.js';

let lastRunTime: Date | null = null;

export interface BuildActorProfilesResult {
  processedActors: number;
  newProfiles: number;
  updatedProfiles: number;
  duration: number;
}

/**
 * Build/update actor profiles
 */
export async function buildActorProfiles(): Promise<BuildActorProfilesResult> {
  const startTime = Date.now();
  let processedActors = 0;
  let newProfiles = 0;
  let updatedProfiles = 0;
  
  try {
    // Find actors that need profile updates
    // Strategy 1: Actors with recent strategy updates
    const recentStrategies = await StrategyProfileModel
      .find(lastRunTime ? { updatedAt: { $gt: lastRunTime } } : {})
      .select('address')
      .limit(100)
      .lean();
    
    // Strategy 2: Actors with recent score updates
    const recentScores = await ScoreModel
      .find(lastRunTime ? { updatedAt: { $gt: lastRunTime } } : {})
      .select('subjectId')
      .limit(100)
      .lean();
    
    // Combine unique addresses
    const addressSet = new Set<string>();
    
    for (const s of recentStrategies) {
      addressSet.add(s.address.toLowerCase());
    }
    
    for (const s of recentScores) {
      addressSet.add(s.subjectId.toLowerCase());
    }
    
    const addresses = Array.from(addressSet);
    
    if (addresses.length === 0) {
      lastRunTime = new Date();
      return { processedActors: 0, newProfiles: 0, updatedProfiles: 0, duration: Date.now() - startTime };
    }
    
    // Check which profiles already exist
    const existingProfiles = await ActorProfileModel
      .find({ address: { $in: addresses } })
      .select('address')
      .lean();
    
    const existingSet = new Set(existingProfiles.map(p => p.address));
    
    // Build profiles
    for (const address of addresses) {
      try {
        await buildActorProfile(address);
        processedActors++;
        
        if (existingSet.has(address)) {
          updatedProfiles++;
        } else {
          newProfiles++;
        }
      } catch (err) {
        console.error(`[Build Actor Profiles] Error building ${address}:`, err);
      }
    }
    
    lastRunTime = new Date();
    
  } catch (err) {
    console.error('[Build Actor Profiles] Job failed:', err);
  }
  
  return {
    processedActors,
    newProfiles,
    updatedProfiles,
    duration: Date.now() - startTime,
  };
}

/**
 * Get job status
 */
export async function getBuildActorProfilesStatus(): Promise<{
  totalProfiles: number;
  byTier: Record<string, number>;
  byStrategy: Record<string, number>;
  lastRun: string | null;
}> {
  const [total, byTierAgg, byStrategyAgg] = await Promise.all([
    ActorProfileModel.countDocuments(),
    ActorProfileModel.aggregate([
      { $group: { _id: '$scores.tier', count: { $sum: 1 } } },
    ]),
    ActorProfileModel.aggregate([
      { $match: { strategy: { $ne: null } } },
      { $group: { _id: '$strategy.strategyType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byTier: Record<string, number> = {};
  for (const item of byTierAgg) {
    byTier[item._id || 'unknown'] = item.count;
  }
  
  const byStrategy: Record<string, number> = {};
  for (const item of byStrategyAgg) {
    byStrategy[item._id] = item.count;
  }
  
  return {
    totalProfiles: total,
    byTier,
    byStrategy,
    lastRun: lastRunTime?.toISOString() || null,
  };
}
