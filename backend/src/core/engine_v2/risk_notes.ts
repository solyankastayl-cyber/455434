/**
 * Engine V2: Risk Notes Builder
 * 
 * Generates human-readable risk notes matching UI tone
 */
import type { CoverageFeatures } from './coverage_features.js';

/**
 * Build risk notes for UI display
 * 
 * These match the current UI tone:
 * - "Critical low coverage"
 * - "Single actor source"
 * - "No contexts available"
 * etc.
 */
export function buildRiskNotes(
  features: CoverageFeatures, 
  coverageNotes: string[]
): string[] {
  const notes: string[] = [];
  
  // Coverage-derived notes
  if (coverageNotes.includes('low_coverage')) {
    notes.push('Critical low coverage');
  }
  
  if (coverageNotes.includes('single_source') || coverageNotes.includes('single_actor_source')) {
    notes.push('Single actor source');
  }
  
  if (coverageNotes.includes('no_contexts')) {
    notes.push('No contexts available');
  }
  
  if (coverageNotes.includes('weak_cluster_confirmation')) {
    notes.push('Cluster confirmation weak');
  }
  
  // Feature-derived notes
  if (features.penaltyRate > 0.3) {
    notes.push('High penalty rate');
  }
  
  if (features.clusterPassRate < 0.5 && features.totalSignals > 0) {
    notes.push('Cluster pass rate below threshold');
  }
  
  if (features.avgDominance > 0.85) {
    notes.push('High dominance concentration');
  }
  
  if (features.highConfidenceRate < 0.2 && features.totalSignals > 0) {
    notes.push('Low confidence signal quality');
  }
  
  if (features.totalSignals === 0) {
    notes.push('No signals available');
  }
  
  return notes;
}
