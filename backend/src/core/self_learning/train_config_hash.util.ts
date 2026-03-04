/**
 * Train Config Hash Utility
 * 
 * ETAP 5.3: Deterministic hash of training configuration.
 * Ensures reproducibility - same config = same hash.
 */
import { createHash } from 'crypto';

/**
 * Generate deterministic hash from training config
 */
export function hashTrainConfig(config: Record<string, any>): string {
  // Sort keys for determinism
  const sortedConfig = sortObject(config);
  const jsonStr = JSON.stringify(sortedConfig);
  
  return createHash('sha256')
    .update(jsonStr)
    .digest('hex')
    .slice(0, 16); // Short hash for readability
}

/**
 * Recursively sort object keys
 */
function sortObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  }
  
  const sorted: Record<string, any> = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = sortObject(obj[key]);
  });
  
  return sorted;
}

/**
 * Verify config matches hash
 */
export function verifyConfigHash(config: Record<string, any>, expectedHash: string): boolean {
  return hashTrainConfig(config) === expectedHash;
}
