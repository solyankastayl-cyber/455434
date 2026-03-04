/**
 * Recent Transactions Service (EPIC 4)
 * 
 * Token-aware, Volume-weighted sampling
 * 
 * Layer: L0 (Research) - FACTS ONLY
 * 
 * Logic:
 * 1. Get Top-N tokens by volume (from Token Flow Matrix v2)
 * 2. For each token: take K last transactions
 * 3. Merge into single stream
 * 
 * Constraints:
 * - max tokens: 7
 * - tx per token: 3
 * - total tx: ≤20
 * - min USD: $50k
 * 
 * NO ML, NO Engine, NO Signals
 */
import { TransferModel } from '../transfers/transfers.model.js';
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';

// ============ CONFIG ============

const CONFIG = {
  maxTokens: 7,
  txPerToken: 3,
  maxTotalTx: 20,
  minUsdThreshold: 50_000,
  minVolumeForRepresentative: 500_000, // $500k total
  minTokensForRepresentative: 3,
};

// Token metadata (same as in entity_metrics)
const KNOWN_DECIMALS: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,    // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,     // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,     // USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,     // WBTC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,    // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18,    // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18,    // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18,    // AAVE
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 18,    // wstETH
};

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

const KNOWN_SYMBOLS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'wstETH',
  'eth': 'ETH',
};

// ============ HELPERS ============

function getTokenDecimals(address: string): number | null {
  return KNOWN_DECIMALS[address.toLowerCase()] ?? null;
}

function getTokenPriceUSD(address: string): number | null {
  return KNOWN_PRICES[address.toLowerCase()] ?? null;
}

function getTokenSymbol(address: string): string {
  return KNOWN_SYMBOLS[address.toLowerCase()] || address.slice(0, 8);
}

function normalizeAmount(rawAmount: string | number, decimals: number): number {
  try {
    const raw = typeof rawAmount === 'string' ? BigInt(rawAmount) : BigInt(Math.floor(rawAmount));
    const divisor = BigInt(10 ** decimals);
    return Number(raw) / Number(divisor);
  } catch {
    return parseFloat(String(rawAmount)) / (10 ** decimals);
  }
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(timestamp: Date): string {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

async function getEntityAddresses(entitySlug: string): Promise<string[]> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) return [];
  
  // Only verified + attributed
  const addresses = await EntityAddressModel.find({ 
    entityId: (entity as any)._id.toString(),
    confidence: { $in: ['verified', 'attributed'] },
  }).lean();
  
  return addresses.map((a: any) => a.address.toLowerCase());
}

async function getVerifiedAddressSet(entitySlug: string): Promise<Set<string>> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) return new Set();
  
  const addresses = await EntityAddressModel.find({ 
    entityId: (entity as any)._id.toString(),
    confidence: 'verified',
  }).lean();
  
  return new Set(addresses.map((a: any) => a.address.toLowerCase()));
}

// ============ TYPES ============

export interface RecentTransaction {
  id: string;
  tokenSymbol: string;
  tokenAddress: string;
  direction: 'IN' | 'OUT';
  amount: number;
  amountFormatted: string;
  amountUSD: number | null;
  amountUSDFormatted: string | null;
  from: string;
  fromShort: string;
  to: string;
  toShort: string;
  timestamp: Date;
  timeAgo: string;
  txHash: string;
  // Source attribution
  source: 'verified' | 'attributed';
  // Context
  context: 'external_counterparty' | 'internal_transfer' | 'exchange_flow' | 'unknown';
}

export interface RecentTransactionsResult {
  window: string;
  transactions: RecentTransaction[];
  sampling: {
    tokensUsed: number;
    totalTokensAvailable: number;
    txPerToken: number;
    method: 'token_aware' | 'volume_weighted';
  };
  coverage: {
    totalVolumeUSD: number;
    isRepresentative: boolean;
    dominantAssets: string[]; // e.g., ['ETH', 'USDT']
  };
  status: 'representative' | 'limited' | 'insufficient';
  statusMessage: string | null;
  warnings: string[];
}

// ============ MAIN SERVICE ============

