/**
 * Entity Metrics Service (Layer 0/1)
 * 
 * ПРАВИЛЬНЫЙ расчёт метрик согласно спецификации:
 * 1. Net Flow (USD) - с правильными decimals и конвертацией
 * 2. Data Coverage - addressCoverage + usdCoverage
 * 3. Cross-Entity Similarity - cosine similarity с confidence
 * 
 * Источник истины: transfers collection
 */
import { TransferModel } from '../transfers/transfers.model.js';
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';
import { TokenRegistryModel } from '../resolver/token_registry.model.js';

// ============ TOKEN METADATA (Real source: Token Registry) ============

// Stablecoins for fallback pricing
const STABLECOINS = new Set([
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x4fabb145d64652a948d72533023f6e7a623c7c53', // BUSD
  '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
]);

// Known token decimals (fallback if not in registry)
const KNOWN_DECIMALS: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,    // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,     // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,     // USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,     // WBTC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,    // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18,    // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18,    // UNI
};

// Known token prices (fallback - in production use price oracle)
const KNOWN_PRICES: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 3200,   // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,      // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,      // USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 62000,  // WBTC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 1,      // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 14,     // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 7,      // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 180,    // AAVE
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 3600,   // wstETH
  'eth': 3200,
};

// Known token symbols
const KNOWN_SYMBOLS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  'eth': 'ETH',
};

// ============ HELPERS ============

function getTokenDecimals(address: string): number | null {
  const lower = address.toLowerCase();
  return KNOWN_DECIMALS[lower] ?? null;
}

function getTokenPriceUSD(address: string): number | null {
  const lower = address.toLowerCase();
  // Stablecoins always = 1
  if (STABLECOINS.has(lower)) return 1;
  return KNOWN_PRICES[lower] ?? null;
}

function getTokenSymbol(address: string): string {
  return KNOWN_SYMBOLS[address.toLowerCase()] || address.slice(0, 8);
}

/**
 * Normalize raw amount using decimals
 */
function normalizeAmount(rawAmount: string | number, decimals: number): number {
  try {
    const raw = typeof rawAmount === 'string' ? BigInt(rawAmount) : BigInt(Math.floor(rawAmount));
    const divisor = BigInt(10 ** decimals);
    // Use Number for final conversion (acceptable precision loss for display)
    return Number(raw) / Number(divisor);
  } catch {
    return parseFloat(String(rawAmount)) / (10 ** decimals);
  }
}

async function getEntityAddresses(entitySlug: string): Promise<string[]> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) return [];
  
  // EPIC 1: Only use verified + attributed addresses (NOT weak)
  const addresses = await EntityAddressModel.find({ 
    entityId: (entity as any)._id.toString(),
    confidence: { $in: ['verified', 'attributed'] }, // Safety rule: weak NOT in aggregates
  }).lean();
  
  return addresses.map((a: any) => a.address.toLowerCase());
}

// ============ TYPES ============

export type CoverageBand = 'high' | 'medium' | 'low';

export interface NetFlowResult {
  window: string;
  inflowUSD: number;
  outflowUSD: number;
  netFlowUSD: number;
  txCount: number;
  txCountPriced: number;
  usdCoverage: number;
  warnings: string[];
}

export interface CoverageResult {
  window: string;
  addressCoverage: number;
  usdCoverage: number;
  dataCoverage: number;
  dataCoveragePct: number;
  // EPIC 2: Coverage Bands
  band: CoverageBand;
  bandLabel: string;
  // Address breakdown (EPIC 1)
  addressBreakdown: {
    total: number;
    verified: number;
    attributed: number;
    weak: number; // Not used in calculations
  };
  warnings: string[];
}

export interface TokenFlowItem {
  token: string;
  tokenAddress: string;
  chainContext: 'ethereum' | 'wrapped' | 'bridged' | 'unknown';
  inflow: number;
  outflow: number;
  netFlow: number;
  inflowUSD: number | null;
  outflowUSD: number | null;
  netFlowUSD: number | null;
  dominantFlow: 'inflow' | 'outflow' | 'neutral';
  txCount: number;
  hasPriceData: boolean;
}

