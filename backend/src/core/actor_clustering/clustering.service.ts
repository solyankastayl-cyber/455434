/**
 * Actor Clustering Service (P2.2)
 * 
 * Clusters wallets into strategic actors using deterministic heuristics:
 * - Shared funding source (0.35)
 * - Bridge route matching (0.30)
 * - Time correlation (0.20)
 * - Counterparty overlap (0.15)
 */

import { 
  ActorClusterModel, 
  WalletClusterLinkModel,
  IActorClusterDocument,
  ClusterHeuristic,
  ClusterMember,
  findClusterByWallet,
  isWalletClustered 
} from './actor_cluster.model.js';
import mongoose from 'mongoose';

// Heuristic weights
const WEIGHTS = {
  funding: 0.35,
  bridge_route: 0.30,
  time_correlation: 0.20,
  counterparty: 0.15,
};

// Confidence threshold for clustering
const MIN_CONFIDENCE_THRESHOLD = 0.60;

/**
 * Compute cluster confidence score from heuristics
 */
function computeConfidenceScore(heuristics: ClusterHeuristic[]): number {
  let totalScore = 0;
  
  for (const h of heuristics) {
    totalScore += h.weight * h.score;
  }
  
  return Math.min(totalScore, 1.0);
}

/**
 * Generate unique cluster ID
 */
