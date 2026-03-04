/**
 * Exchange Touch Detector (P0.5)
 * 
 * Detects CEX deposits/withdrawals using address_labels (P0.2).
 * Updates segments with CEX_DEPOSIT/CEX_WITHDRAW types.
 */

import { ISegmentV2, SegmentTypeV2, IRouteLabels } from '../storage/route_enriched.model.js';
import { AddressLabelModel } from '../../address_labels/address_labels.model.js';

// ============================================
// Types
// ============================================

export interface CEXDetectionResult {
  cexTouched: boolean;
  cexNames: string[];
  depositSegments: number[];
  withdrawSegments: number[];
}

// ============================================
// CEX Address Cache
// ============================================

const cexAddressCache = new Map<string, { isCEX: boolean; name?: string }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let lastCacheRefresh = 0;

/**
 * Refresh CEX address cache
 */
async function refreshCEXCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL_MS && cexAddressCache.size > 0) return;
  
  cexAddressCache.clear();
  
  // Get CEX labels from address_labels
  const labels = await AddressLabelModel.find({ 
    category: 'CEX'
  }).lean();
  
  for (const label of labels) {
    const key = `${label.chain}:${label.address.toLowerCase()}`;
    cexAddressCache.set(key, { isCEX: true, name: label.name });
  }
  
  // Also include known hardcoded CEX addresses
  const knownCEX: Record<string, string> = {
    // Binance
    '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
    // Coinbase
    '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase',
    // Kraken
    '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': 'Kraken',
    // OKX
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
    // Bybit
    '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit'
  };
  
  for (const [address, name] of Object.entries(knownCEX)) {
    // Add for all chains
    for (const chain of ['ETH', 'ARB', 'OP', 'BASE']) {
      const key = `${chain}:${address.toLowerCase()}`;
      if (!cexAddressCache.has(key)) {
        cexAddressCache.set(key, { isCEX: true, name });
      }
    }
  }
  
  lastCacheRefresh = now;
  console.log(`[ExchangeTouchDetector] Refreshed CEX cache: ${cexAddressCache.size} addresses`);
}

/**
 * Check if address is CEX
 */
export async function checkCEXAddress(chain: string, address: string): Promise<{ isCEX: boolean; name?: string }> {
  await refreshCEXCache();
  
  const key = `${chain}:${address.toLowerCase()}`;
  return cexAddressCache.get(key) || { isCEX: false };
}

// ============================================
// Main Detection
// ============================================

/**
 * Detect CEX touches in segments
 */
export async function detectCEXTouches(segments: ISegmentV2[]): Promise<CEXDetectionResult> {
  const result: CEXDetectionResult = {
    cexTouched: false,
    cexNames: [],
    depositSegments: [],
    withdrawSegments: []
  };
  
  const cexNamesSet = new Set<string>();
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Check destination (deposit)
    const toCheck = await checkCEXAddress(segment.chainFrom, segment.walletTo);
    if (toCheck.isCEX) {
      result.cexTouched = true;
      result.depositSegments.push(i);
      if (toCheck.name) {
        cexNamesSet.add(toCheck.name);
        segment.toLabel = toCheck.name;
      }
      // Update segment type
      segment.type = 'CEX_DEPOSIT';
    }
    
    // Check source (withdrawal)
    const fromCheck = await checkCEXAddress(segment.chainFrom, segment.walletFrom);
    if (fromCheck.isCEX) {
      result.cexTouched = true;
      result.withdrawSegments.push(i);
      if (fromCheck.name) {
        cexNamesSet.add(fromCheck.name);
        segment.fromLabel = fromCheck.name;
      }
      // If not already a deposit, mark as withdrawal
      if (segment.type !== 'CEX_DEPOSIT') {
        segment.type = 'CEX_WITHDRAW';
      }
    }
  }
  
  result.cexNames = Array.from(cexNamesSet);
  
  return result;
}

/**
 * Update segments with CEX detection
 */
export async function enrichSegmentsWithCEX(segments: ISegmentV2[]): Promise<{
  segments: ISegmentV2[];
  labels: Partial<IRouteLabels>;
}> {
  const detection = await detectCEXTouches(segments);
  
  return {
    segments,
    labels: {
      cexTouched: detection.cexTouched,
      cexNames: detection.cexNames
    }
  };
}

/**
 * Check if route ends at CEX
 */
export async function routeEndsCEX(segments: ISegmentV2[]): Promise<{
  endsCEX: boolean;
  cexName?: string;
}> {
  if (segments.length === 0) {
    return { endsCEX: false };
  }
  
  const lastSegment = segments[segments.length - 1];
  const check = await checkCEXAddress(
    lastSegment.chainTo || lastSegment.chainFrom,
    lastSegment.walletTo
  );
  
  return {
    endsCEX: check.isCEX,
    cexName: check.name
  };
}

/**
 * Get CEX deposit count
 */
export function countCEXDeposits(segments: ISegmentV2[]): number {
  return segments.filter(s => s.type === 'CEX_DEPOSIT').length;
}

/**
 * Get CEX withdrawal count
 */
export function countCEXWithdrawals(segments: ISegmentV2[]): number {
  return segments.filter(s => s.type === 'CEX_WITHDRAW').length;
}

export { refreshCEXCache };
