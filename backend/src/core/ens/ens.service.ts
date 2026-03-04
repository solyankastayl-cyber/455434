/**
 * ENS Service (P2.2 Step 1)
 * 
 * Ethereum Name Service resolution.
 * Features:
 * - Forward resolution: vitalik.eth → 0x...
 * - Reverse resolution: 0x... → vitalik.eth
 * - Caching for performance
 * - Never throws - always returns result with confidence
 * 
 * IMPORTANT: ENS works ONLY on Ethereum mainnet
 */
import { ethers } from 'ethers';

// Configuration - read directly from process.env to avoid env.ts dependency
const ENS_ENABLED = process.env.ENS_ENABLED !== 'false'; // enabled by default
const ETHEREUM_RPC_URL = process.env.INFURA_RPC_URL || process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com';

console.log('[ENS] Service initializing with RPC:', ETHEREUM_RPC_URL.substring(0, 30) + '...');

// Cache TTL
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const forwardCache = new Map<string, CacheEntry<ENSResolveResult>>();
const reverseCache = new Map<string, CacheEntry<ENSReverseResult>>();

// Provider (lazy initialized)
let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider | null {
  if (!ENS_ENABLED) {
    console.log('[ENS] Service disabled');
    return null;
  }
  
  if (!ETHEREUM_RPC_URL || !ETHEREUM_RPC_URL.startsWith('http')) {
    console.warn('[ENS] No valid RPC URL configured (INFURA_RPC_URL)');
    return null;
  }
  
  if (!provider) {
    try {
      provider = new ethers.JsonRpcProvider(ETHEREUM_RPC_URL);
      console.log('[ENS] Provider initialized with:', ETHEREUM_RPC_URL.substring(0, 40) + '...');
    } catch (err) {
      console.error('[ENS] Failed to create provider:', err);
      return null;
    }
  }
  
  return provider;
}

// Result types
export interface ENSResolveResult {
  address: string | null;
  confidence: number;
  reason: string;
  cached?: boolean;
}

export interface ENSReverseResult {
  name: string | null;
  confidence: number;
  reason: string;
  cached?: boolean;
}

/**
 * Resolve ENS name to address
 * 
 * @param name - ENS name (e.g., 'vitalik.eth')
 * @returns { address, confidence, reason }
 */
export async function resolveENS(name: string): Promise<ENSResolveResult> {
  const normalizedName = name.toLowerCase().trim();
  
  // Validate ENS format
  if (!normalizedName.endsWith('.eth')) {
    return {
      address: null,
      confidence: 0,
      reason: 'Invalid ENS format. Must end with .eth',
    };
  }
  
  // Check cache
  const cached = forwardCache.get(normalizedName);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }
  
  // Check if ENS is enabled
  const rpcProvider = getProvider();
  if (!rpcProvider) {
    return {
      address: null,
      confidence: 0.1,
      reason: 'ENS resolution not available (service disabled or misconfigured)',
    };
  }
  
  try {
    console.log(`[ENS] Resolving: ${normalizedName}`);
    
    const address = await rpcProvider.resolveName(normalizedName);
    
    if (address) {
      const result: ENSResolveResult = {
        address: address.toLowerCase(),
        confidence: 0.9,
        reason: `ENS resolved on Ethereum mainnet`,
      };
      
      // Cache result
      forwardCache.set(normalizedName, {
        value: result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      
      console.log(`[ENS] Resolved ${normalizedName} → ${address}`);
      return result;
    } else {
      const result: ENSResolveResult = {
        address: null,
        confidence: 0.1,
        reason: 'ENS name exists but has no address record',
      };
      
      // Cache negative result (shorter TTL)
      forwardCache.set(normalizedName, {
        value: result,
        expiresAt: Date.now() + CACHE_TTL_MS / 2,
      });
      
      return result;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ENS] Resolution error for ${normalizedName}:`, errorMessage);
    
    // Don't cache errors
    return {
      address: null,
      confidence: 0,
      reason: `ENS resolution failed: ${errorMessage}`,
    };
  }
}

/**
 * Reverse resolve address to ENS name
 * 
 * @param address - Ethereum address
 * @returns { name, confidence, reason }
 */
export async function reverseENS(address: string): Promise<ENSReverseResult> {
  // Validate address format
  if (!ethers.isAddress(address)) {
    return {
      name: null,
      confidence: 0,
      reason: 'Invalid Ethereum address format',
    };
  }
  
  const normalizedAddress = address.toLowerCase();
  
  // Check cache
  const cached = reverseCache.get(normalizedAddress);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }
  
  // Check if ENS is enabled
  const rpcProvider = getProvider();
  if (!rpcProvider) {
    return {
      name: null,
      confidence: 0.1,
      reason: 'ENS reverse lookup not available (service disabled)',
    };
  }
  
  try {
    console.log(`[ENS] Reverse lookup: ${normalizedAddress}`);
    
    const name = await rpcProvider.lookupAddress(address);
    
    if (name) {
      const result: ENSReverseResult = {
        name: name.toLowerCase(),
        confidence: 0.8,
        reason: 'Reverse ENS record found on Ethereum mainnet',
      };
      
      // Cache result
      reverseCache.set(normalizedAddress, {
        value: result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      
      console.log(`[ENS] Reverse: ${normalizedAddress} → ${name}`);
      return result;
    } else {
      const result: ENSReverseResult = {
        name: null,
        confidence: 0,
        reason: 'No reverse ENS record for this address',
      };
      
      // Cache negative result
      reverseCache.set(normalizedAddress, {
        value: result,
        expiresAt: Date.now() + CACHE_TTL_MS / 2,
      });
      
      return result;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ENS] Reverse lookup error for ${normalizedAddress}:`, errorMessage);
    
    return {
      name: null,
      confidence: 0,
      reason: `ENS reverse lookup failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if ENS service is available
 */
export function isENSEnabled(): boolean {
  return ENS_ENABLED && !!getProvider();
}

/**
 * Clear ENS cache
 */
export function clearCache(): void {
  forwardCache.clear();
  reverseCache.clear();
  console.log('[ENS] Cache cleared');
}

/**
 * Get cache stats
 */
export function getCacheStats(): { forward: number; reverse: number } {
  return {
    forward: forwardCache.size,
    reverse: reverseCache.size,
  };
}

export default {
  resolveENS,
  reverseENS,
  isENSEnabled,
  clearCache,
  getCacheStats,
};
