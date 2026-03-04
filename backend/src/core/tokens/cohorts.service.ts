/**
 * Wallet Cohorts Service (Optimized)
 * 
 * Groups wallets by time of first interaction with a token.
 * Philosophy: Facts only, no intent.
 */
import { TransferModel } from '../transfers/transfers.model.js';

// ============ TYPES ============

export interface WalletCohortMetrics {
  cohort: 'early' | 'mid' | 'new';
  walletsCount: number;
  holdingsUsd: number;
  holdingsSharePct: number;
  netFlowUsd: number;
  transfersCount: number;
}

export interface CohortFlow {
  from: 'early' | 'mid' | 'new';
  to: 'early' | 'mid' | 'new';
  amountUsd: number;
  txCount: number;
}

export interface TokenCohortsResponse {
  token: string;
  tokenAddress: string;
  window: string;
  cohorts: WalletCohortMetrics[];
  flowsBetweenCohorts: CohortFlow[];
  interpretation: { headline: string; description: string };
  source: string;
}

// ============ CONFIG ============

const TOKEN_PRICES: Record<string, number> = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,      // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,      // USDC
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 3200,   // WETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 62000,  // WBTC
};

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
};

const TOKEN_DECIMALS: Record<string, number> = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,
};

// Cohort boundaries in milliseconds
const EARLY_THRESHOLD = 12 * 30 * 24 * 60 * 60 * 1000; // >12 months
const MID_THRESHOLD = 3 * 30 * 24 * 60 * 60 * 1000;    // 3-12 months

// ============ OPTIMIZED CALCULATION ============

export async function calculateTokenCohorts(
  tokenAddress: string,
  windowDays: number = 7
): Promise<TokenCohortsResponse> {
  const addr = tokenAddress.toLowerCase();
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const earlyDate = new Date(now.getTime() - EARLY_THRESHOLD);
  const midDate = new Date(now.getTime() - MID_THRESHOLD);
  
  const decimals = TOKEN_DECIMALS[addr] || 18;
  const price = TOKEN_PRICES[addr] || 1;
  const symbol = TOKEN_SYMBOLS[addr] || addr.slice(0, 8);
  
  // Single optimized aggregation pipeline
  const pipeline = [
    { $match: { assetAddress: addr } },
    // Sample for performance on large datasets
    { $sample: { size: 50000 } },
    {
      $facet: {
        // Get wallet first seen dates
        walletStats: [
          {
            $group: {
              _id: { $cond: [{ $in: ['$to', []] }, '$from', '$to'] },
              firstSeen: { $min: '$timestamp' },
              totalIn: { $sum: { $cond: [{ $ne: ['$to', '$from'] }, { $toDouble: '$amountRaw' }, 0] } },
              totalOut: { $sum: { $cond: [{ $eq: ['$to', '$from'] }, 0, { $toDouble: '$amountRaw' }] } },
              txCount: { $sum: 1 }
            }
          }
        ],
        // Recent activity stats
        recentStats: [
          { $match: { timestamp: { $gte: windowStart } } },
          {
            $group: {
              _id: null,
              totalVolume: { $sum: { $toDouble: '$amountRaw' } },
              txCount: { $sum: 1 }
            }
          }
        ]
      }
    }
  ];
  
  const [result] = await TransferModel.aggregate(pipeline).allowDiskUse(true);
  
  // Initialize cohort data
  const cohorts: Record<string, { wallets: number; holdings: number; netFlow: number; txCount: number }> = {
    early: { wallets: 0, holdings: 0, netFlow: 0, txCount: 0 },
    mid: { wallets: 0, holdings: 0, netFlow: 0, txCount: 0 },
    new: { wallets: 0, holdings: 0, netFlow: 0, txCount: 0 },
  };
  
  // Process wallet stats
  for (const w of result?.walletStats || []) {
    const firstSeen = new Date(w.firstSeen);
    const cohort = firstSeen < earlyDate ? 'early' : firstSeen < midDate ? 'mid' : 'new';
    const holdings = (w.totalIn - w.totalOut) / (10 ** decimals);
    
    cohorts[cohort].wallets++;
    cohorts[cohort].holdings += Math.max(0, holdings);
    cohorts[cohort].txCount += w.txCount;
  }
  
  // Calculate totals and percentages
  const totalHoldings = cohorts.early.holdings + cohorts.mid.holdings + cohorts.new.holdings;
  
  const cohortMetrics: WalletCohortMetrics[] = ['early', 'mid', 'new'].map(c => ({
    cohort: c as 'early' | 'mid' | 'new',
    walletsCount: cohorts[c].wallets,
    holdingsUsd: cohorts[c].holdings * price,
    holdingsSharePct: totalHoldings > 0 ? Math.round((cohorts[c].holdings / totalHoldings) * 100) : 0,
    netFlowUsd: 0, // Simplified for performance
    transfersCount: cohorts[c].txCount,
  }));
  
  // Generate interpretation
  const early = cohortMetrics[0];
  const newC = cohortMetrics[2];
  
  let headline = 'Wallet cohort distribution observed';
  let description = `${early.walletsCount + cohortMetrics[1].walletsCount + newC.walletsCount} wallets analyzed across cohorts.`;
  
  if (early.holdingsSharePct > 60) {
    headline = 'Holdings concentration in early wallets';
    description = `Early wallets hold ${early.holdingsSharePct}% of observed token supply.`;
  } else if (newC.walletsCount > early.walletsCount * 2) {
    headline = 'Wallet base expansion observed';
    description = 'New wallet participation exceeds early cohort significantly.';
  }
  
  return {
    token: symbol,
    tokenAddress: addr,
    window: `${windowDays}d`,
    cohorts: cohortMetrics,
    flowsBetweenCohorts: [], // Simplified for now
    interpretation: { headline, description },
    source: cohortMetrics.some(c => c.walletsCount > 0) ? 'indexed_transfers' : 'no_data',
  };
}
