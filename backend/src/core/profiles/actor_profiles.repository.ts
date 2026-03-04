/**
 * Actor Profiles Repository
 */
import { ActorProfileModel, IActorProfile, calculateScoreTier, ProfileScores } from './actor_profiles.model.js';

export interface UpsertActorProfileInput {
  address: string;
  chain?: string;
  label?: string;
  entityId?: string;
  strategy?: IActorProfile['strategy'];
  scores?: Partial<ProfileScores>;
  topBundles?: IActorProfile['topBundles'];
  recentSignals?: IActorProfile['recentSignals'];
  dominantAssets?: IActorProfile['dominantAssets'];
  activeRelations?: IActorProfile['activeRelations'];
  stats?: Partial<IActorProfile['stats']>;
}

/**
 * Get actor profile by address
 */
export async function getActorProfile(address: string): Promise<IActorProfile | null> {
  return ActorProfileModel.findOne({ address: address.toLowerCase() }).lean();
}

/**
 * Get multiple actor profiles
 */
export async function getActorProfiles(addresses: string[]): Promise<IActorProfile[]> {
  const lowerAddresses = addresses.map(a => a.toLowerCase());
  return ActorProfileModel.find({ address: { $in: lowerAddresses } }).lean();
}

/**
 * Upsert actor profile
 */
export async function upsertActorProfile(input: UpsertActorProfileInput): Promise<IActorProfile> {
  const address = input.address.toLowerCase();
  
  const updateDoc: Record<string, unknown> = {
    address,
    lastUpdated: new Date(),
  };
  
  if (input.chain) updateDoc.chain = input.chain;
  if (input.label) updateDoc.label = input.label;
  if (input.entityId) updateDoc.entityId = input.entityId;
  if (input.strategy !== undefined) updateDoc.strategy = input.strategy;
  if (input.topBundles) updateDoc.topBundles = input.topBundles;
  if (input.recentSignals) updateDoc.recentSignals = input.recentSignals;
  if (input.dominantAssets) updateDoc.dominantAssets = input.dominantAssets;
  if (input.activeRelations) updateDoc.activeRelations = input.activeRelations;
  if (input.stats) updateDoc.stats = input.stats;
  
  if (input.scores) {
    const composite = input.scores.composite ?? 50;
    updateDoc.scores = {
      behavior: input.scores.behavior ?? 50,
      intensity: input.scores.intensity ?? 50,
      consistency: input.scores.consistency ?? 50,
      risk: input.scores.risk ?? 50,
      influence: input.scores.influence ?? 50,
      composite,
      tier: calculateScoreTier(composite),
    };
  }
  
  return ActorProfileModel.findOneAndUpdate(
    { address },
    { $set: updateDoc, $inc: { profileVersion: 1 } },
    { new: true, upsert: true }
  ).lean() as Promise<IActorProfile>;
}

/**
 * Get top actors by score
 */
export async function getTopActorsByScore(
  limit: number = 50,
  tier?: string
): Promise<IActorProfile[]> {
  const query: Record<string, unknown> = {};
  if (tier) query['scores.tier'] = tier;
  
  return ActorProfileModel
    .find(query)
    .sort({ 'scores.composite': -1 })
    .limit(limit)
    .lean();
}

/**
 * Get actors by strategy type
 */
export async function getActorsByStrategy(
  strategyType: string,
  limit: number = 50
): Promise<IActorProfile[]> {
  return ActorProfileModel
    .find({ 'strategy.strategyType': strategyType })
    .sort({ 'strategy.confidence': -1 })
    .limit(limit)
    .lean();
}

/**
 * Search actor profiles
 */
export async function searchActorProfiles(
  query: string,
  limit: number = 20
): Promise<IActorProfile[]> {
  const searchRegex = new RegExp(query, 'i');
  
  return ActorProfileModel
    .find({
      $or: [
        { address: searchRegex },
        { label: searchRegex },
      ],
    })
    .limit(limit)
    .lean();
}

/**
 * Get profile stats
 */
export async function getProfileStats(): Promise<{
  total: number;
  byTier: Record<string, number>;
  byStrategy: Record<string, number>;
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
  
  return { total, byTier, byStrategy };
}
