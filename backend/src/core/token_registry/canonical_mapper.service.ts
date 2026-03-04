/**
 * Token Canonical Mapper Service (P0.2.1)
 * 
 * Maps tokens across chains to canonical IDs
 * Rules: MANUAL > COINGECKO > HEURISTIC
 */

import {
  TokenCanonicalMapModel,
  TokenRegistryModel,
  type ITokenCanonicalMapDocument,
  type CanonicalRule
} from './token_registry.model.js';

// Known stable tokens (heuristic mapping)
const KNOWN_STABLES: Record<string, { symbol: string; name: string }> = {
  'USDC': { symbol: 'USDC', name: 'USD Coin' },
  'USDT': { symbol: 'USDT', name: 'Tether USD' },
  'DAI': { symbol: 'DAI', name: 'Dai Stablecoin' },
  'WETH': { symbol: 'WETH', name: 'Wrapped Ether' },
  'WBTC': { symbol: 'WBTC', name: 'Wrapped Bitcoin' }
};

// ============================================
// Canonical Mapping Logic
// ============================================

/**
 * Resolve canonical ID for a token
 */
export async function resolveCanonical(
  chain: string,
  address: string
): Promise<{
  canonicalId: string | null;
  confidence: number;
  rule: CanonicalRule;
} | null> {
  const tokenId = `TOKEN:${chain.toUpperCase()}:${address.toLowerCase()}`;
  
  // Check if token is in any canonical map
  const canonical = await TokenCanonicalMapModel.findOne({
    'variants.tokenId': tokenId
  }).lean();
  
  if (canonical) {
    return {
      canonicalId: canonical.canonicalId,
      confidence: canonical.confidence,
      rule: canonical.rule
    };
  }
  
  // Try heuristic matching
  const token = await TokenRegistryModel.findOne({
    chain: chain.toUpperCase(),
    address: address.toLowerCase()
  }).lean();
  
  if (!token || token.status === 'UNKNOWN') {
    return null;
  }
  
  // Heuristic: known stables
  if (KNOWN_STABLES[token.symbol]) {
    const stableInfo = KNOWN_STABLES[token.symbol];
    return {
      canonicalId: `CANON:${token.symbol}`,
      confidence: 0.7, // Medium confidence for heuristic
      rule: 'HEURISTIC'
    };
  }
  
  return null;
}

/**
 * Create or update canonical mapping
 */
export async function upsertCanonicalMapping(data: {
  canonicalId?: string;
  symbol: string;
  name: string;
  coingeckoId?: string;
  variants: Array<{ chain: string; address: string }>;
  confidence: number;
  rule: CanonicalRule;
}): Promise<ITokenCanonicalMapDocument> {
  const canonicalId = data.canonicalId || 
    (data.coingeckoId ? `CANON:${data.coingeckoId}` : `CANON:${data.symbol}`);
  
  // Build variants with tokenIds
  const variants = data.variants.map(v => ({
    chain: v.chain.toUpperCase(),
    address: v.address.toLowerCase(),
    tokenId: `TOKEN:${v.chain.toUpperCase()}:${v.address.toLowerCase()}`
  }));
  
  const canonical = await TokenCanonicalMapModel.findOneAndUpdate(
    { canonicalId },
    {
      canonicalId,
      symbol: data.symbol,
      name: data.name,
      coingeckoId: data.coingeckoId,
      variants,
      confidence: data.confidence,
      rule: data.rule,
      updatedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  
  console.log(`[CanonicalMapper] Upserted mapping: ${canonicalId} (${variants.length} variants)`);
  
  return canonical;
}

/**
 * Add variant to existing canonical
 */
export async function addVariantToCanonical(
  canonicalId: string,
  chain: string,
  address: string
): Promise<ITokenCanonicalMapDocument | null> {
  const tokenId = `TOKEN:${chain.toUpperCase()}:${address.toLowerCase()}`;
  
  const canonical = await TokenCanonicalMapModel.findOneAndUpdate(
    { canonicalId },
    {
      $addToSet: {
        variants: {
          chain: chain.toUpperCase(),
          address: address.toLowerCase(),
          tokenId
        }
      },
      updatedAt: new Date()
    },
    { new: true }
  );
  
  return canonical;
}

/**
 * Search canonical mappings
 */
export async function searchCanonical(options: {
  q?: string;
  symbol?: string;
  limit?: number;
}): Promise<ITokenCanonicalMapDocument[]> {
  const query: any = {};
  
  if (options.symbol) {
    query.symbol = new RegExp(options.symbol, 'i');
  }
  
  if (options.q) {
    query.$or = [
      { symbol: new RegExp(options.q, 'i') },
      { name: new RegExp(options.q, 'i') },
      { canonicalId: new RegExp(options.q, 'i') }
    ];
  }
  
  return TokenCanonicalMapModel.find(query)
    .sort({ updatedAt: -1 })
    .limit(options.limit || 100)
    .lean();
}

/**
 * Get canonical by ID
 */
export async function getCanonicalById(
  canonicalId: string
): Promise<ITokenCanonicalMapDocument | null> {
  return TokenCanonicalMapModel.findOne({ canonicalId }).lean();
}

/**
 * Get canonical statistics
 */
export async function getCanonicalStats(): Promise<{
  totalCanonicals: number;
  byRule: Record<CanonicalRule, number>;
  avgVariantsPerCanonical: number;
}> {
  const [byRule, all] = await Promise.all([
    TokenCanonicalMapModel.aggregate([
      { $group: { _id: '$rule', count: { $sum: 1 } } }
    ]),
    TokenCanonicalMapModel.find().lean()
  ]);
  
  const ruleStats = byRule.reduce((acc, item) => {
    acc[item._id as CanonicalRule] = item.count;
    return acc;
  }, {} as Record<CanonicalRule, number>);
  
  const totalVariants = all.reduce((sum, c) => sum + c.variants.length, 0);
  const avgVariants = all.length > 0 ? totalVariants / all.length : 0;
  
  return {
    totalCanonicals: all.length,
    byRule: ruleStats,
    avgVariantsPerCanonical: Number(avgVariants.toFixed(2))
  };
}

// ============================================
// Seed Known Mappings (MVP)
// ============================================

/**
 * Seed canonical mappings for known tokens
 */
export async function seedKnownMappings(): Promise<{
  created: number;
  errors: number;
}> {
  console.log('[CanonicalMapper] Seeding known mappings...');
  
  const knownMappings = [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      variants: [
        { chain: 'ETH', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
        { chain: 'ARB', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
        { chain: 'OP', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' },
        { chain: 'BASE', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        { chain: 'POLY', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' }
      ],
      confidence: 0.95,
      rule: 'MANUAL' as CanonicalRule
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      variants: [
        { chain: 'ETH', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
        { chain: 'ARB', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
        { chain: 'OP', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58' },
        { chain: 'POLY', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f' },
        { chain: 'BNB', address: '0x55d398326f99059ff775485246999027b3197955' }
      ],
      confidence: 0.95,
      rule: 'MANUAL' as CanonicalRule
    }
  ];
  
  let created = 0;
  let errors = 0;
  
  for (const mapping of knownMappings) {
    try {
      await upsertCanonicalMapping(mapping);
      created++;
    } catch (error: any) {
      console.error(`[CanonicalMapper] Error seeding ${mapping.symbol}:`, error.message);
      errors++;
    }
  }
  
  console.log(`[CanonicalMapper] Seeded ${created} mappings, ${errors} errors`);
  
  return { created, errors };
}
