/**
 * Route Label Resolver (P0.3)
 * 
 * Resolves address labels for route endpoints.
 * Uses P0.2 Address Labels to identify exchanges, bridges, etc.
 */

import { 
  getLabel, 
  isExchangeAddress,
  type IAddressLabelDocument 
} from '../address_labels/address_labels.model.js';

// ============================================
// Types
// ============================================

export interface ResolvedLabel {
  address: string;
  chain: string;
  isKnown: boolean;
  name?: string;
  category?: string;
  isExchange: boolean;
  isBridge: boolean;
  entityName?: string;    // "Binance", "Stargate", etc.
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

export interface RouteEndpointLabels {
  start: ResolvedLabel;
  end: ResolvedLabel;
  intermediates: ResolvedLabel[];
}

// ============================================
// Core Functions
// ============================================

/**
 * Resolve label for a single address
 */
export async function resolveAddressLabel(
  chain: string,
  address: string
): Promise<ResolvedLabel> {
  const label = await getLabel(chain, address);
  
  if (!label) {
    return {
      address,
      chain,
      isKnown: false,
      isExchange: false,
      isBridge: false,
      confidence: 'NONE'
    };
  }
  
  const isExchange = ['CEX', 'DEX'].includes(label.category);
  const isBridge = label.category === 'BRIDGE';
  
  return {
    address,
    chain,
    isKnown: true,
    name: label.name,
    category: label.category,
    isExchange,
    isBridge,
    entityName: extractEntityName(label),
    confidence: label.confidence as 'HIGH' | 'MEDIUM' | 'LOW'
  };
}

/**
 * Resolve labels for all route endpoints
 */
export async function resolveRouteLabels(
  segments: Array<{ chainFrom: string; chainTo?: string; walletFrom: string; walletTo: string }>
): Promise<RouteEndpointLabels> {
  if (segments.length === 0) {
    throw new Error('No segments provided');
  }
  
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  
  // Resolve start and end
  const [start, end] = await Promise.all([
    resolveAddressLabel(firstSegment.chainFrom, firstSegment.walletFrom),
    resolveAddressLabel(
      lastSegment.chainTo || lastSegment.chainFrom, 
      lastSegment.walletTo
    )
  ]);
  
  // Resolve intermediates (unique addresses only)
  const intermediateAddresses = new Set<string>();
  for (const seg of segments) {
    const key1 = `${seg.chainFrom}:${seg.walletTo}`;
    const key2 = seg.chainTo ? `${seg.chainTo}:${seg.walletTo}` : null;
    
    if (seg.walletTo !== firstSegment.walletFrom && seg.walletTo !== lastSegment.walletTo) {
      intermediateAddresses.add(key1);
      if (key2) intermediateAddresses.add(key2);
    }
  }
  
  const intermediates: ResolvedLabel[] = [];
  for (const key of intermediateAddresses) {
    const [chain, address] = key.split(':');
    const label = await resolveAddressLabel(chain, address);
    if (label.isKnown) {
      intermediates.push(label);
    }
  }
  
  return { start, end, intermediates };
}

/**
 * Check if address is a known CEX
 */
export async function isCEXAddress(chain: string, address: string): Promise<boolean> {
  const result = await isExchangeAddress(chain, address);
  if (!result.isExchange) return false;
  
  // Check if it's specifically a CEX (not DEX)
  if (result.label?.category === 'CEX') {
    return true;
  }
  
  return false;
}

/**
 * Check if address is a known bridge
 */
export async function isBridgeAddress(chain: string, address: string): Promise<boolean> {
  const label = await getLabel(chain, address);
  return label?.category === 'BRIDGE';
}

/**
 * Get CEX name if address is exchange
 */
export async function getCEXName(chain: string, address: string): Promise<string | null> {
  const label = await getLabel(chain, address);
  if (!label || label.category !== 'CEX') return null;
  
  return extractEntityName(label);
}

// ============================================
// Helpers
// ============================================

/**
 * Extract clean entity name from label
 */
function extractEntityName(label: IAddressLabelDocument): string {
  // Remove common suffixes like "Hot Wallet", "Deposit", etc.
  const name = label.name
    .replace(/\s+(Hot|Cold|Deposit|Withdrawal|Router)\s*(Wallet)?/gi, '')
    .replace(/\s+\d+$/g, '')  // Remove trailing numbers
    .trim();
  
  return name || label.name;
}

/**
 * Batch resolve addresses for efficiency
 */
export async function batchResolveAddresses(
  addresses: Array<{ chain: string; address: string }>
): Promise<Map<string, ResolvedLabel>> {
  const results = new Map<string, ResolvedLabel>();
  
  // Process in parallel batches
  const batchSize = 20;
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const resolved = await Promise.all(
      batch.map(({ chain, address }) => resolveAddressLabel(chain, address))
    );
    
    for (let j = 0; j < batch.length; j++) {
      const key = `${batch[j].chain}:${batch[j].address.toLowerCase()}`;
      results.set(key, resolved[j]);
    }
  }
  
  return results;
}
