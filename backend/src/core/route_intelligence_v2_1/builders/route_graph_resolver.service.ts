/**
 * Route Graph Resolver (P0.5)
 * 
 * Normalizes and resolves route graph:
 * - Sorts segments by timestamp
 * - Removes duplicates
 * - Protects against loops
 * - Merges consecutive transfers
 */

import { ISegmentV2 } from '../storage/route_enriched.model.js';

// ============================================
// Config
// ============================================

const RESOLVER_CONFIG = {
  maxHops: 50,
  mergeTimeWindowMs: 60 * 1000, // 1 minute - merge transfers within this window
  loopDetectionThreshold: 3    // Max times same address can appear
};

// ============================================
// Types
// ============================================

export interface ResolvedRoute {
  segments: ISegmentV2[];
  normalized: boolean;
  loopsDetected: boolean;
  mergedCount: number;
  removedDuplicates: number;
}

// ============================================
// Main Resolver
// ============================================

/**
 * Resolve and normalize route graph
 */
export function resolveRouteGraph(segments: ISegmentV2[]): ResolvedRoute {
  if (segments.length === 0) {
    return {
      segments: [],
      normalized: true,
      loopsDetected: false,
      mergedCount: 0,
      removedDuplicates: 0
    };
  }
  
  // Step 1: Sort by timestamp
  const sorted = sortByTimestamp(segments);
  
  // Step 2: Remove duplicates (same txHash + logIndex)
  const { unique, removed: removedDuplicates } = removeDuplicates(sorted);
  
  // Step 3: Detect and handle loops
  const { filtered, loopsDetected } = handleLoops(unique);
  
  // Step 4: Merge consecutive similar transfers
  const { merged, mergedCount } = mergeConsecutiveTransfers(filtered);
  
  // Step 5: Reindex
  const reindexed = reindex(merged);
  
  return {
    segments: reindexed,
    normalized: true,
    loopsDetected,
    mergedCount,
    removedDuplicates
  };
}

// ============================================
// Sorting
// ============================================

/**
 * Sort segments by timestamp
 */
function sortByTimestamp(segments: ISegmentV2[]): ISegmentV2[] {
  return [...segments].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) return timeA - timeB;
    // Same timestamp - sort by block number
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    // Same block - maintain original index
    return a.index - b.index;
  });
}

// ============================================
// Deduplication
// ============================================

/**
 * Remove duplicate segments (same tx)
 */
