/**
 * Price Service (Phase 14A)
 * 
 * Handles price fetching, calculation, and storage.
 */
import { DexPairModel, IDexPair, KNOWN_TOKENS, KNOWN_PAIRS_V2 } from './dex_pairs.model.js';
import { PricePointModel, IPricePoint, toMinuteBucket, formatPrice, parsePrice } from './price_points.model.js';
import { env } from '../../config/env.js';
import { ethers } from 'ethers';

// Uniswap V2 Pair ABI (minimal)
const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

let provider: ethers.JsonRpcProvider | null = null;
let arbitrumProvider: ethers.JsonRpcProvider | null = null;

/**
 * Get or create provider for chain
 */
function getProvider(chain: string = 'ethereum'): ethers.JsonRpcProvider | null {
  if (chain === 'arbitrum') {
    if (!arbitrumProvider && env.ARBITRUM_RPC_URL) {
      arbitrumProvider = new ethers.JsonRpcProvider(env.ARBITRUM_RPC_URL);
    }
    return arbitrumProvider;
  }
  if (!provider && env.INFURA_RPC_URL) {
    provider = new ethers.JsonRpcProvider(env.INFURA_RPC_URL);
  }
  return provider;
}

/**
 * Initialize default DEX pairs
 */
export async function initializeDexPairs(): Promise<number> {
  let created = 0;
  
  for (const pairInfo of KNOWN_PAIRS_V2) {
    const chain = pairInfo.chain || 'ethereum';
    const existing = await DexPairModel.findOne({ pairAddress: pairInfo.pairAddress.toLowerCase() });
    if (existing) continue;
    
    const chainTokens = KNOWN_TOKENS[chain];
    if (!chainTokens) continue;
    
    const token0 = chainTokens[pairInfo.token0Symbol];
    const token1 = chainTokens[pairInfo.token1Symbol];
    
    if (!token0 || !token1) continue;
    
    const pair = new DexPairModel({
      chain,
      dex: chain === 'arbitrum' ? 'sushiswap' : 'uniswap_v2',
      pairAddress: pairInfo.pairAddress.toLowerCase(),
      token0,
      token1,
      isAnchorPair: pairInfo.isAnchor || false,
      anchorType: pairInfo.isAnchor ? 'usd' : undefined,
      enabled: true,
    });
    
    await pair.save();
    created++;
  }
  
  return created;
}

/**
 * Fetch Uniswap V2 reserves from chain
 */
export async function fetchV2Reserves(
  pairAddress: string,
  chain: string = 'ethereum'
): Promise<{ reserve0: bigint; reserve1: bigint; timestamp: number } | null> {
  const rpc = getProvider(chain);
  if (!rpc) return null;
  
  try {
    const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, rpc);
    const [reserve0, reserve1, blockTimestamp] = await pair.getReserves();
    
    return {
      reserve0: BigInt(reserve0.toString()),
      reserve1: BigInt(reserve1.toString()),
      timestamp: Number(blockTimestamp),
    };
  } catch (err) {
    console.error(`[Price] Failed to fetch reserves for ${pairAddress}:`, err);
    return null;
  }
}

/**
 * Calculate price from V2 reserves
 * 
 * Formula: priceAinB = reserveB / reserveA (adjusted for decimals)
 */
export function calculateV2Price(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  // Convert to same decimal base
  const adj0 = Number(reserve0) / Math.pow(10, decimals0);
  const adj1 = Number(reserve1) / Math.pow(10, decimals1);
  
  // Price of token0 in terms of token1
  return adj1 / adj0;
}

/**
 * Calculate confidence based on liquidity and stability
 * 
 * Formula:
 * liquidityFactor = clamp(log10(tvlUsd) / 6, 0, 1)  // tvl 1M → ~1
 * stabilityFactor = 1 - clamp(volatility24h / 0.2, 0, 1)
 * confidence = 0.7*liquidityFactor + 0.3*stabilityFactor
 */
export function calculateConfidence(
  tvlUsd: number,
  volatility24h: number = 0
): number {
  const liquidityFactor = Math.min(1, Math.max(0, Math.log10(Math.max(1, tvlUsd)) / 6));
  const stabilityFactor = 1 - Math.min(1, Math.max(0, volatility24h / 0.2));
  return 0.7 * liquidityFactor + 0.3 * stabilityFactor;
}

/**
 * Fetch and store price for a DEX pair
 */