export interface SimilarEntity {
  entityId: string;
  entityName: string;
  similarity: number;
  confidence: number;
  bucket: 'High' | 'Medium' | 'Low';
  reasons: string[];
}

// ============ NET FLOW CALCULATION ============

/**
 * Calculate Net Flow (USD) for an entity
 * 
 * Formula:
 * netFlowUSD = Σ(inflows_usd) - Σ(outflows_usd)
 * 
 * Правила:
 * - decimals normalization обязательна
 * - если нет decimals → транзакция НЕ учитывается
 * - если нет price → транзакция учитывается в txCount, но не в USD totals
 * - stablecoins → pxUSD = 1
 */
export async function calculateNetFlow(
  entitySlug: string,
  windowHours: number = 168 // 7d default
): Promise<NetFlowResult> {
  const addresses = await getEntityAddresses(entitySlug);
  
  const windowLabel = windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d';
  
  if (addresses.length === 0) {
    return {
      window: windowLabel,
      inflowUSD: 0,
      outflowUSD: 0,
      netFlowUSD: 0,
      txCount: 0,
      txCountPriced: 0,
      usdCoverage: 0,
      warnings: ['NO_ADDRESSES_ATTRIBUTED'],
    };
  }
  
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Fetch all transfers for entity addresses
  const transfers = await TransferModel.find({
    $or: [
      { from: { $in: addresses } },
      { to: { $in: addresses } },
    ],
    timestamp: { $gte: startTime },
  }).lean();
  
  if (transfers.length === 0) {
    return {
      window: windowLabel,
      inflowUSD: 0,
      outflowUSD: 0,
      netFlowUSD: 0,
      txCount: 0,
      txCountPriced: 0,
      usdCoverage: 0,
      warnings: ['NO_TRANSACTIONS_IN_WINDOW'],
    };
  }
  
  let inflowUSD = 0;
  let outflowUSD = 0;
  let txCountPriced = 0;
  const warnings: string[] = [];
  
  for (const tx of transfers as any[]) {
    const tokenAddress = tx.assetAddress?.toLowerCase();
    if (!tokenAddress) continue;
    
    // Get decimals
    const decimals = getTokenDecimals(tokenAddress);
    if (decimals === null) {
      // Skip - insufficient token metadata
      continue;
    }
    
    // Normalize amount
    const rawAmount = tx.amountRaw || tx.amount;
    if (!rawAmount) continue;
    
    const amount = normalizeAmount(rawAmount, decimals);
    
    // Get price
    const price = getTokenPriceUSD(tokenAddress);
    if (price === null) {
      // Transaction counted but not in USD totals
      continue;
    }
    
    const usdValue = amount * price;
    
    // Determine direction
    const isInflow = addresses.includes(tx.to?.toLowerCase());
    
    if (isInflow) {
      inflowUSD += usdValue;
    } else {
      outflowUSD += usdValue;
    }
    
    txCountPriced++;
  }
  
  const txCount = transfers.length;
  const usdCoverage = txCount > 0 ? txCountPriced / txCount : 0;
  
  if (usdCoverage < 0.5) {
    warnings.push('LIMITED_PRICE_COVERAGE');
  }
  
  return {
    window: windowLabel,
    inflowUSD: Math.round(inflowUSD * 100) / 100,
    outflowUSD: Math.round(outflowUSD * 100) / 100,
    netFlowUSD: Math.round((inflowUSD - outflowUSD) * 100) / 100,
    txCount,
    txCountPriced,
    usdCoverage: Math.round(usdCoverage * 100) / 100,
    warnings,
  };
}

// ============ DATA COVERAGE CALCULATION ============

/**
 * Calculate Data Coverage
 * 
 * Formula:
 * dataCoverage = 0.35 × addressCoverage + 0.65 × usdCoverage
 * 
 * EPIC 1: addressCoverage = (verified + attributed) / expected
 * EPIC 2: Coverage Bands
 *   - High: ≥70%
 *   - Medium: 40-70%
 *   - Low: <40%
 */
