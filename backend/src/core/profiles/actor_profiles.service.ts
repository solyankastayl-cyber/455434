/**
 * Actor Profiles Service
 * Builds and manages actor profiles
 */
import { IActorProfile } from './actor_profiles.model.js';
import * as repo from './actor_profiles.repository.js';
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { ScoreModel } from '../scores/scores.model.js';
import { BundleModel } from '../bundles/bundles.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { RelationModel } from '../relations/relations.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

/**
 * Get actor profile (for API)
 */
export async function getActorProfile(address: string): Promise<IActorProfile | null> {
  return repo.getActorProfile(address);
}

/**
 * Get top actors
 */
export async function getTopActors(
  limit: number = 50,
  tier?: string
): Promise<IActorProfile[]> {
  return repo.getTopActorsByScore(limit, tier);
}

/**
 * Get actors by strategy
 */
export async function getActorsByStrategy(
  strategyType: string,
  limit: number = 50
): Promise<IActorProfile[]> {
  return repo.getActorsByStrategy(strategyType, limit);
}

/**
 * Search profiles
 */
export async function searchProfiles(
  query: string,
  limit: number = 20
): Promise<IActorProfile[]> {
  return repo.searchActorProfiles(query, limit);
}

/**
 * Build/rebuild actor profile from all sources
 */
export async function buildActorProfile(address: string): Promise<IActorProfile> {
  const addr = address.toLowerCase();
  
  // Fetch all data in parallel
  const [strategy, score, bundles, signals, relations, transferStats] = await Promise.all([
    // Strategy profile
    StrategyProfileModel.findOne({ address: addr }).sort({ updatedAt: -1 }).lean(),
    
    // Scores (7d window)
    ScoreModel.findOne({ subjectId: addr, window: '7d' }).lean(),
    
    // Recent bundles (top 5 by volume)
    BundleModel.find({ actors: addr })
      .sort({ volumeUsd: -1 })
      .limit(20)
      .lean(),
    
    // Recent signals (last 10)
    SignalModel.find({ subjectId: addr })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    
    // Active relations (top 10 by volume)
    RelationModel.find({
      $or: [{ from: addr }, { to: addr }],
    })
      .sort({ volumeUsd: -1 })
      .limit(10)
      .lean(),
    
    // Transfer stats
    TransferModel.aggregate([
      { $match: { $or: [{ from: addr }, { to: addr }] } },
      {
        $group: {
          _id: null,
          totalTransfers: { $sum: 1 },
          totalVolumeUsd: { $sum: '$valueUsd' },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          counterparties: {
            $addToSet: {
              $cond: [{ $eq: ['$from', addr] }, '$to', '$from'],
            },
          },
        },
      },
    ]),
  ]);
  
  // Process strategy
  const strategySummary = strategy ? {
    strategyType: strategy.strategyType,
    confidence: strategy.confidence,
    stability: strategy.stability,
    preferredWindow: strategy.preferredWindow || '7d',
    phase: strategy.bundleBreakdown.accumulationRatio > strategy.bundleBreakdown.distributionRatio 
      ? 'accumulation' 
      : 'distribution',
    detectedAt: strategy.createdAt,
  } : null;
  
  // Process scores
  const scores = score ? {
    behavior: score.behaviorScore,
    intensity: score.intensityScore,
    consistency: score.consistencyScore,
    risk: score.riskScore,
    influence: score.influenceScore,
    composite: score.compositeScore,
  } : undefined;
  
  // Process bundles - group by type
  const bundleMap = new Map<string, { count: number; volume: number; confidence: number; lastSeen: Date }>();
  for (const b of bundles) {
    const existing = bundleMap.get(b.bundleType) || { count: 0, volume: 0, confidence: 0, lastSeen: b.createdAt };
    existing.count++;
    existing.volume += b.volumeUsd || 0;
    existing.confidence += b.confidence || 0;
    if (b.createdAt > existing.lastSeen) existing.lastSeen = b.createdAt;
    bundleMap.set(b.bundleType, existing);
  }
  
  const topBundles = Array.from(bundleMap.entries())
    .map(([bundleType, data]) => ({
      bundleType,
      count: data.count,
      volumeUsd: data.volume,
      avgConfidence: data.count > 0 ? data.confidence / data.count : 0,
      lastSeen: data.lastSeen,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, 5);
  
  // Process signals
  const recentSignals = signals.map(s => ({
    type: s.type,
    severity: s.severity || 'medium',  // String severity: 'low' | 'medium' | 'high' | 'critical'
    confidence: s.confidence || 0.5,
    createdAt: s.createdAt,
    explanation: s.explanation,
  }));
  
  // Process relations
  const activeRelations = relations.map(r => {
    const isFrom = r.from === addr;
    return {
      counterparty: isFrom ? r.to : r.from,
      label: undefined,
      direction: r.from === r.to ? 'bidirectional' as const :
                 isFrom ? 'outbound' as const : 'inbound' as const,
      transferCount: r.transferCount,
      volumeUsd: r.volumeUsd || 0,
      lastInteraction: r.lastTransferAt || r.updatedAt,
    };
  });
  
  // Process transfer stats
  const stats = transferStats[0] ? {
    totalTransfers: transferStats[0].totalTransfers || 0,
    totalVolumeUsd: transferStats[0].totalVolumeUsd || 0,
    firstSeen: transferStats[0].firstSeen || null,
    lastSeen: transferStats[0].lastSeen || null,
    uniqueCounterparties: transferStats[0].counterparties?.length || 0,
  } : {
    totalTransfers: 0,
    totalVolumeUsd: 0,
    firstSeen: null,
    lastSeen: null,
    uniqueCounterparties: 0,
  };
  
  // Calculate dominant assets (placeholder - would need asset tracking)
  const dominantAssets: IActorProfile['dominantAssets'] = [];
  
  // Upsert profile
  return repo.upsertActorProfile({
    address: addr,
    strategy: strategySummary,
    scores,
    topBundles,
    recentSignals,
    dominantAssets,
    activeRelations,
    stats,
  });
}

/**
 * Get profile stats
 */
export async function getStats() {
  return repo.getProfileStats();
}