export async function fetchAndStorePairPrice(
  pair: IDexPair,
  anchorPriceUsd?: number
): Promise<IPricePoint | null> {
  if (pair.dex !== 'uniswap_v2' && pair.dex !== 'sushiswap') {
    // V3 not implemented yet
    return null;
  }
  
  const reserves = await fetchV2Reserves(pair.pairAddress, pair.chain);
  if (!reserves) {
    // Update error count
    pair.errorCount += 1;
    pair.lastError = 'Failed to fetch reserves';
    await pair.save();
    return null;
  }
  
  // Calculate price of token0 in token1
  const priceInToken1 = calculateV2Price(
    reserves.reserve0,
    reserves.reserve1,
    pair.token0.decimals,
    pair.token1.decimals
  );
  
  // Estimate TVL for confidence
  const reserve0Usd = Number(reserves.reserve0) / Math.pow(10, pair.token0.decimals);
  const reserve1Usd = Number(reserves.reserve1) / Math.pow(10, pair.token1.decimals);
  
  let priceUsd = 0;
  let priceEth = 0;
  let tvlUsd = 0;
  
  // Determine USD price based on pair type
  if (pair.isAnchorPair && pair.anchorType === 'usd') {
    // This IS the WETH/USDC anchor - price is already in USD
    // token0 = USDC, token1 = WETH → priceInToken1 = USDC per WETH → invert
    const wethPriceUsd = 1 / priceInToken1; // WETH price in USD
    priceUsd = wethPriceUsd;
    priceEth = 1;
    tvlUsd = reserve0Usd * 2; // USDC reserve * 2 (approximate TVL)
    
    // Store WETH price
    const pricePoint = await storePricePoint({
      chain: pair.chain,
      assetAddress: pair.token1.address, // WETH
      priceUsd,
      priceEth,
      source: 'dex_v2',
      sourcePairAddress: pair.pairAddress,
      confidence: calculateConfidence(tvlUsd),
      rawData: {
        reserve0: reserves.reserve0.toString(),
        reserve1: reserves.reserve1.toString(),
      },
    });
    
    // Update pair
    pair.lastPriceAt = new Date();
    pair.reservesLastUpdated = new Date();
    pair.liquidityHint = tvlUsd;
    pair.errorCount = 0;
    await pair.save();
    
    return pricePoint;
  } else if (anchorPriceUsd && anchorPriceUsd > 0) {
    // Use anchor price (WETH in USD) to derive token price
    // If token1 = WETH, priceInToken1 = how much WETH per token0
    // priceUsd = priceInToken1 * wethPriceUsd
    
    // Check which token is WETH
    const wethAddress = KNOWN_TOKENS.ethereum.WETH.address.toLowerCase();
    
    if (pair.token1.address.toLowerCase() === wethAddress) {
      // token0/WETH pair → price token0
      priceEth = priceInToken1;
      priceUsd = priceInToken1 * anchorPriceUsd;
      tvlUsd = reserve1Usd * anchorPriceUsd * 2;
      
      const pricePoint = await storePricePoint({
        chain: pair.chain,
        assetAddress: pair.token0.address,
        priceUsd,
        priceEth,
        source: 'dex_v2',
        sourcePairAddress: pair.pairAddress,
        confidence: calculateConfidence(tvlUsd),
        rawData: {
          reserve0: reserves.reserve0.toString(),
          reserve1: reserves.reserve1.toString(),
        },
      });
      
      pair.lastPriceAt = new Date();
      pair.reservesLastUpdated = new Date();
      pair.liquidityHint = tvlUsd;
      pair.errorCount = 0;
      await pair.save();
      
      return pricePoint;
    } else if (pair.token0.address.toLowerCase() === wethAddress) {
      // WETH/token1 pair → price token1 (invert)
      priceEth = 1 / priceInToken1;
      priceUsd = (1 / priceInToken1) * anchorPriceUsd;
      tvlUsd = reserve0Usd * anchorPriceUsd * 2;
      
      const pricePoint = await storePricePoint({
        chain: pair.chain,
        assetAddress: pair.token1.address,
        priceUsd,
        priceEth,
        source: 'dex_v2',
        sourcePairAddress: pair.pairAddress,
        confidence: calculateConfidence(tvlUsd),
        rawData: {
          reserve0: reserves.reserve0.toString(),
          reserve1: reserves.reserve1.toString(),
        },
      });
      
      pair.lastPriceAt = new Date();
      pair.reservesLastUpdated = new Date();
      pair.liquidityHint = tvlUsd;
      pair.errorCount = 0;
      await pair.save();
      
      return pricePoint;
    }
  }
  
  return null;
}

/**
 * Store a price point
 */
export async function storePricePoint(data: {
  chain: string;
  assetAddress: string;
  priceUsd: number;
  priceEth: number;
  source: 'dex_v2' | 'dex_v3' | 'derived' | 'oracle' | 'manual';
  sourcePairAddress?: string;
  confidence: number;
  rawData?: { reserve0?: string; reserve1?: string; sqrtPriceX96?: string };
}): Promise<IPricePoint> {
  const timestamp = toMinuteBucket(new Date());
  
  // Upsert to avoid duplicates in same minute
  const pricePoint = await PricePointModel.findOneAndUpdate(
    {
      chain: data.chain,
      assetAddress: data.assetAddress.toLowerCase(),
      timestamp,
    },
    {
      $set: {
        priceUsd: formatPrice(data.priceUsd),
        priceEth: formatPrice(data.priceEth),
        source: data.source,
        sourcePairAddress: data.sourcePairAddress,
        confidence: data.confidence,
        rawData: data.rawData,
      },
    },
    { upsert: true, new: true }
  );
  
  return pricePoint!;
}

/**
 * Get latest price for an asset
 */
export async function getLatestPrice(
  assetAddress: string,
  chain: string = 'ethereum'
): Promise<IPricePoint | null> {
  return PricePointModel.findOne({
    chain,
    assetAddress: assetAddress.toLowerCase(),
  }).sort({ timestamp: -1 });
}

/**
 * Get price history for an asset
 */
export async function getPriceHistory(
  assetAddress: string,
  chain: string = 'ethereum',
  from: Date,
  to: Date,
  bucket: '1m' | '5m' | '1h' = '1m'
): Promise<IPricePoint[]> {
  // For MVP, just return all points (bucketing can be added later)
  return PricePointModel.find({
    chain,
    assetAddress: assetAddress.toLowerCase(),
    timestamp: { $gte: from, $lte: to },
  }).sort({ timestamp: 1 }).limit(1000);
}

/**
 * Get WETH price in USD (from anchor pair)
 */
export async function getWethPriceUsd(): Promise<number | null> {
  const wethAddress = KNOWN_TOKENS.ethereum.WETH.address.toLowerCase();
  const latest = await getLatestPrice(wethAddress, 'ethereum');
  
  if (latest) {
    return parsePrice(latest.priceUsd);
  }
  
  return null;
}