export async function calculateCoverage(
  entitySlug: string,
  windowHours: number = 168
): Promise<CoverageResult> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) {
    return {
      window: windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d',
      addressCoverage: 0,
      usdCoverage: 0,
      dataCoverage: 0,
      dataCoveragePct: 0,
      band: 'low',
      bandLabel: 'Low Coverage',
      addressBreakdown: { total: 0, verified: 0, attributed: 0, weak: 0 },
      warnings: ['ENTITY_NOT_FOUND'],
    };
  }
  
  const windowLabel = windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d';
  const entityId = (entity as any)._id.toString();
  
  // EPIC 1: Get address breakdown by confidence
  const allAddresses = await EntityAddressModel.find({ entityId }).lean();
  const addressBreakdown = {
    total: allAddresses.length,
    verified: allAddresses.filter((a: any) => a.confidence === 'verified').length,
    attributed: allAddresses.filter((a: any) => a.confidence === 'attributed').length,
    weak: allAddresses.filter((a: any) => a.confidence === 'weak' || !a.confidence).length,
  };
  
  // Only verified + attributed are used
  const usableAddresses = allAddresses.filter(
    (a: any) => a.confidence === 'verified' || a.confidence === 'attributed'
  );
  const N_usable = usableAddresses.length;
  
  if (N_usable === 0) {
    return {
      window: windowLabel,
      addressCoverage: 0,
      usdCoverage: 0,
      dataCoverage: 0,
      dataCoveragePct: 0,
      band: 'low',
      bandLabel: 'Low Coverage',
      addressBreakdown,
      warnings: ['NO_VERIFIED_OR_ATTRIBUTED_ADDRESSES'],
    };
  }
  
  const addresses = usableAddresses.map((a: any) => a.address.toLowerCase());
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Get transfers and count unique addresses with activity
  const transfers = await TransferModel.find({
    $or: [
      { from: { $in: addresses } },
      { to: { $in: addresses } },
    ],
    timestamp: { $gte: startTime },
  }).lean();
  
  const M_total = transfers.length;
  
  if (M_total === 0) {
    return {
      window: windowLabel,
      addressCoverage: 0,
      usdCoverage: 0,
      dataCoverage: 0,
      dataCoveragePct: 0,
      band: 'low',
      bandLabel: 'Low Coverage',
      addressBreakdown,
      warnings: ['NO_TRANSACTIONS_IN_WINDOW'],
    };
  }
  
  // Count unique addresses with activity
  const seenAddresses = new Set<string>();
  let M_priced = 0;
  
  for (const tx of transfers as any[]) {
    if (addresses.includes(tx.from?.toLowerCase())) {
      seenAddresses.add(tx.from.toLowerCase());
    }
    if (addresses.includes(tx.to?.toLowerCase())) {
      seenAddresses.add(tx.to.toLowerCase());
    }
    
    // Check if has price data
    const tokenAddress = tx.assetAddress?.toLowerCase();
    if (tokenAddress && getTokenDecimals(tokenAddress) !== null && getTokenPriceUSD(tokenAddress) !== null) {
      M_priced++;
    }
  }
  
  const N_seen = seenAddresses.size;
  
  const addressCoverage = N_seen / N_usable;
  const usdCoverage = M_priced / M_total;
  
  // Weighted coverage
  const dataCoverage = 0.35 * addressCoverage + 0.65 * usdCoverage;
  const dataCoveragePct = Math.round(dataCoverage * 100);
  
  // EPIC 2: Determine band
  let band: CoverageBand = 'low';
  let bandLabel = 'Low Coverage';
  
  if (dataCoveragePct >= 70) {
    band = 'high';
    bandLabel = 'High Coverage';
  } else if (dataCoveragePct >= 40) {
    band = 'medium';
    bandLabel = 'Medium Coverage';
  }
  
  const warnings: string[] = [];
  if (addressCoverage < 0.5) {
    warnings.push('LIMITED_ADDRESS_ATTRIBUTION');
  }
  if (usdCoverage < 0.5) {
    warnings.push('LIMITED_PRICE_COVERAGE');
  }
  if (addressBreakdown.verified === 0) {
    warnings.push('NO_VERIFIED_ADDRESSES');
  }
  
  return {
    window: windowLabel,
    addressCoverage: Math.round(addressCoverage * 100) / 100,
    usdCoverage: Math.round(usdCoverage * 100) / 100,
    dataCoverage: Math.round(dataCoverage * 100) / 100,
    dataCoveragePct,
    band,
    bandLabel,
    addressBreakdown,
    warnings,
  };
}

