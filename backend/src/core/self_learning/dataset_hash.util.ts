/**
 * Dataset Hash Utility
 * 
 * ETAP 5.2: Deterministic hashing for dataset versioning.
 * Ensures reproducibility and integrity verification.
 */
import { createHash } from 'crypto';
import type { DatasetVersionFilters } from './self_learning.types.js';

/**
 * Generate deterministic hash for dataset content
 * 
 * Hash is based on:
 * - Sorted sample IDs
 * - Normalized filters
 * - Horizon
 * 
 * This ensures same samples + filters = same hash
 */
export function generateDatasetHash(
  sampleIds: string[],
  filters: DatasetVersionFilters,
  horizon: string
): string {
  // Sort sample IDs for determinism
  const sortedIds = [...sampleIds].sort();
  
  // Normalize filters
  const normalizedFilters = normalizeFilters(filters);
  
  // Create hash input
  const hashInput = JSON.stringify({
    sampleIds: sortedIds,
    filters: normalizedFilters,
    horizon,
  });
  
  // Generate SHA256 hash
  return createHash('sha256')
    .update(hashInput)
    .digest('hex');
}

/**
 * Normalize filters for consistent hashing
 */
function normalizeFilters(filters: DatasetVersionFilters): DatasetVersionFilters {
  return {
    trainEligible: filters.trainEligible,
    trends: [...filters.trends].sort(),
    driftLevels: [...filters.driftLevels].sort(),
    minConfidence: filters.minConfidence,
  };
}

/**
 * Generate dataset version ID
 */
export function generateDatasetVersionId(horizon: string): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  
  return `ds_${horizon}_${timestamp}`;
}

/**
 * Verify dataset integrity by comparing hashes
 */
export function verifyDatasetIntegrity(
  sampleIds: string[],
  filters: DatasetVersionFilters,
  horizon: string,
  expectedHash: string
): { valid: boolean; computedHash: string } {
  const computedHash = generateDatasetHash(sampleIds, filters, horizon);
  return {
    valid: computedHash === expectedHash,
    computedHash,
  };
}

/**
 * Generate short hash for display (first 8 chars)
 */
export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}
