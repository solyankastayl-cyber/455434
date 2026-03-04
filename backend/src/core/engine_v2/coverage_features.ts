/**
 * Engine V2: Coverage Features
 * 
 * Extracted metrics from signals for coverage/risk calculation
 */

export interface CoverageFeatures {
  // Signal counts
  totalSignals: number;
  activeSignals: number;
  newSignals: number;
  coolingSignals: number;
  
  // Cluster metrics
  clustersCountAvg: number;
  clusterPassRate: number;
  avgDominance: number;
  
  // Source diversity
  sourceGroupsAvg: number;
  actorTypesCount: number;
  uniqueActors: number;
  
  // Quality metrics
  penaltyRate: number;
  highConfidenceRate: number;
  
  // Lifecycle
  lifecycleActiveRate: number;
  
  // Contexts (future integration)
  contextsAvailable: number;
}

/**
 * Empty features for no-signal case
 */
export function emptyFeatures(): CoverageFeatures {
  return {
    totalSignals: 0,
    activeSignals: 0,
    newSignals: 0,
    coolingSignals: 0,
    clustersCountAvg: 0,
    clusterPassRate: 0,
    avgDominance: 1, // Worst case default
    sourceGroupsAvg: 0,
    actorTypesCount: 0,
    uniqueActors: 0,
    penaltyRate: 0,
    highConfidenceRate: 0,
    lifecycleActiveRate: 0,
    contextsAvailable: 0,
  };
}