// ============ TOKEN FLOW MATRIX v2 (EPIC 3) ============

// Minimum USD threshold to include token
const MIN_VOLUME_THRESHOLD_USD = 100_000; // $100k

/**
 * Token Flow Item v2
 */
export interface TokenFlowItemV2 {
  symbol: string;
  tokenAddress: string;
  usd: number;
  share: number; // % of total
  txCount: number;
}

/**
 * Token Flow Matrix v2 Response
 */
export interface TokenFlowMatrixV2 {
  chainId: number;
  window: string;
  inflow: TokenFlowItemV2[];
  outflow: TokenFlowItemV2[];
  inflowOthers: { count: number; usd: number } | null;
  outflowOthers: { count: number; usd: number } | null;
  totals: {
    inflowUSD: number;
    outflowUSD: number;
    netFlowUSD: number;
  };
  tokensAnalyzed: number;
  warnings: string[];
}

/**
 * Get Token Flow Matrix v2 (EPIC 3)
 * 
 * - Top-10 inflow tokens
 * - Top-10 outflow tokens
 * - "Others" aggregated row
 * - Minimum $100k threshold
 * - ONLY verified + attributed addresses
 * - ONLY ERC20 on Ethereum
 */
export async function getTokenFlowMatrixV2(
  entitySlug: string,
  windowHours: number = 168,
  limit: number = 10
): Promise<TokenFlowMatrixV2> {
  const windowLabel = windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d';
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return {
      chainId: 1,
      window: windowLabel,
      inflow: [],
      outflow: [],
      inflowOthers: null,
      outflowOthers: null,
      totals: { inflowUSD: 0, outflowUSD: 0, netFlowUSD: 0 },
      tokensAnalyzed: 0,
      warnings: ['NO_VERIFIED_OR_ATTRIBUTED_ADDRESSES'],
    };
  }
  
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Aggregate by token with separate inflow/outflow
  const pipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
        timestamp: { $gte: startTime },
        assetType: 'erc20',
        chain: 'ethereum',
      },
    },
    {
      $project: {
        assetAddress: 1,
        amountRaw: { $toDouble: { $ifNull: ['$amountRaw', '0'] } },
        amountNormalized: { $toDouble: { $ifNull: ['$amountNormalized', '0'] } },
        isInflow: { $in: ['$to', addresses] },
      },
    },
    {
      $group: {
        _id: '$assetAddress',
        inflowRaw: { $sum: { $cond: ['$isInflow', '$amountRaw', 0] } },
        outflowRaw: { $sum: { $cond: ['$isInflow', 0, '$amountRaw'] } },
        inflowNorm: { $sum: { $cond: ['$isInflow', '$amountNormalized', 0] } },
        outflowNorm: { $sum: { $cond: ['$isInflow', 0, '$amountNormalized'] } },
        txCount: { $sum: 1 },
      },
    },
  ];
  
  const results = await TransferModel.aggregate(pipeline as any[]);
  
  // Process results and convert to USD
  interface TokenData {
    symbol: string;
    tokenAddress: string;
    inflowUSD: number;
    outflowUSD: number;
    txCount: number;
    hasPriceData: boolean;
  }
  
  const tokenMap: Map<string, TokenData> = new Map();
  let totalInflowUSD = 0;
  let totalOutflowUSD = 0;
  
  for (const r of results) {
    const tokenAddress = r._id?.toLowerCase();
    if (!tokenAddress) continue;
    
    const decimals = getTokenDecimals(tokenAddress);
    const price = getTokenPriceUSD(tokenAddress);
    const symbol = getTokenSymbol(tokenAddress);
    
    // Skip tokens without decimals
    if (decimals === null) continue;
    
    // Prefer normalized amount, fallback to raw calculation
    let inflowAmount = r.inflowNorm || 0;
    let outflowAmount = r.outflowNorm || 0;
    
    // If normalized is 0 but raw exists, calculate from raw
    if (inflowAmount === 0 && r.inflowRaw > 0) {
      inflowAmount = normalizeAmount(r.inflowRaw, decimals);
    }
    if (outflowAmount === 0 && r.outflowRaw > 0) {
      outflowAmount = normalizeAmount(r.outflowRaw, decimals);
    }
    
    // Convert to USD
    const inflowUSD = price !== null ? inflowAmount * price : 0;
    const outflowUSD = price !== null ? outflowAmount * price : 0;
    
    // Skip if below threshold (both directions)
    if (inflowUSD < MIN_VOLUME_THRESHOLD_USD && outflowUSD < MIN_VOLUME_THRESHOLD_USD) {
      continue;
    }
    
    tokenMap.set(tokenAddress, {
      symbol,
      tokenAddress,
      inflowUSD,
      outflowUSD,
      txCount: r.txCount,
      hasPriceData: price !== null,
    });
    
    if (price !== null) {
      totalInflowUSD += inflowUSD;
      totalOutflowUSD += outflowUSD;
    }
  }
  
  const warnings: string[] = [];
  if (tokenMap.size === 0) {
    warnings.push('NO_TOKENS_ABOVE_THRESHOLD');
  }
  
  // Sort and get Top-10 inflow
  const allTokens = Array.from(tokenMap.values());
  
  const sortedByInflow = [...allTokens]
    .filter(t => t.inflowUSD >= MIN_VOLUME_THRESHOLD_USD)
    .sort((a, b) => b.inflowUSD - a.inflowUSD);
  
  const sortedByOutflow = [...allTokens]
    .filter(t => t.outflowUSD >= MIN_VOLUME_THRESHOLD_USD)
    .sort((a, b) => b.outflowUSD - a.outflowUSD);
  
  // Top-10 inflow
  const topInflow = sortedByInflow.slice(0, limit);
  const inflowOthers = sortedByInflow.slice(limit);
  
  // Top-10 outflow
  const topOutflow = sortedByOutflow.slice(0, limit);
  const outflowOthers = sortedByOutflow.slice(limit);
  
  // Format results
  const formatTokenFlow = (tokens: TokenData[], total: number): TokenFlowItemV2[] => {
    return tokens.map(t => ({
      symbol: t.symbol,
      tokenAddress: t.tokenAddress,
      usd: Math.round(t.inflowUSD > t.outflowUSD ? t.inflowUSD : t.outflowUSD),
      share: total > 0 ? Math.round(((t.inflowUSD > t.outflowUSD ? t.inflowUSD : t.outflowUSD) / total) * 1000) / 10 : 0,
      txCount: t.txCount,
    }));
  };
  
  const inflow: TokenFlowItemV2[] = topInflow.map(t => ({
    symbol: t.symbol,
    tokenAddress: t.tokenAddress,
    usd: Math.round(t.inflowUSD),
    share: totalInflowUSD > 0 ? Math.round((t.inflowUSD / totalInflowUSD) * 1000) / 10 : 0,
    txCount: t.txCount,
  }));
  
  const outflow: TokenFlowItemV2[] = topOutflow.map(t => ({
    symbol: t.symbol,
    tokenAddress: t.tokenAddress,
    usd: Math.round(t.outflowUSD),
    share: totalOutflowUSD > 0 ? Math.round((t.outflowUSD / totalOutflowUSD) * 1000) / 10 : 0,
    txCount: t.txCount,
  }));
  
  // Others aggregation
  const inflowOthersAgg = inflowOthers.length > 0 ? {
    count: inflowOthers.length,
    usd: Math.round(inflowOthers.reduce((sum, t) => sum + t.inflowUSD, 0)),
  } : null;
  
  const outflowOthersAgg = outflowOthers.length > 0 ? {
    count: outflowOthers.length,
    usd: Math.round(outflowOthers.reduce((sum, t) => sum + t.outflowUSD, 0)),
  } : null;
  
  // Price coverage warning
  const pricedCount = allTokens.filter(t => t.hasPriceData).length;
  if (pricedCount < allTokens.length * 0.5) {
    warnings.push('LIMITED_PRICE_COVERAGE');
  }
  
  return {
    chainId: 1,
    window: windowLabel,
    inflow,
    outflow,
    inflowOthers: inflowOthersAgg,
    outflowOthers: outflowOthersAgg,
    totals: {
      inflowUSD: Math.round(totalInflowUSD),
      outflowUSD: Math.round(totalOutflowUSD),
      netFlowUSD: Math.round(totalInflowUSD - totalOutflowUSD),
    },
    tokensAnalyzed: tokenMap.size,
    warnings,
  };
}