function generateClusterId(): string {
  return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Heuristic 1: Shared Funding Source
 * 
 * Checks if wallets received funds from the same source address
 */
export async function checkSharedFunding(addresses: string[]): Promise<ClusterHeuristic> {
  const db = mongoose.connection.db;
  const relations = db.collection('relations');
  
  // Get all funding sources for each wallet
  const fundingSources = await Promise.all(
    addresses.map(async (addr) => {
      const incoming = await relations.find({
        to: addr.toLowerCase(),
        direction: 'in',
      }).limit(50).toArray();
      
      return {
        wallet: addr,
        sources: incoming.map(r => r.from),
      };
    })
  );
  
  // Find common sources
  if (fundingSources.length < 2) {
    return {
      type: 'funding',
      weight: WEIGHTS.funding,
      score: 0,
      evidence: { shared: [], count: 0 },
    };
  }
  
  const firstSources = new Set(fundingSources[0].sources);
  const commonSources = fundingSources.slice(1).reduce((acc, fs) => {
    return acc.filter(s => fs.sources.includes(s));
  }, Array.from(firstSources));
  
  const score = Math.min(commonSources.length / 3, 1.0); // Normalize to 0-1
  
  return {
    type: 'funding',
    weight: WEIGHTS.funding,
    score,
    evidence: {
      shared: commonSources.slice(0, 5), // Top 5
      count: commonSources.length,
    },
  };
}

/**
 * Heuristic 2: Bridge Route Matching
 * 
 * Checks if wallets use the same bridge routes
 */
export async function checkBridgeRoutes(addresses: string[]): Promise<ClusterHeuristic> {
  const db = mongoose.connection.db;
  const migrations = db.collection('bridge_migrations');
  
  // Get bridge patterns for each wallet
  const bridgePatterns = await Promise.all(
    addresses.map(async (addr) => {
      const userMigrations = await migrations.find({
        $or: [
          { 'from.address': addr.toLowerCase() },
          { 'to.address': addr.toLowerCase() },
        ],
      }).limit(50).toArray();
      
      // Extract route patterns
      const routes = userMigrations.map(m => 
        `${m.from?.chain || 'ETH'}->${m.to?.chain || 'ARB'}`
      );
      
      return {
        wallet: addr,
        routes,
      };
    })
  );
  
  // Find common routes
  if (bridgePatterns.length < 2 || bridgePatterns.every(bp => bp.routes.length === 0)) {
    return {
      type: 'bridge_route',
      weight: WEIGHTS.bridge_route,
      score: 0,
      evidence: { patterns: [], count: 0 },
    };
  }
  
  const firstRoutes = new Set(bridgePatterns[0].routes);
  const commonRoutes = bridgePatterns.slice(1).reduce((acc, bp) => {
    return acc.filter(r => bp.routes.includes(r));
  }, Array.from(firstRoutes));
  
  const score = Math.min(commonRoutes.length / 2, 1.0);
  
  return {
    type: 'bridge_route',
    weight: WEIGHTS.bridge_route,
    score,
    evidence: {
      patterns: commonRoutes.slice(0, 5),
      count: commonRoutes.length,
    },
  };
}

/**
 * Heuristic 3: Time Correlation
 * 
 * Checks if wallets have synchronized transaction patterns (±15 min)
 */
export async function checkTimeCorrelation(addresses: string[]): Promise<ClusterHeuristic> {
  const db = mongoose.connection.db;
  const transfers = db.collection('erc20_transfers');
  
  const SYNC_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  
  // Get recent transactions for each wallet
  const txTimestamps = await Promise.all(
    addresses.map(async (addr) => {
      const txs = await transfers.find({
        $or: [
          { from: addr.toLowerCase() },
          { to: addr.toLowerCase() },
        ],
      })
      .sort({ blockTimestamp: -1 })
      .limit(100)
      .toArray();
      
      return {
        wallet: addr,
        timestamps: txs.map(tx => tx.blockTimestamp).filter(Boolean),
      };
    })
  );
  
  // Find synchronized transactions
  if (txTimestamps.length < 2) {
    return {
      type: 'time_correlation',
      weight: WEIGHTS.time_correlation,
      score: 0,
      evidence: { timestamps: [], count: 0 },
    };
  }
  
  let syncCount = 0;
  const syncedTimestamps: number[] = [];
  
  const firstTimestamps = txTimestamps[0].timestamps;
  
  for (const ts1 of firstTimestamps) {
    for (let i = 1; i < txTimestamps.length; i++) {
      const hasSync = txTimestamps[i].timestamps.some(ts2 => 
        Math.abs(ts1 - ts2) < SYNC_WINDOW_MS
      );
      
      if (hasSync) {
        syncCount++;
        syncedTimestamps.push(ts1);
        break;
      }
    }
  }
  
  const score = Math.min(syncCount / 5, 1.0); // Normalize: 5+ syncs = max score
  
  return {
    type: 'time_correlation',
    weight: WEIGHTS.time_correlation,
    score,
    evidence: {
      timestamps: syncedTimestamps.slice(0, 5),
      count: syncCount,
    },
  };
}

/**
 * Heuristic 4: Counterparty Overlap
 * 
 * Checks if wallets interact with the same addresses (DEXs, bridges, etc.)
 */
export async function checkCounterpartyOverlap(addresses: string[]): Promise<ClusterHeuristic> {
  const db = mongoose.connection.db;
  const relations = db.collection('relations');
  
  // Get counterparties for each wallet
  const counterparties = await Promise.all(
    addresses.map(async (addr) => {
      const rels = await relations.find({
        $or: [
          { from: addr.toLowerCase() },
          { to: addr.toLowerCase() },
        ],
      }).limit(100).toArray();
      
      const counterpartySet = new Set<string>();
      rels.forEach(r => {
        if (r.from !== addr.toLowerCase()) counterpartySet.add(r.from);
        if (r.to !== addr.toLowerCase()) counterpartySet.add(r.to);
      });
      
      return {
        wallet: addr,
        counterparties: Array.from(counterpartySet),
      };
    })
  );
  
  // Find common counterparties
  if (counterparties.length < 2) {
    return {
      type: 'counterparty',
      weight: WEIGHTS.counterparty,
      score: 0,
      evidence: { shared: [], count: 0 },
    };
  }
  
  const firstCounterparties = new Set(counterparties[0].counterparties);
  const commonCounterparties = counterparties.slice(1).reduce((acc, cp) => {
    return acc.filter(c => cp.counterparties.includes(c));
  }, Array.from(firstCounterparties));
  
  const score = Math.min(commonCounterparties.length / 10, 1.0); // Normalize: 10+ common = max
  
  return {
    type: 'counterparty',
    weight: WEIGHTS.counterparty,
    score,
    evidence: {
      shared: commonCounterparties.slice(0, 5),
      count: commonCounterparties.length,
    },
  };
}

/**
 * Cluster wallets together if they meet confidence threshold
 */
export async function clusterWallets(
  addresses: string[],
  chain: string = 'ETH'
): Promise<IActorClusterDocument | null> {
  // Check if any wallet is already clustered
  for (const addr of addresses) {
    if (await isWalletClustered(addr, chain)) {
      console.log(`[Clustering] Wallet ${addr} already clustered, skipping`);
      return null;
    }
  }
  
  // Run all heuristics in parallel
  const [funding, bridgeRoute, timeCorr, counterparty] = await Promise.all([
    checkSharedFunding(addresses),
    checkBridgeRoutes(addresses),
    checkTimeCorrelation(addresses),
    checkCounterpartyOverlap(addresses),
  ]);
  
  const heuristics = [funding, bridgeRoute, timeCorr, counterparty];
  const confidenceScore = computeConfidenceScore(heuristics);
  
  // Check if confidence meets threshold
  if (confidenceScore < MIN_CONFIDENCE_THRESHOLD) {
    console.log(`[Clustering] Confidence ${confidenceScore.toFixed(2)} < ${MIN_CONFIDENCE_THRESHOLD}, not clustering`);
    return null;
  }
  
  // Create cluster
  const clusterId = generateClusterId();
  const primaryAddress = addresses[0]; // First address is primary
  
  const wallets: ClusterMember[] = addresses.map((addr, idx) => ({
    address: addr.toLowerCase(),
    chain,
    addedAt: new Date(),
    confidence: confidenceScore,
    role: idx === 0 ? 'primary' : 'secondary',
  }));
  
  const cluster = await ActorClusterModel.create({
    clusterId,
    primaryAddress: primaryAddress.toLowerCase(),
    wallets,
    confidenceScore,
    heuristics,
    metrics: {
      totalValue: 0,
      transactionCount: 0,
      bridgeCount: 0,
      chains: [chain],
      firstSeen: new Date(),
      lastSeen: new Date(),
    },
    version: 1,
    history: [{
      action: 'created',
      timestamp: new Date(),
      walletsAdded: addresses,
    }],
  });
  
  // Create wallet-cluster links for fast lookup
  await WalletClusterLinkModel.insertMany(
    addresses.map(addr => ({
      address: addr.toLowerCase(),
      chain,
      clusterId,
      confidence: confidenceScore,
      addedAt: new Date(),
    }))
  );
  
  console.log(`[Clustering] Created cluster ${clusterId} with ${addresses.length} wallets, confidence: ${confidenceScore.toFixed(2)}`);
  
  return cluster;
}

/**
 * Get cluster by ID
 */
export async function getCluster(clusterId: string): Promise<IActorClusterDocument | null> {
  return ActorClusterModel.findOne({ clusterId }).lean();
}

/**
 * Get all clusters
 */
export async function getAllClusters(limit: number = 100): Promise<IActorClusterDocument[]> {
  return ActorClusterModel.find()
    .sort({ confidenceScore: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get cluster for a specific wallet
 */
export async function getWalletCluster(address: string, chain: string): Promise<IActorClusterDocument | null> {
  return findClusterByWallet(address, chain);
}

/**
 * Recompute all clusters (for cron job)
 */
export async function recomputeClusters(): Promise<{
  processed: number;
  created: number;
  updated: number;
  errors: number;
}> {
  const startTime = Date.now();
  console.log('[Clustering] Starting cluster recomputation...');
  
  const stats = {
    processed: 0,
    created: 0,
    updated: 0,
    errors: 0,
  };
  
  // For MVP, we'll implement incremental clustering
  // Full implementation would analyze watchlist items, actor profiles, etc.
  
  console.log(`[Clustering] Recomputation complete in ${Date.now() - startTime}ms`, stats);
  
  return stats;
}
