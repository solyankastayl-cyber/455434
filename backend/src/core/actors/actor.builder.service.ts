/**
 * Actor Builder Service
 * 
 * EPIC A1: Builds Actors from Entities + Wallet clusters
 * 
 * Actor = aggregated profile, NOT a wallet, NOT an entity
 * Actor = Network Participant (observed structure)
 */

import { v4 as uuidv4 } from 'uuid';
import type { 
  Actor, 
  ActorType, 
  SourceLevel,
  ActorBuildConfig,
  ActorBuildStats,
  AddressStats
} from './actor.types.js';
import { DEFAULT_BUILD_CONFIG } from './actor.types.js';
import { calculateSimpleCoverage } from './actor.coverage.service.js';
import { 
  saveActorsBatch, 
  createBuildRun, 
  completeBuildRun, 
  failBuildRun,
  getActorCountByType,
  getActorCountBySource,
  ActorModel
} from './actor.model.js';

// ============================================
// ACTOR CREATION FROM ENTITIES
// ============================================

interface EntityInput {
  id: string;
  name?: string;
  type: string;
  addresses: string[];
  verified: boolean;
  coverage?: number;
}

/**
 * Map entity type to actor type
 */
function mapEntityTypeToActorType(entityType: string): ActorType | null {
  const mapping: Record<string, ActorType> = {
    'exchange': 'exchange',
    'cex': 'exchange',
    'fund': 'fund',
    'venture': 'fund',
    'vc': 'fund',
    'market_maker': 'market_maker',
    'mm': 'market_maker',
    'liquidity_provider': 'market_maker',
  };
  
  return mapping[entityType.toLowerCase()] || null;
}

/**
 * Create actor from entity
 */
