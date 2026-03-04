/**
 * Engine V2: Engine Status
 * 
 * Determines overall engine health status for UI banner
 */

export type EngineStatus =
  | 'DATA_COLLECTION_MODE'
  | 'PROTECTION_MODE'
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'CRITICAL';

/**
 * Compute engine status from scores and drift
 */
export function computeEngineStatus(
  coverage: number,
  risk: number,
  driftFlags: string[],
  minCoverageToTrade: number
): EngineStatus {
  // Critical drift conditions
  const criticalDrift = driftFlags.some(f => 
    f.includes('collapse') || 
    f.includes('extreme') ||
    f === 'no_data'
  );
  
  if (criticalDrift) {
    return 'CRITICAL';
  }
  
  // Not enough coverage → data collection mode
  if (coverage < minCoverageToTrade) {
    return 'DATA_COLLECTION_MODE';
  }
  
  // High risk → protection mode
  if (risk >= 75) {
    return 'PROTECTION_MODE';
  }
  
  // Any drift flags → degraded
  if (driftFlags.length > 0) {
    return 'DEGRADED';
  }
  
  return 'OPERATIONAL';
}
