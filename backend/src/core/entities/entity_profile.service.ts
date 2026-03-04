/**
 * Entity Profile Service (Phase 15.5.2 - Step 2)
 * 
 * Entity ≠ Token ≠ Actor
 * Entity = Group of addresses (exchange, fund, protocol)
 */
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { ActorReputationModel } from '../reputation/actor_reputation.model.js';
import { RelationModel } from '../relations/relations.model.js';

export type EntitySubtype = 'exchange' | 'fund' | 'protocol' | 'whale_cluster' | 'market_maker' | 'unknown';

export interface EntityProfile {
  id: string;
  name: string;
  subtype: EntitySubtype;
  
  // Composition
  addresses: Array<{
    address: string;
    role: string;
    lastActive?: Date;
  }>;
  totalAddresses: number;
  
  // Activity
  activity: {
    lastSignal?: Date;
    signalsLast24h: number;
    signalsLast7d: number;
    primaryStrategy?: string;
  };
  
  // Trust & Reputation
  trust: {
    avgTrustScore: number | null;
    reliabilityTier: string | null;
    addressesWithReputation: number;
  };
  
  // Top strategies used
  strategies: Array<{
    type: string;
    count: number;
    successRate?: number;
  }>;
  
  // Related actors
  relatedActors: Array<{
    address: string;
    relationship: string;
    strength: number;
  }>;
  
  lastUpdated: Date;
}

/**
 * Get entity profile by ID or name
 */
export async function getEntityProfile(idOrName: string): Promise<EntityProfile | null> {
  const searchTerm = idOrName.toLowerCase();
  
  // For now, we treat entities as clusters of strategy profiles
  // In production, would have a dedicated entities collection
  
  // Search by address pattern (if it's an address)
  if (searchTerm.startsWith('0x') && searchTerm.length === 42) {
    // Single address - get its profile and find related addresses
    const profile = await StrategyProfileModel.findOne({ 
      address: searchTerm 
    }).lean();
    
    if (!profile) {
      return null;
    }
    
    // Find related addresses
    const relations = await RelationModel.find({
      $or: [
        { fromAddress: searchTerm },
        { toAddress: searchTerm },
      ],
    }).lean().catch(() => []);
    
    const relatedAddresses = relations.map((r: any) => ({
      address: r.fromAddress === searchTerm ? r.toAddress : r.fromAddress,
      role: r.type || 'related',
      strength: r.score || 0.5,
    }));
    
    // Get activity
    const [signals24h, signals7d, recentSignal] = await Promise.all([
      SignalModel.countDocuments({ 
        fromAddress: searchTerm, 
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
      }),
      SignalModel.countDocuments({ 
        fromAddress: searchTerm, 
        timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
      }),
      SignalModel.findOne({ fromAddress: searchTerm }).sort({ timestamp: -1 }).lean(),
    ]);
    
    // Get reputation
    const reputation = await ActorReputationModel.findOne({ address: searchTerm }).lean();
    
    // Get strategies
    const strategies = await SignalModel.aggregate([
      { $match: { fromAddress: searchTerm } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
    
    return {
      id: searchTerm,
      name: (profile as any).label || `${searchTerm.slice(0, 8)}...`,
      subtype: determineSubtype(profile as any),
      
      addresses: [
        { address: searchTerm, role: 'primary' },
        ...relatedAddresses.slice(0, 10).map(r => ({
          address: r.address,
          role: r.role,
        })),
      ],
      totalAddresses: 1 + relatedAddresses.length,
      
      activity: {
        lastSignal: (recentSignal as any)?.timestamp,
        signalsLast24h: signals24h,
        signalsLast7d: signals7d,
        primaryStrategy: strategies[0]?._id,
      },
      
      trust: {
        avgTrustScore: (reputation as any)?.trustScore || null,
        reliabilityTier: (reputation as any)?.reliabilityTier || null,
        addressesWithReputation: reputation ? 1 : 0,
      },
      
      strategies: strategies.map(s => ({
        type: s._id,
        count: s.count,
      })),
      
      relatedActors: relatedAddresses.slice(0, 5).map(r => ({
        address: r.address,
        relationship: r.role,
        strength: r.strength,
      })),
      
      lastUpdated: new Date(),
    };
  }
  
  // Search by name pattern
  const profiles = await StrategyProfileModel.find({
    $or: [
      { label: { $regex: searchTerm, $options: 'i' } },
      { strategyType: { $regex: searchTerm, $options: 'i' } },
    ],
  }).limit(1).lean();
  
  if (profiles.length === 0) {
    return null;
  }
  
  // Recursively get profile by address
  return getEntityProfile((profiles[0] as any).address);
}

/**
 * Get actors belonging to an entity
 */
export async function getEntityActors(entityId: string): Promise<Array<{
  address: string;
  trustScore: number | null;
  signalCount: number;
  lastActive?: Date;
}>> {
  // For single address entities
  if (entityId.startsWith('0x') && entityId.length === 42) {
    const reputation = await ActorReputationModel.findOne({ address: entityId.toLowerCase() }).lean();
    const signalCount = await SignalModel.countDocuments({ fromAddress: entityId.toLowerCase() });
    const lastSignal = await SignalModel.findOne({ fromAddress: entityId.toLowerCase() }).sort({ timestamp: -1 }).lean();
    
    return [{
      address: entityId.toLowerCase(),
      trustScore: (reputation as any)?.trustScore || null,
      signalCount,
      lastActive: (lastSignal as any)?.timestamp,
    }];
  }
  
  return [];
}

/**
 * Get strategies used by entity
 */
export async function getEntityStrategies(entityId: string): Promise<Array<{
  type: string;
  count: number;
  avgConfidence: number | null;
  lastUsed?: Date;
}>> {
  if (!entityId.startsWith('0x')) return [];
  
  const strategies = await SignalModel.aggregate([
    { $match: { fromAddress: entityId.toLowerCase() } },
    { 
      $group: { 
        _id: '$type', 
        count: { $sum: 1 },
        avgConfidence: { $avg: '$confidence' },
        lastUsed: { $max: '$timestamp' },
      } 
    },
    { $sort: { count: -1 } },
  ]);
  
  return strategies.map(s => ({
    type: s._id,
    count: s.count,
    avgConfidence: s.avgConfidence,
    lastUsed: s.lastUsed,
  }));
}

/**
 * Determine entity subtype from profile data
 */
function determineSubtype(profile: any): EntitySubtype {
  const strategyType = profile?.strategyType?.toLowerCase() || '';
  
  if (strategyType.includes('exchange')) return 'exchange';
  if (strategyType.includes('fund') || strategyType.includes('vc')) return 'fund';
  if (strategyType.includes('protocol') || strategyType.includes('defi')) return 'protocol';
  if (strategyType.includes('whale')) return 'whale_cluster';
  if (strategyType.includes('mm') || strategyType.includes('market')) return 'market_maker';
  
  return 'unknown';
}