// Keep old function for backward compatibility
/**
 * Get Token Flow Matrix (legacy) - ONLY ERC20 on Ethereum
 * BTC/SOL без bridge attribution = НЕ показывать
 */
export async function getTokenFlowMatrix(
  entitySlug: string,
  windowHours: number = 168
): Promise<{
  flows: TokenFlowItem[];
  warnings: string[];
}> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return { flows: [], warnings: ['NO_ADDRESSES_ATTRIBUTED'] };
  }
  
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  const pipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
        timestamp: { $gte: startTime },
        // CRITICAL: Only ERC20 tokens on Ethereum
        assetType: 'erc20',
        chain: 'ethereum',
      },
    },
    {
      $project: {
        assetAddress: 1,
        amountRaw: { $toDouble: { $ifNull: ['$amountRaw', '0'] } },
        isInflow: { $in: ['$to', addresses] },
      },
    },
    {
      $group: {
        _id: '$assetAddress',
        inflow: { $sum: { $cond: ['$isInflow', '$amountRaw', 0] } },
        outflow: { $sum: { $cond: ['$isInflow', 0, '$amountRaw'] } },
        txCount: { $sum: 1 },
      },
    },
    {
      $match: {
        txCount: { $gte: 2 }, // Minimum 2 transactions
      },
    },
    { $sort: { txCount: -1 as const } },
    { $limit: 10 },
  ];
  
  const results = await TransferModel.aggregate(pipeline as any[]);
  
  const flows: TokenFlowItem[] = [];
  const warnings: string[] = [];
  
  for (const r of results) {
    const tokenAddress = r._id?.toLowerCase();
    if (!tokenAddress) continue;
    
    const decimals = getTokenDecimals(tokenAddress);
    const price = getTokenPriceUSD(tokenAddress);
    const symbol = getTokenSymbol(tokenAddress);
    
    // Skip tokens without decimals (can't calculate properly)
    if (decimals === null) {
      continue;
    }
    
    const inflowNorm = normalizeAmount(r.inflow, decimals);
    const outflowNorm = normalizeAmount(r.outflow, decimals);
    const netFlowNorm = inflowNorm - outflowNorm;
    
    const dominantFlow: 'inflow' | 'outflow' | 'neutral' = 
      Math.abs(netFlowNorm) < (inflowNorm + outflowNorm) * 0.1 ? 'neutral' :
      netFlowNorm > 0 ? 'inflow' : 'outflow';
    
    flows.push({
      token: symbol,
      tokenAddress,
      chainContext: 'ethereum',
      inflow: inflowNorm,
      outflow: outflowNorm,
      netFlow: netFlowNorm,
      inflowUSD: price !== null ? inflowNorm * price : null,
      outflowUSD: price !== null ? outflowNorm * price : null,
      netFlowUSD: price !== null ? netFlowNorm * price : null,
      dominantFlow,
      txCount: r.txCount,
      hasPriceData: price !== null,
    });
  }
  
  // Sort by absolute net flow USD (where available)
  flows.sort((a, b) => {
    const aVal = a.netFlowUSD !== null ? Math.abs(a.netFlowUSD) : 0;
    const bVal = b.netFlowUSD !== null ? Math.abs(b.netFlowUSD) : 0;
    return bVal - aVal;
  });
  
  const pricedCount = flows.filter(f => f.hasPriceData).length;
  if (pricedCount < flows.length * 0.5) {
    warnings.push('LIMITED_PRICE_COVERAGE');
  }
  
  return { flows, warnings };
}

