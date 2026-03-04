/**
 * Token Registry Service (P0.2.1)
 * 
 * Manages token metadata across chains with auto-enrichment
 */

import {
  TokenRegistryModel,
  TokenCanonicalMapModel,
  generateTokenId,
  getToken,
  searchTokens,
  type ITokenRegistryDocument,
  type TokenMetadata,
  type TokenSource
} from './token_registry.model.js';
import { ADAPTERS_MAP } from '../chain_adapters/index.js';

// Known wrapped native tokens
const WRAPPED_NATIVES: Record<string, string[]> = {
  ETH: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'], // WETH
  ARB: ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'], // WETH on Arbitrum
  OP: ['0x4200000000000000000000000000000000000006'], // WETH on Optimism
  BASE: ['0x4200000000000000000000000000000000000006'], // WETH on Base
  POLY: ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // WMATIC
  BNB: ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'], // WBNB
  AVAX: ['0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'] // WAVAX
};

// ============================================
// Token Metadata Enrichment (RPC)
// ============================================

/**
 * Fetch token metadata from chain via RPC
 */
async function fetchTokenMetadataRPC(
  chain: string,
  address: string
): Promise<Partial<TokenMetadata> | null> {
  try {
    const adapter = ADAPTERS_MAP.get(chain);
    if (!adapter) {
      console.warn(`[TokenRegistry] No adapter for chain: ${chain}`);
      return null;
    }
    
    // ERC20 standard functions
    const symbolCall = { to: address, data: '0x95d89b41' }; // symbol()
    const decimalsCall = { to: address, data: '0x313ce567' }; // decimals()
    const nameCall = { to: address, data: '0x06fdde03' }; // name()
    
    // For now, we skip actual RPC calls in MVP
    // In production, would use adapter.rpcCall() or web3/ethers
    
    console.log(`[TokenRegistry] Would fetch metadata for ${chain}:${address}`);
    
    return null; // MVP: manual/list enrichment only
    
  } catch (error: any) {
    console.error(`[TokenRegistry] RPC enrichment error:`, error.message);
    return null;
  }
}

// ============================================
// Token Registry Operations
// ============================================

/**
 * Upsert token with enrichment
 */
export async function upsertToken(
  chain: string,
  address: string,
  meta?: Partial<TokenMetadata>,
  source: TokenSource = 'manual'
): Promise<ITokenRegistryDocument> {
  const tokenId = generateTokenId(chain, address);
  const chainUpper = chain.toUpperCase();
  const addressLower = address.toLowerCase();
  
  // Check if token is wrapped native
  const isNativeWrapped = WRAPPED_NATIVES[chainUpper]?.includes(addressLower) || false;
  
  // Try RPC enrichment if no meta provided
  let enrichedMeta = meta;
  if (!meta || !meta.symbol) {
    const rpcMeta = await fetchTokenMetadataRPC(chainUpper, addressLower);
    if (rpcMeta) {
      enrichedMeta = { ...enrichedMeta, ...rpcMeta };
    }
  }
  
  // Get chain adapter config for chainId
  const adapter = ADAPTERS_MAP.get(chainUpper);
  const chainId = adapter?.getConfig().chainId || 0;
  
  const updateData = {
    tokenId,
    chain: chainUpper,
    chainId,
    address: addressLower,
    symbol: enrichedMeta?.symbol || 'UNKNOWN',
    name: enrichedMeta?.name || 'Unknown Token',
    decimals: enrichedMeta?.decimals ?? 18,
    isNativeWrapped,
    status: enrichedMeta?.status || 'UNKNOWN',
    $addToSet: { sources: source },
    updatedAt: new Date()
  };
  
  const token = await TokenRegistryModel.findOneAndUpdate(
    { chain: chainUpper, address: addressLower },
    updateData,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  
  console.log(`[TokenRegistry] Upserted token: ${tokenId} (${token.symbol})`);
  
  return token;
}

/**
 * Resolve token (get from registry or create UNKNOWN entry)
 */
export async function resolveToken(
  chain: string,
  address: string
): Promise<ITokenRegistryDocument> {
  let token = await getToken(chain, address);
  
  if (!token) {
    // Create UNKNOWN entry for lazy enrichment
    token = await upsertToken(chain, address, undefined, 'rpc');
  }
  
  return token;
}

/**
 * Bulk resolve tokens
 */
export async function resolveTokens(
  tokens: Array<{ chain: string; address: string }>
): Promise<ITokenRegistryDocument[]> {
  return Promise.all(
    tokens.map(({ chain, address }) => resolveToken(chain, address))
  );
}

/**
 * Search tokens in registry
 */
export async function searchTokensInRegistry(options: {
  q?: string;
  chain?: string;
  symbol?: string;
  limit?: number;
}): Promise<ITokenRegistryDocument[]> {
  return searchTokens(options);
}

/**
 * Get tokens by canonical ID
 */
export async function getTokensByCanonical(
  canonicalId: string
): Promise<ITokenRegistryDocument[]> {
  const canonical = await TokenCanonicalMapModel.findOne({ canonicalId }).lean();
  if (!canonical) return [];
  
  const tokenIds = canonical.variants.map(v => v.tokenId);
  return TokenRegistryModel.find({ tokenId: { $in: tokenIds } }).lean();
}

/**
 * Get registry statistics
 */
export async function getRegistryStats(): Promise<{
  totalTokens: number;
  tokensByChain: Record<string, number>;
  tokensByStatus: Record<string, number>;
  recentlyAdded: number;
}> {
  const [byChain, byStatus, recent] = await Promise.all([
    TokenRegistryModel.aggregate([
      { $group: { _id: '$chain', count: { $sum: 1 } } }
    ]),
    TokenRegistryModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    TokenRegistryModel.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } // last 7 days
    })
  ]);
  
  const tokensByChain = byChain.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {} as Record<string, number>);
  
  const tokensByStatus = byStatus.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {} as Record<string, number>);
  
  const totalTokens = Object.values(tokensByChain).reduce((sum, count) => sum + count, 0);
  
  return {
    totalTokens,
    tokensByChain,
    tokensByStatus,
    recentlyAdded: recent
  };
}
