/**
 * Engine V2: Coverage Features Builder
 * 
 * Extracts CoverageFeatures from D1 signals
 */
import type { D1Signal } from '../d1_signals/d1_signal.types.js';
import { CoverageFeatures, emptyFeatures } from './coverage_features.js';

/**
 * Build coverage features from signals array
 */
export function buildCoverageFeatures(signals: D1Signal[]): CoverageFeatures {
  if (!signals || signals.length === 0) {
    return emptyFeatures();
  }
  
  let activeCount = 0;
  let newCount = 0;
  let coolingCount = 0;
  
  let clustersSum = 0;
  let clusterPassedCount = 0;
  let dominanceSum = 0;
  let dominanceCount = 0;
  
  let sourceGroupsSum = 0;
  const actorTypes = new Set<string>();
  const uniqueActors = new Set<string>();
  
  let penaltiesCount = 0;
  let highConfidenceCount = 0;
  
  for (const signal of signals) {
    // Status counts
    if (signal.status === 'active') activeCount++;
    else if (signal.status === 'new') newCount++;
    else if (signal.status === 'cooling') coolingCount++;
    
    // Confidence
    if (signal.confidence === 'high') highConfidenceCount++;
    
    // Cluster confirmation (from evidence.topEdges if available)
    const topEdges = signal.evidence?.topEdges ?? [];
    if (topEdges.length > 0) {
      clustersSum += topEdges.length;
      
      // Check if cluster passed (at least one high confidence edge)
      const hasHighConfidence = topEdges.some(e => e.confidence === 'high');
      if (hasHighConfidence) clusterPassedCount++;
      
      // Calculate average dominance from edges
      for (const edge of topEdges) {
        if (typeof edge.weight === 'number') {
          dominanceSum += Math.min(1, edge.weight);
          dominanceCount++;
        }
      }
    }
    
    // Source groups from evidence
    const sourceGroups = signal.evidence?.current?.window ? 1 : 0;
    sourceGroupsSum += sourceGroups;
    
    // Actor types and unique actors from entities
    for (const entity of signal.entities ?? []) {
      if (entity.kind === 'actor') {
        uniqueActors.add(entity.id);
        if (entity.type) actorTypes.add(entity.type);
      }
    }
    
    // Primary/secondary actors
    if (signal.primary?.kind === 'actor') {
      uniqueActors.add(signal.primary.id);
      if (signal.primary.type) actorTypes.add(signal.primary.type);
    }
    if (signal.secondary?.kind === 'actor') {
      uniqueActors.add(signal.secondary.id);
      if (signal.secondary.type) actorTypes.add(signal.secondary.type);
    }
    
    // Check for penalties in tags or severity
    if (signal.severity === 'low' || signal.confidence === 'low') {
      penaltiesCount++;
    }
  }
  
  const n = signals.length;
  
  return {
    totalSignals: n,
    activeSignals: activeCount,
    newSignals: newCount,
    coolingSignals: coolingCount,
    
    clustersCountAvg: clustersSum / n,
    clusterPassRate: clusterPassedCount / n,
    avgDominance: dominanceCount > 0 ? dominanceSum / dominanceCount : 1,
    
    sourceGroupsAvg: sourceGroupsSum / n,
    actorTypesCount: actorTypes.size,
    uniqueActors: uniqueActors.size,
    
    penaltyRate: penaltiesCount / n,
    highConfidenceRate: highConfidenceCount / n,
    
    lifecycleActiveRate: activeCount / n,
    
    contextsAvailable: 0, // Future: integrate with contexts
  };
}
