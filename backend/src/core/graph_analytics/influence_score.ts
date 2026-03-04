/**
 * Influence Score Calculator - ETAP D2
 * 
 * Calculates node influence score based on:
 * - Volume (total in + out)
 * - Hub score (unique counterparties)
 * - Activity (transaction count)
 * - Recency (how recent is last activity)
 * 
 * Score is 0-1, used for node sizing in graph.
 */

/**
 * Weights for influence calculation
 */
const INFLUENCE_WEIGHTS = {
  VOLUME: 0.40,    // Total volume dominates
  HUB: 0.30,       // Connectivity matters
  ACTIVITY: 0.20,  // Transaction frequency
  RECENCY: 0.10,   // Recent activity bonus
};

/**
 * Normalizer for final score
 * Adjust based on data distribution
 */
const NORMALIZER = 20;

/**
 * Calculate influence score for a node
 * 
 * @param node - Node with analytics data
 * @returns influenceScore 0-1
 */
export function calculateInfluenceScore(node: {
  totalVolumeUsd: number;
  hubScore: number;
  txCount: number;
  lastSeen?: Date | number;
}): number {
  // Volume component (log scale to handle huge differences)
  const volumeComponent = Math.log1p(node.totalVolumeUsd);
  
  // Hub component (log scale)
  const hubComponent = Math.log1p(node.hubScore);
  
  // Activity component (log scale)
  const activityComponent = Math.log1p(node.txCount);
  
  // Recency component (exponential decay over 30 days)
  let recencyComponent = 0.5; // default if no lastSeen
  if (node.lastSeen) {
    const lastSeenTime = typeof node.lastSeen === 'number' 
      ? node.lastSeen 
      : new Date(node.lastSeen).getTime();
    const daysSinceLast = (Date.now() - lastSeenTime) / (24 * 60 * 60 * 1000);
    recencyComponent = Math.exp(-daysSinceLast / 30);
  }
  
  // Weighted sum
  const rawScore = 
    volumeComponent * INFLUENCE_WEIGHTS.VOLUME +
    hubComponent * INFLUENCE_WEIGHTS.HUB +
    activityComponent * INFLUENCE_WEIGHTS.ACTIVITY +
    recencyComponent * INFLUENCE_WEIGHTS.RECENCY;
  
  // Normalize to 0-1
  return clamp(rawScore / NORMALIZER, 0, 1);
}

/**
 * Calculate activity score
 * 
 * @param node - Node with activity data
 * @returns activityScore 0-1
 */
export function calculateActivityScore(node: {
  txCount: number;
  firstSeen?: Date | number;
  lastSeen?: Date | number;
}): number {
  // Transaction frequency
  let txFrequency = 0;
  if (node.firstSeen && node.lastSeen) {
    const firstTime = typeof node.firstSeen === 'number' 
      ? node.firstSeen 
      : new Date(node.firstSeen).getTime();
    const lastTime = typeof node.lastSeen === 'number' 
      ? node.lastSeen 
      : new Date(node.lastSeen).getTime();
    const daySpan = Math.max(1, (lastTime - firstTime) / (24 * 60 * 60 * 1000));
    txFrequency = node.txCount / daySpan;
  }
  
  // Normalize (assuming 1 tx/day is "active")
  return clamp(Math.log1p(txFrequency) / 2, 0, 1);
}

/**
 * Calculate recency score
 * 
 * @param lastSeen - Last seen date
 * @returns recencyScore 0-1 (1 = very recent)
 */
export function calculateRecencyScore(lastSeen?: Date | number): number {
  if (!lastSeen) return 0.5;
  
  const lastSeenTime = typeof lastSeen === 'number' 
    ? lastSeen 
    : new Date(lastSeen).getTime();
  const daysSinceLast = (Date.now() - lastSeenTime) / (24 * 60 * 60 * 1000);
  
  // Exponential decay: half-life of ~20 days
  return Math.exp(-daysSinceLast / 20);
}

/**
 * Derive all analytics from raw aggregated data
 */
export function deriveNodeAnalytics(raw: {
  address: string;
  network: string;
  inVolumeUsd?: number;
  outVolumeUsd?: number;
  inTxCount?: number;
  outTxCount?: number;
  uniqueInDegree?: number;
  uniqueOutDegree?: number;
  firstSeen?: Date;
  lastSeen?: Date;
  entityType?: string;
  entityName?: string;
  tags?: string[];
}) {
  const inVolumeUsd = raw.inVolumeUsd || 0;
  const outVolumeUsd = raw.outVolumeUsd || 0;
  const inTxCount = raw.inTxCount || 0;
  const outTxCount = raw.outTxCount || 0;
  const uniqueInDegree = raw.uniqueInDegree || 0;
  const uniqueOutDegree = raw.uniqueOutDegree || 0;
  
  // Derived values
  const totalVolumeUsd = inVolumeUsd + outVolumeUsd;
  const netFlowUsd = outVolumeUsd - inVolumeUsd;
  const txCount = inTxCount + outTxCount;
  const hubScore = uniqueInDegree + uniqueOutDegree;
  
  // Scores
  const influenceScore = calculateInfluenceScore({
    totalVolumeUsd,
    hubScore,
    txCount,
    lastSeen: raw.lastSeen,
  });
  
  const activityScore = calculateActivityScore({
    txCount,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
  });
  
  const recencyScore = calculateRecencyScore(raw.lastSeen);
  
  return {
    address: raw.address.toLowerCase(),
    network: raw.network.toLowerCase(),
    
    // Volumes
    inVolumeUsd,
    outVolumeUsd,
    totalVolumeUsd,
    netFlowUsd,
    
    // Counts
    inTxCount,
    outTxCount,
    txCount,
    
    // Topology
    uniqueInDegree,
    uniqueOutDegree,
    hubScore,
    
    // Time
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    recencyScore,
    
    // Scores
    influenceScore,
    activityScore,
    
    // Entity
    entityType: raw.entityType,
    entityName: raw.entityName,
    tags: raw.tags || [],
  };
}

/**
 * Clamp value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