// ============ CROSS-ENTITY SIMILARITY ============

/**
 * Calculate similarity between entities based on flow patterns
 * 
 * Formula:
 * similarity = 0.5 × cos01(sim_nf) + 0.3 × cos01(sim_vol) + 0.2 × sim_stable
 * confidence = similarity × min(dataCoverage_A, dataCoverage_B)
 * 
 * Buckets:
 * - High: confidence ≥ 0.75
 * - Medium: 0.55 ≤ confidence < 0.75
 * - Low: confidence < 0.55
 */
export async function calculateEntitySimilarity(
  entitySlug: string,
  windowHours: number = 168
): Promise<{
  peers: SimilarEntity[];
  warnings: string[];
}> {
  // Get current entity's coverage
  const currentCoverage = await calculateCoverage(entitySlug, windowHours);
  
  // Gate: don't calculate similarity if coverage too low
  if (currentCoverage.dataCoverage < 0.4) {
    return {
      peers: [],
      warnings: ['INSUFFICIENT_DATA_FOR_SIMILARITY'],
    };
  }
  
  // Get all other entities
  const currentEntity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!currentEntity) {
    return { peers: [], warnings: ['ENTITY_NOT_FOUND'] };
  }
  
  const otherEntities = await EntityModel.find({
    slug: { $ne: entitySlug.toLowerCase() },
    status: 'live',
  }).limit(20).lean();
  
  if (otherEntities.length === 0) {
    return { peers: [], warnings: ['NO_OTHER_ENTITIES'] };
  }
  
  // Get current entity's flow vector
  const currentFlow = await calculateNetFlow(entitySlug, windowHours);
  const currentCoverageData = currentCoverage;
  
  const peers: SimilarEntity[] = [];
  
  for (const other of otherEntities) {
    const otherSlug = (other as any).slug;
    
    // Get other entity's metrics
    const [otherFlow, otherCoverage] = await Promise.all([
      calculateNetFlow(otherSlug, windowHours),
      calculateCoverage(otherSlug, windowHours),
    ]);
    
    // Skip if other entity has insufficient data
    if (otherCoverage.dataCoverage < 0.4 || otherFlow.txCount < 20) {
      continue;
    }
    
    // Simple similarity: compare net flow direction and magnitude
    const currentNetFlowNorm = currentFlow.netFlowUSD / (Math.abs(currentFlow.netFlowUSD) + 1);
    const otherNetFlowNorm = otherFlow.netFlowUSD / (Math.abs(otherFlow.netFlowUSD) + 1);
    
    // Cosine-like similarity (simplified for net flow direction)
    const flowSimilarity = (currentNetFlowNorm * otherNetFlowNorm + 1) / 2;
    
    // Volume similarity
    const currentVol = currentFlow.inflowUSD + currentFlow.outflowUSD;
    const otherVol = otherFlow.inflowUSD + otherFlow.outflowUSD;
    const volRatio = Math.min(currentVol, otherVol) / (Math.max(currentVol, otherVol) + 1);
    
    // Coverage similarity
    const coverageSim = 1 - Math.abs(currentCoverageData.usdCoverage - otherCoverage.usdCoverage);
    
    // Weighted similarity
    const similarity = 0.5 * flowSimilarity + 0.3 * volRatio + 0.2 * coverageSim;
    
    // Confidence based on minimum coverage
    const minCoverage = Math.min(currentCoverageData.dataCoverage, otherCoverage.dataCoverage);
    const confidence = similarity * minCoverage;
    
    // Bucket
    let bucket: 'High' | 'Medium' | 'Low' = 'Low';
    if (confidence >= 0.75) bucket = 'High';
    else if (confidence >= 0.55) bucket = 'Medium';
    
    // Skip low similarity
    if (similarity < 0.5) continue;
    
    // Determine reasons
    const reasons: string[] = [];
    if (flowSimilarity > 0.7) reasons.push('netflow_shape');
    if (volRatio > 0.5) reasons.push('volume_magnitude');
    if (coverageSim > 0.8) reasons.push('coverage_close');
    
    peers.push({
      entityId: otherSlug,
      entityName: (other as any).name,
      similarity: Math.round(similarity * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      bucket,
      reasons,
    });
  }
  
  // Sort by confidence
  peers.sort((a, b) => b.confidence - a.confidence);
  
  return {
    peers: peers.slice(0, 5), // Top 5
    warnings: [],
  };
}