/**
 * Get Recent Transactions with Token-aware Sampling
 * 
 * EPIC 4: Sampled, Token-aware, Volume-weighted stream
 */
export async function getRecentTransactions(
  entitySlug: string,
  windowHours: number = 24
): Promise<RecentTransactionsResult> {
  const windowLabel = windowHours === 24 ? '24h' : windowHours === 168 ? '7d' : '30d';
  const addresses = await getEntityAddresses(entitySlug);
  const verifiedSet = await getVerifiedAddressSet(entitySlug);
  
  if (addresses.length === 0) {
    return {
      window: windowLabel,
      transactions: [],
      sampling: { tokensUsed: 0, totalTokensAvailable: 0, txPerToken: 0, method: 'token_aware' },
      coverage: { totalVolumeUSD: 0, isRepresentative: false, dominantAssets: [] },
      status: 'insufficient',
      statusMessage: 'No verified or attributed addresses',
      warnings: ['NO_ADDRESSES'],
    };
  }
  
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Step 1: Get Top tokens by volume
  const tokenVolumePipeline = [
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
      $group: {
        _id: '$assetAddress',
        totalVolume: { 
          $sum: { $toDouble: { $ifNull: ['$amountNormalized', 0] } }
        },
        txCount: { $sum: 1 },
      },
    },
    { $sort: { totalVolume: -1 as const } },
    { $limit: CONFIG.maxTokens + 5 }, // Get extra for filtering
  ];
  
  const tokenVolumes = await TransferModel.aggregate(tokenVolumePipeline as any[]);
  
  // Filter tokens with valid price data
  const validTokens: { address: string; volumeUSD: number }[] = [];
  let totalVolumeUSD = 0;
  
  for (const tv of tokenVolumes) {
    const tokenAddress = tv._id?.toLowerCase();
    if (!tokenAddress) continue;
    
    const decimals = getTokenDecimals(tokenAddress);
    const price = getTokenPriceUSD(tokenAddress);
    
    if (decimals === null || price === null) continue;
    
    const volumeUSD = tv.totalVolume * price;
    totalVolumeUSD += volumeUSD;
    
    validTokens.push({ address: tokenAddress, volumeUSD });
  }
  
  // Take top N tokens
  const topTokens = validTokens.slice(0, CONFIG.maxTokens);
  
  // Check if representative
  const isRepresentative = totalVolumeUSD >= CONFIG.minVolumeForRepresentative && 
                           topTokens.length >= CONFIG.minTokensForRepresentative;
  
  // Identify dominant assets
  const dominantAssets: string[] = [];
  const stablecoins = new Set(['USDT', 'USDC', 'DAI']);
  const baseAssets = new Set(['ETH', 'WETH']);
  
  for (const t of topTokens.slice(0, 3)) {
    const symbol = getTokenSymbol(t.address);
    if (stablecoins.has(symbol) || baseAssets.has(symbol)) {
      if (!dominantAssets.includes(symbol)) {
        dominantAssets.push(symbol);
      }
    }
  }
  
  if (topTokens.length === 0) {
    return {
      window: windowLabel,
      transactions: [],
      sampling: { tokensUsed: 0, totalTokensAvailable: validTokens.length, txPerToken: 0, method: 'token_aware' },
      coverage: { totalVolumeUSD, isRepresentative: false, dominantAssets },
      status: 'insufficient',
      statusMessage: 'Insufficient recent activity for representative sampling',
      warnings: ['NO_VALID_TOKENS'],
    };
  }
  
  // Step 2: For each token, get K recent transactions above threshold
  const transactions: RecentTransaction[] = [];
  
  for (const token of topTokens) {
    const price = getTokenPriceUSD(token.address);
    const decimals = getTokenDecimals(token.address);
    const symbol = getTokenSymbol(token.address);
    
    if (!price || !decimals) continue;
    
    // Calculate minimum amount in token units for $50k threshold
    const minAmount = CONFIG.minUsdThreshold / price;
    
    const txPipeline = [
      {
        $match: {
          assetAddress: token.address,
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
        $addFields: {
          normalizedAmount: { $toDouble: { $ifNull: ['$amountNormalized', 0] } },
        },
      },
      {
        $match: {
          normalizedAmount: { $gte: minAmount * 0.1 }, // Allow some below threshold
        },
      },
      { $sort: { timestamp: -1 as const } },
      { $limit: CONFIG.txPerToken * 2 }, // Get extra for filtering
    ];
    
    const tokenTxs = await TransferModel.aggregate(txPipeline as any[]);
    
    let addedForToken = 0;
    
    for (const tx of tokenTxs) {
      if (addedForToken >= CONFIG.txPerToken) break;
      if (transactions.length >= CONFIG.maxTotalTx) break;
      
      const amount = tx.normalizedAmount || 0;
      const amountUSD = amount * price;
      
      // Skip if below threshold (but allow some diversity)
      if (amountUSD < CONFIG.minUsdThreshold * 0.5 && addedForToken > 0) continue;
      
      const isInflow = addresses.includes(tx.to?.toLowerCase());
      const direction: 'IN' | 'OUT' = isInflow ? 'IN' : 'OUT';
      
      const entityAddress = isInflow ? tx.to?.toLowerCase() : tx.from?.toLowerCase();
      const counterparty = isInflow ? tx.from : tx.to;
      
      // Determine source (verified or attributed)
      const source = verifiedSet.has(entityAddress) ? 'verified' : 'attributed';
      
      // Determine context
      let context: RecentTransaction['context'] = 'unknown';
      const counterpartyLower = counterparty?.toLowerCase();
      
      if (counterpartyLower && addresses.includes(counterpartyLower)) {
        context = 'internal_transfer';
      } else if (counterpartyLower && verifiedSet.has(counterpartyLower)) {
        context = 'exchange_flow';
      } else {
        context = 'external_counterparty';
      }
      
      // Format amount
      const amountFormatted = amount >= 1000000 
        ? `${(amount / 1000000).toFixed(2)}M`
        : amount >= 1000 
          ? `${(amount / 1000).toFixed(1)}K`
          : amount.toFixed(2);
      
      const amountUSDFormatted = amountUSD >= 1000000
        ? `$${(amountUSD / 1000000).toFixed(2)}M`
        : `$${(amountUSD / 1000).toFixed(0)}K`;
      
      transactions.push({
        id: tx._id?.toString() || `${tx.txHash}-${tx.assetAddress}`,
        tokenSymbol: symbol,
        tokenAddress: token.address,
        direction,
        amount,
        amountFormatted,
        amountUSD,
        amountUSDFormatted,
        from: tx.from || '',
        fromShort: shortAddress(tx.from || ''),
        to: tx.to || '',
        toShort: shortAddress(tx.to || ''),
        timestamp: tx.timestamp,
        timeAgo: timeAgo(tx.timestamp),
        txHash: tx.txHash || '',
        source,
        context,
      });
      
      addedForToken++;
    }
  }
  
  // Sort by timestamp (most recent first)
  transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  // Determine status
  let status: RecentTransactionsResult['status'] = 'representative';
  let statusMessage: string | null = null;
  const warnings: string[] = [];
  
  if (!isRepresentative) {
    if (totalVolumeUSD < CONFIG.minVolumeForRepresentative) {
      status = 'limited';
      statusMessage = `Activity dominated by base assets (${dominantAssets.join(' / ')})`;
    } else if (topTokens.length < CONFIG.minTokensForRepresentative) {
      status = 'limited';
      statusMessage = 'Limited token diversity';
    }
    warnings.push('LIMITED_SAMPLE');
  }
  
  if (transactions.length < 5) {
    status = 'insufficient';
    statusMessage = 'Insufficient recent activity for representative sampling';
    warnings.push('LOW_TX_COUNT');
  }
  
  return {
    window: windowLabel,
    transactions,
    sampling: {
      tokensUsed: topTokens.length,
      totalTokensAvailable: validTokens.length,
      txPerToken: CONFIG.txPerToken,
      method: 'token_aware',
    },
    coverage: {
      totalVolumeUSD: Math.round(totalVolumeUSD),
      isRepresentative,
      dominantAssets,
    },
    status,
    statusMessage,
    warnings,
  };
}