function createActorFromEntity(entity: EntityInput): Actor | null {
  const actorType = mapEntityTypeToActorType(entity.type);
  if (!actorType) return null;
  
  const sourceLevel: SourceLevel = entity.verified ? 'verified' : 'attributed';
  
  const addressStats: AddressStats = {
    verifiedCount: entity.verified ? entity.addresses.length : 0,
    attributedCount: entity.verified ? 0 : entity.addresses.length,
    behavioralCount: 0,
    totalCount: entity.addresses.length,
  };
  
  // Calculate simple coverage
  const coverage = calculateSimpleCoverage(
    entity.addresses.length,
    addressStats.verifiedCount,
    entity.coverage || 50 // Default activity score
  );
  
  return {
    id: `actor_${entity.id}`,
    type: actorType,
    name: entity.name,
    sourceLevel,
    addresses: entity.addresses.map(a => a.toLowerCase()),
    addressStats,
    coverage,
    entityIds: [entity.id],
    labels: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================
// ACTOR CREATION FROM WALLETS
// ============================================

interface WalletClusterInput {
  addresses: string[];
  volume7d: number;     // USD
  txCount7d: number;
  bidirectionalRatio: number;  // 0-1
  tokenDiversity: number;
}

/**
 * Classify wallet cluster as actor type
 */
function classifyWalletCluster(
  cluster: WalletClusterInput,
  config: ActorBuildConfig
): ActorType | null {
  // Market maker: bidirectional flow + token diversity
  if (
    cluster.bidirectionalRatio >= config.mmBidirectionalRatio &&
    cluster.tokenDiversity >= config.mmTokenDiversityMin
  ) {
    return 'market_maker';
  }
  
  // Whale: high volume
  if (cluster.volume7d >= config.whaleVolumeThreshold7d) {
    return 'whale';
  }
  
  // Trader: high tx count
  if (cluster.txCount7d >= config.traderTxCountThreshold7d) {
    return 'trader';
  }
  
  return null; // Not significant enough
}

/**
 * Create actor from wallet cluster
 */
function createActorFromWalletCluster(
  cluster: WalletClusterInput,
  actorType: ActorType
): Actor {
  const addressStats: AddressStats = {
    verifiedCount: 0,
    attributedCount: 0,
    behavioralCount: cluster.addresses.length,
    totalCount: cluster.addresses.length,
  };
  
  // Activity score based on tx count
  const activityScore = Math.min(100, cluster.txCount7d * 2);
  
  const coverage = calculateSimpleCoverage(
    cluster.addresses.length,
    0,
    activityScore
  );
  
  return {
    id: `actor_${uuidv4()}`,
    type: actorType,
    name: undefined, // No name for behavioral actors
    sourceLevel: 'behavioral',
    addresses: cluster.addresses.map(a => a.toLowerCase()),
    addressStats,
    coverage,
    entityIds: [],
    labels: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================
// MAIN BUILD RUNNER
// ============================================

/**
 * Run actor build pipeline
 */
export async function runActorBuild(
  config: Partial<ActorBuildConfig> = {}
): Promise<ActorBuildStats> {
  const runId = uuidv4();
  const fullConfig = { ...DEFAULT_BUILD_CONFIG, ...config };
  
  console.log(`[ActorBuilder] Starting build run ${runId}`);
  
  try {
    await createBuildRun(runId, fullConfig);
    
    const actors: Actor[] = [];
    let entitiesProcessed = 0;
    let walletsProcessed = 0;
    
    // 1. Process entities (TODO: connect to actual entity collection)
    console.log(`[ActorBuilder] Processing entities...`);
    const entities = await getEntitiesForActorBuild();
    
    for (const entity of entities) {
      const actor = createActorFromEntity(entity);
      if (actor) {
        actors.push(actor);
      }
      entitiesProcessed++;
    }
    
    console.log(`[ActorBuilder] Created ${actors.length} actors from ${entitiesProcessed} entities`);
    
    // 2. Process wallet clusters (TODO: connect to actual wallet cluster analysis)
    console.log(`[ActorBuilder] Processing wallet clusters...`);
    const clusters = await getWalletClustersForActorBuild();
    
    for (const cluster of clusters) {
      const actorType = classifyWalletCluster(cluster, fullConfig);
      if (actorType) {
        const actor = createActorFromWalletCluster(cluster, actorType);
        actors.push(actor);
      }
      walletsProcessed++;
    }
    
    console.log(`[ActorBuilder] Added ${actors.length - entitiesProcessed} actors from ${walletsProcessed} wallet clusters`);
    
    // 3. Save actors
    console.log(`[ActorBuilder] Saving ${actors.length} actors...`);
    const saved = await saveActorsBatch(actors);
    
    // 4. Calculate stats
    const byType = await getActorCountByType();
    const bySource = await getActorCountBySource();
    
    const stats: ActorBuildStats = {
      runId,
      startedAt: new Date(),
      completedAt: new Date(),
      status: 'COMPLETED',
      entitiesProcessed,
      walletsProcessed,
      actorsCreated: saved,
      actorsUpdated: 0,
      byType: byType as Record<ActorType, number>,
      bySource: bySource as Record<SourceLevel, number>,
      errors: [],
    };
    
    await completeBuildRun(runId, stats);
    
    console.log(`[ActorBuilder] Build complete. Created/updated ${saved} actors.`);
    return stats;
    
  } catch (error) {
    console.error(`[ActorBuilder] Build failed:`, error);
    await failBuildRun(runId, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

// ============================================
// DATA SOURCE HELPERS (placeholders)
// ============================================

/**
 * Get entities for actor build
 * TODO: Connect to actual entity collection
 */
async function getEntitiesForActorBuild(): Promise<EntityInput[]> {
  // Placeholder: Return some seed data for demo
  // In production, this reads from entities collection
  
  return [
    {
      id: 'binance_main',
      name: 'Binance',
      type: 'exchange',
      addresses: ['0x28c6c06298d514db089934071355e5743bf21d60'],
      verified: true,
      coverage: 85,
    },
    {
      id: 'coinbase_main',
      name: 'Coinbase',
      type: 'exchange',
      addresses: ['0x71660c4005ba85c37ccec55d0c4493e66fe775d3'],
      verified: true,
      coverage: 80,
    },
    {
      id: 'a16z_fund',
      name: 'a16z Crypto',
      type: 'fund',
      addresses: ['0x05e793ce0c6027323ac150f6d45c2344d28b6019'],
      verified: true,
      coverage: 70,
    },
    {
      id: 'wintermute_mm',
      name: 'Wintermute',
      type: 'market_maker',
      addresses: ['0x0000006daea1723962647b7e189d311d757fb793'],
      verified: true,
      coverage: 75,
    },
  ];
}

/**
 * Get wallet clusters for actor build
 * TODO: Connect to actual wallet cluster analysis
 */
async function getWalletClustersForActorBuild(): Promise<WalletClusterInput[]> {
  // Placeholder: Return empty for now
  // In production, this runs cluster analysis on wallets
  
  return [];
}

// ============================================
// QUERY FUNCTIONS
// ============================================

import type { ActorQueryOptions, ActorListItem } from './actor.types.js';

/**
 * Query actors with filtering, sorting, pagination
 */
export async function queryActors(options: ActorQueryOptions): Promise<{
  actors: ActorListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  const {
    type,
    sourceLevel,
    coverageBand,
    search,
    sort = 'coverage',
    sortOrder = 'desc',
    page = 1,
    limit = 20,
  } = options;
  
  // Build query
  const query: Record<string, unknown> = {};
  
  if (type) query.type = type;
  if (sourceLevel) query.sourceLevel = sourceLevel;
  if (coverageBand) query['coverage.band'] = coverageBand;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { addresses: { $regex: search, $options: 'i' } },
    ];
  }
  
  // Sort mapping
  const sortField = {
    coverage: 'coverage.score',
    activity: 'updatedAt',
    edge_score: 'coverage.score', // TODO: implement real edge score
    created_at: 'createdAt',
  }[sort] || 'coverage.score';
  
  const sortDir = sortOrder === 'asc' ? 1 : -1;
  
  // Execute query
  const skip = (page - 1) * limit;
  
  const [actors, total] = await Promise.all([
    ActorModel.find(query)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean(),
    ActorModel.countDocuments(query),
  ]);
  
  // Map to list items
  const listItems: ActorListItem[] = actors.map(a => ({
    id: a.id,
    type: a.type,
    name: a.name,
    sourceLevel: a.sourceLevel,
    coverage: {
      score: a.coverage.score,
      band: a.coverage.band,
    },
    addressCount: a.addresses.length,
  }));
  
  return {
    actors: listItems,
    total,
    page,
    limit,
  };
}