function removeDuplicates(segments: ISegmentV2[]): { unique: ISegmentV2[]; removed: number } {
  const seen = new Set<string>();
  const unique: ISegmentV2[] = [];
  
  for (const segment of segments) {
    const key = `${segment.txHash}:${segment.walletFrom}:${segment.walletTo}:${segment.amount}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(segment);
    }
  }
  
  return {
    unique,
    removed: segments.length - unique.length
  };
}

// ============================================
// Loop Detection
// ============================================

/**
 * Detect and handle loops (same address appearing too many times)
 */
function handleLoops(segments: ISegmentV2[]): { filtered: ISegmentV2[]; loopsDetected: boolean } {
  const addressCount = new Map<string, number>();
  let loopsDetected = false;
  
  // Count address appearances
  for (const segment of segments) {
    const fromCount = (addressCount.get(segment.walletFrom) || 0) + 1;
    const toCount = (addressCount.get(segment.walletTo) || 0) + 1;
    
    addressCount.set(segment.walletFrom, fromCount);
    addressCount.set(segment.walletTo, toCount);
    
    if (fromCount > RESOLVER_CONFIG.loopDetectionThreshold || 
        toCount > RESOLVER_CONFIG.loopDetectionThreshold) {
      loopsDetected = true;
    }
  }
  
  // If loops detected, trim to max hops
  if (loopsDetected && segments.length > RESOLVER_CONFIG.maxHops) {
    return {
      filtered: segments.slice(0, RESOLVER_CONFIG.maxHops),
      loopsDetected: true
    };
  }
  
  return { filtered: segments, loopsDetected };
}

// ============================================
// Merging
// ============================================

/**
 * Merge consecutive similar transfers
 */
function mergeConsecutiveTransfers(segments: ISegmentV2[]): { merged: ISegmentV2[]; mergedCount: number } {
  if (segments.length <= 1) {
    return { merged: segments, mergedCount: 0 };
  }
  
  const merged: ISegmentV2[] = [];
  let mergedCount = 0;
  let current: ISegmentV2 | null = null;
  
  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
      continue;
    }
    
    // Check if should merge
    if (shouldMerge(current, segment)) {
      // Merge amounts
      try {
        const currentAmount = BigInt(current.amount);
        const segmentAmount = BigInt(segment.amount);
        current.amount = (currentAmount + segmentAmount).toString();
        current.amountUsd = (current.amountUsd || 0) + (segment.amountUsd || 0);
      } catch {
        // If BigInt fails, just add
        current.amountUsd = (current.amountUsd || 0) + (segment.amountUsd || 0);
      }
      
      // Update end info
      current.walletTo = segment.walletTo;
      current.toLabel = segment.toLabel;
      
      mergedCount++;
    } else {
      merged.push(current);
      current = { ...segment };
    }
  }
  
  // Push last segment
  if (current) {
    merged.push(current);
  }
  
  return { merged, mergedCount };
}

/**
 * Check if two segments should be merged
 */
function shouldMerge(a: ISegmentV2, b: ISegmentV2): boolean {
  // Only merge TRANSFERs
  if (a.type !== 'TRANSFER' || b.type !== 'TRANSFER') {
    return false;
  }
  
  // Same chain
  if (a.chainFrom !== b.chainFrom) {
    return false;
  }
  
  // Sequential (a.to === b.from)
  if (a.walletTo.toLowerCase() !== b.walletFrom.toLowerCase()) {
    return false;
  }
  
  // Same token
  if (a.tokenAddress.toLowerCase() !== b.tokenAddress.toLowerCase()) {
    return false;
  }
  
  // Within time window
  const timeDiff = Math.abs(
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  if (timeDiff > RESOLVER_CONFIG.mergeTimeWindowMs) {
    return false;
  }
  
  return true;
}

// ============================================
// Reindexing
// ============================================

/**
 * Reindex segments sequentially
 */
function reindex(segments: ISegmentV2[]): ISegmentV2[] {
  return segments.map((segment, index) => ({
    ...segment,
    index
  }));
}

// ============================================
// Analysis Helpers
// ============================================

/**
 * Get unique chains in route
 */
export function getUniqueChains(segments: ISegmentV2[]): string[] {
  const chains = new Set<string>();
  
  for (const segment of segments) {
    chains.add(segment.chainFrom);
    if (segment.chainTo) {
      chains.add(segment.chainTo);
    }
  }
  
  return Array.from(chains);
}

/**
 * Get unique counterparties
 */
export function getUniqueCounterparties(segments: ISegmentV2[], excludeWallet: string): string[] {
  const addresses = new Set<string>();
  const excluded = excludeWallet.toLowerCase();
  
  for (const segment of segments) {
    if (segment.walletFrom.toLowerCase() !== excluded) {
      addresses.add(segment.walletFrom.toLowerCase());
    }
    if (segment.walletTo.toLowerCase() !== excluded) {
      addresses.add(segment.walletTo.toLowerCase());
    }
  }
  
  return Array.from(addresses);
}

/**
 * Get segment type counts
 */
export function getSegmentTypeCounts(segments: ISegmentV2[]): Record<string, number> {
  const counts: Record<string, number> = {};
  
  for (const segment of segments) {
    counts[segment.type] = (counts[segment.type] || 0) + 1;
  }
  
  return counts;
}

/**
 * Calculate route duration
 */
export function getRouteDuration(segments: ISegmentV2[]): number {
  if (segments.length < 2) return 0;
  
  const first = new Date(segments[0].timestamp).getTime();
  const last = new Date(segments[segments.length - 1].timestamp).getTime();
  
  return last - first;
}

export { RESOLVER_CONFIG };
