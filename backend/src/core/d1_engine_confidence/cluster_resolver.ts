/**
 * P2.B.2 — Cluster Resolver
 * 
 * Unified cluster ID resolution with strict priority:
 * 1. entityId (known entity: fund, exchange, MM)
 * 2. ownerId (known owner/controller)
 * 3. communityId (graph-based cluster)
 * 4. infrastructureId (CEX hotwallets, bridges)
 * 5. actorId (fallback - each actor is own cluster)
 */

import type { ActorForCluster, ClusterResolutionTrace } from './cluster_confirmation.types.js';

// Infrastructure cluster mappings (can be loaded from config)
const INFRASTRUCTURE_CLUSTERS: Record<string, string[]> = {
  'binance_hotwallets': [
    '0x28c6c06298d514db089934071355e5743bf21d60',
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
  ],
  'okx_hotwallets': [
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
  ],
  'coinbase_hotwallets': [
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
  ],
  'arbitrum_bridge': [
    '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a',
  ],
  'optimism_bridge': [
    '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1',
  ],
};

/**
 * Check if wallet belongs to known infrastructure
 */
function resolveInfrastructureId(walletAddress?: string): string | undefined {
  if (!walletAddress) return undefined;
  
  const normalized = walletAddress.toLowerCase();
  
  for (const [infraId, addresses] of Object.entries(INFRASTRUCTURE_CLUSTERS)) {
    if (addresses.some(addr => addr.toLowerCase() === normalized)) {
      return infraId;
    }
  }
  
  return undefined;
}

/**
 * Resolve cluster ID for an actor with strict priority
 * 
 * Priority: entityId > ownerId > communityId > infrastructureId > actorId
 */
export function resolveClusterId(actor: ActorForCluster): {
  clusterId: string;
  clusterType: 'entity' | 'owner' | 'community' | 'infra' | 'actor';
} {
  // Priority 1: Known entity
  if (actor.entityId) {
    return {
      clusterId: `entity:${actor.entityId}`,
      clusterType: 'entity',
    };
  }
  
  // Priority 2: Known owner
  if (actor.ownerId) {
    return {
      clusterId: `owner:${actor.ownerId}`,
      clusterType: 'owner',
    };
  }
  
  // Priority 3: Graph community cluster
  if (actor.communityId) {
    return {
      clusterId: `community:${actor.communityId}`,
      clusterType: 'community',
    };
  }
  
  // Priority 4: Infrastructure cluster
  const infraId = actor.infrastructureId || resolveInfrastructureId(actor.actorId);
  if (infraId) {
    return {
      clusterId: `infra:${infraId}`,
      clusterType: 'infra',
    };
  }
  
  // Priority 5: Fallback - each actor is own cluster
  return {
    clusterId: `actor:${actor.actorId}`,
    clusterType: 'actor',
  };
}

/**
 * Resolve community ID based on graph properties
 * Used when entityId and ownerId are not available
 */
export function resolveCommunityId(actor: {
  fundingSource?: string;
  hubId?: string;
  dominantCounterparty?: string;
}): string | undefined {
  // Priority: fundingSource > hubId > dominantCounterparty
  if (actor.fundingSource) {
    return `funding:${actor.fundingSource}`;
  }
  
  if (actor.hubId) {
    return `hub:${actor.hubId}`;
  }
  
  if (actor.dominantCounterparty) {
    return `counterparty:${actor.dominantCounterparty}`;
  }
  
  return undefined;
}

/**
 * Build resolution trace for explainability
 */
export function buildResolutionTrace(actors: ActorForCluster[]): ClusterResolutionTrace[] {
  return actors.map(actor => {
    const { clusterId, clusterType } = resolveClusterId(actor);
    
    let reason: ClusterResolutionTrace['reason'];
    switch (clusterType) {
      case 'entity': reason = 'entity'; break;
      case 'owner': reason = 'owner'; break;
      case 'community': reason = 'community'; break;
      case 'infra': reason = 'infra'; break;
      default: reason = 'fallback';
    }
    
    return {
      actorId: actor.actorId,
      clusterId,
      reason,
    };
  });
}
