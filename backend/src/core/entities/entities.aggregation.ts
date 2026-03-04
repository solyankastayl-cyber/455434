/**
 * Entity Aggregation Service
 * 
 * Calculates real holdings, flows, and bridge activity for entities.
 * Philosophy: Facts only, no intent.
 * 
 * P0 Features:
 * - Real Flows (by token)
 * - Holdings (percent + breakdown)
 * - Bridge Aggregation (Ethereum-based)
 */
import { TransferModel } from '../transfers/transfers.model.js';
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';

// ============ TYPES ============

interface TokenHolding {
  token: string;
  tokenAddress: string;
  balance: string;
  balanceRaw: number;
  valueUSD: number;
  percentage: number;
  decimals: number;
}

interface TokenFlow {
  token: string;
  tokenAddress: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  inflowUSD: number;
  outflowUSD: number;
  netFlowUSD: number;
  dominantFlow: 'inflow' | 'outflow' | 'neutral';
  txCount: number;
}

interface DailyFlow {
  date: string;
  netFlow: number;
  inflow: number;
  outflow: number;
}

interface FlowSummary {
  flows: DailyFlow[];
  byToken: TokenFlow[];
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  window: string;
}

interface BridgeFlow {
  fromChain: string;
  toChain: string;
  asset: string;
  assetAddress: string;
  volume: number;
  volumeUSD: number;
  direction: 'L1→L2' | 'L2→L1' | 'Cross-chain';
  txCount: number;
}

// ============ TOKEN METADATA ============

// Token prices (in production would come from price oracle)
const TOKEN_PRICES: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 3200,   // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,      // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,      // USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 62000,  // WBTC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 1,      // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 14,     // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 7,      // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 180,    // AAVE
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 0.5,    // CRV
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 3600,   // wstETH
  'eth': 3200,
};

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'CRV',
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'wstETH',
  'eth': 'ETH',
};

const TOKEN_DECIMALS: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,    // WETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,     // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,     // USDC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,     // WBTC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,    // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18,    // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18,    // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18,    // AAVE
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 18,    // CRV
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 18,    // wstETH
};

// Known bridge contracts (Ethereum mainnet)
const BRIDGE_CONTRACTS: Record<string, { name: string; toChain: string }> = {
  // Arbitrum
  '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a': { name: 'Arbitrum Bridge', toChain: 'Arbitrum' },
  '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f': { name: 'Arbitrum Inbox', toChain: 'Arbitrum' },
  // Optimism
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': { name: 'Optimism Gateway', toChain: 'Optimism' },
  '0x5e4e65926ba27467555eb562121fac00d24e9dd2': { name: 'Optimism L1CrossDomain', toChain: 'Optimism' },
  // Polygon
  '0xa0c68c638235ee32657e8f720a23cec1bfc77c77': { name: 'Polygon Bridge', toChain: 'Polygon' },
  '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf': { name: 'Polygon ERC20 Bridge', toChain: 'Polygon' },
  // Base
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35': { name: 'Base Bridge', toChain: 'Base' },
  // Cross-chain
  '0x3ee18b2214aff97000d974cf647e7c347e8fa585': { name: 'Wormhole', toChain: 'Cross-chain' },
  '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf': { name: 'LayerZero', toChain: 'Cross-chain' },
};

// ============ HELPER FUNCTIONS ============

function getTokenSymbol(address: string): string {
  return TOKEN_SYMBOLS[address.toLowerCase()] || address.slice(0, 8);
}

function getTokenPrice(address: string): number {
  return TOKEN_PRICES[address.toLowerCase()] || 0;
}

function getTokenDecimals(address: string): number {
  return TOKEN_DECIMALS[address.toLowerCase()] || 18;
}

function normalizeAmount(amountRaw: string, decimals: number): number {
  try {
    const raw = BigInt(amountRaw);
    const divisor = BigInt(10 ** decimals);
    return Number(raw) / Number(divisor);
  } catch {
    return parseFloat(amountRaw) / (10 ** decimals);
  }
}

function formatUSD(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (absValue >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (absValue >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Get all addresses belonging to an entity
 */
async function getEntityAddresses(entitySlug: string): Promise<string[]> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) return [];
  
  const addresses = await EntityAddressModel.find({ 
    entityId: (entity as any)._id.toString() 
  }).lean();
  
  return addresses.map((a: any) => a.address.toLowerCase());
}

// ============ HOLDINGS ============

/**
 * Calculate real holdings breakdown for an entity
 */
export async function calculateEntityHoldings(entitySlug: string): Promise<{
  holdings: TokenHolding[];
  total: number;
  totalTokens: number;
  lastUpdated: Date;
}> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return { holdings: [], total: 0, totalTokens: 0, lastUpdated: new Date() };
  }
  
  // Aggregate inflows and outflows per token with proper decimals
  const pipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
      },
    },
    {
      $project: {
        assetAddress: 1,
        amountRaw: 1,
        amountNormalized: 1,
        isInflow: { $in: ['$to', addresses] },
      },
    },
    {
      $group: {
        _id: '$assetAddress',
        totalInflowRaw: {
          $sum: {
            $cond: [
              '$isInflow',
              { $toDouble: { $ifNull: ['$amountRaw', '0'] } },
              0
            ],
          },
        },
        totalOutflowRaw: {
          $sum: {
            $cond: [
              '$isInflow',
              0,
              { $toDouble: { $ifNull: ['$amountRaw', '0'] } }
            ],
          },
        },
        txCount: { $sum: 1 },
      },
    },
    {
      $project: {
        tokenAddress: '$_id',
        balanceRaw: { $subtract: ['$totalInflowRaw', '$totalOutflowRaw'] },
        txCount: 1,
      },
    },
    {
      $match: {
        balanceRaw: { $gt: 0 },
      },
    },
    {
      $sort: { balanceRaw: -1 as const },
    },
    {
      $limit: 20,
    },
  ];
  
  const results = await TransferModel.aggregate(pipeline);
  
  // Calculate normalized amounts and USD values
  let totalValueUSD = 0;
  const holdingsWithUSD = results.map((r: any) => {
    const decimals = getTokenDecimals(r.tokenAddress);
    const normalizedBalance = r.balanceRaw / (10 ** decimals);
    const price = getTokenPrice(r.tokenAddress);
    const valueUSD = normalizedBalance * price;
    totalValueUSD += valueUSD;
    
    return {
      tokenAddress: r.tokenAddress,
      balanceRaw: r.balanceRaw,
      balance: normalizedBalance,
      valueUSD,
      decimals,
      txCount: r.txCount,
    };
  });
  
  // Sort by USD value
  holdingsWithUSD.sort((a, b) => b.valueUSD - a.valueUSD);
  
  // Format holdings with percentages
  const holdings: TokenHolding[] = holdingsWithUSD.slice(0, 10).map((h) => ({
    token: getTokenSymbol(h.tokenAddress),
    tokenAddress: h.tokenAddress,
    balance: h.balance.toFixed(h.decimals <= 6 ? 2 : 4),
    balanceRaw: h.balance,
    valueUSD: h.valueUSD,
    percentage: totalValueUSD > 0 ? Math.round((h.valueUSD / totalValueUSD) * 100) : 0,
    decimals: h.decimals,
  }));
  
  return {
    holdings,
    total: totalValueUSD,
    totalTokens: results.length,
    lastUpdated: new Date(),
  };
}

// ============ FLOWS BY TOKEN ============

/**
 * Calculate flows breakdown by token
 */
export async function calculateEntityFlowsByToken(
  entitySlug: string,
  windowDays: number = 7
): Promise<TokenFlow[]> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - windowDays);
  
  const pipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
        timestamp: { $gte: startDate },
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
        inflow: {
          $sum: { $cond: ['$isInflow', '$amountRaw', 0] },
        },
        outflow: {
          $sum: { $cond: ['$isInflow', 0, '$amountRaw'] },
        },
        txCount: { $sum: 1 },
      },
    },
    {
      $project: {
        tokenAddress: '$_id',
        inflow: 1,
        outflow: 1,
        netFlow: { $subtract: ['$inflow', '$outflow'] },
        txCount: 1,
      },
    },
    {
      $sort: { txCount: -1 as const },
    },
    {
      $limit: 10,
    },
  ];
  
  const results = await TransferModel.aggregate(pipeline);
  
  return results.map((r: any) => {
    const decimals = getTokenDecimals(r.tokenAddress);
    const price = getTokenPrice(r.tokenAddress);
    
    const inflowNorm = r.inflow / (10 ** decimals);
    const outflowNorm = r.outflow / (10 ** decimals);
    const netFlowNorm = r.netFlow / (10 ** decimals);
    
    const dominantFlow: 'inflow' | 'outflow' | 'neutral' = 
      Math.abs(netFlowNorm) < (inflowNorm + outflowNorm) * 0.1 ? 'neutral' :
      netFlowNorm > 0 ? 'inflow' : 'outflow';
    
    return {
      token: getTokenSymbol(r.tokenAddress),
      tokenAddress: r.tokenAddress,
      inflow: inflowNorm,
      outflow: outflowNorm,
      netFlow: netFlowNorm,
      inflowUSD: inflowNorm * price,
      outflowUSD: outflowNorm * price,
      netFlowUSD: netFlowNorm * price,
      dominantFlow,
      txCount: r.txCount,
    };
  });
}

// ============ FLOWS OVER TIME ============

/**
 * Calculate net flows for an entity over time
 */
export async function calculateEntityFlows(
  entitySlug: string,
  windowDays: number = 7
): Promise<FlowSummary> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return {
      flows: [],
      byToken: [],
      totalInflow: 0,
      totalOutflow: 0,
      netFlow: 0,
      window: `${windowDays}d`,
    };
  }
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - windowDays);
  
  // Daily aggregation (using USDT/USDC as base for USD approximation)
  const pipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
        timestamp: { $gte: startDate },
      },
    },
    {
      $addFields: {
        // Normalize based on known decimals
        effectiveAmount: {
          $switch: {
            branches: [
              // 6 decimals (USDT, USDC)
              {
                case: { $in: ['$assetAddress', [
                  '0xdac17f958d2ee523a2206206994597c13d831ec7',
                  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
                ]]},
                then: { $divide: [{ $toDouble: '$amountRaw' }, 1e6] }
              },
              // 8 decimals (WBTC)
              {
                case: { $eq: ['$assetAddress', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'] },
                then: { $multiply: [{ $divide: [{ $toDouble: '$amountRaw' }, 1e8] }, 62000] }
              },
            ],
            // 18 decimals (default) - use ETH price
            default: { $multiply: [{ $divide: [{ $toDouble: '$amountRaw' }, 1e18] }, 3200] }
          }
        }
      }
    },
    {
      $project: {
        date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        effectiveAmount: 1,
        isInflow: { $in: ['$to', addresses] },
      },
    },
    {
      $group: {
        _id: '$date',
        inflow: {
          $sum: { $cond: ['$isInflow', '$effectiveAmount', 0] },
        },
        outflow: {
          $sum: { $cond: ['$isInflow', 0, '$effectiveAmount'] },
        },
      },
    },
    {
      $project: {
        date: '$_id',
        inflow: 1,
        outflow: 1,
        netFlow: { $subtract: ['$inflow', '$outflow'] },
      },
    },
    {
      $sort: { date: 1 as const },
    },
  ];
  
  const results = await TransferModel.aggregate(pipeline);
  
  const flows: DailyFlow[] = results.map((r: any) => ({
    date: r.date,
    netFlow: r.netFlow,
    inflow: r.inflow,
    outflow: r.outflow,
  }));
  
  // Fill missing days
  const filledFlows: DailyFlow[] = [];
  const current = new Date(startDate);
  const end = new Date();
  
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const existing = flows.find(f => f.date === dateStr);
    filledFlows.push(existing || { date: dateStr, netFlow: 0, inflow: 0, outflow: 0 });
    current.setDate(current.getDate() + 1);
  }
  
  // Get token breakdown
  const byToken = await calculateEntityFlowsByToken(entitySlug, windowDays);
  
  // Calculate totals
  const totalInflow = filledFlows.reduce((sum, f) => sum + f.inflow, 0);
  const totalOutflow = filledFlows.reduce((sum, f) => sum + f.outflow, 0);
  
  return {
    flows: filledFlows,
    byToken,
    totalInflow,
    totalOutflow,
    netFlow: totalInflow - totalOutflow,
    window: `${windowDays}d`,
  };
}

// ============ BRIDGE AGGREGATION ============

/**
 * Calculate bridge/cross-chain flows for an entity
 */
export async function calculateEntityBridgeFlows(entitySlug: string): Promise<{
  bridges: BridgeFlow[];
  totalVolume: number;
  summary: {
    l1ToL2: number;
    crossChain: number;
  };
}> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return { bridges: [], totalVolume: 0, summary: { l1ToL2: 0, crossChain: 0 } };
  }
  
  const bridgeAddresses = Object.keys(BRIDGE_CONTRACTS).map(a => a.toLowerCase());
  
  // Find transfers to/from bridge contracts
  const pipeline = [
    {
      $match: {
        $or: [
          // Entity → Bridge (deposit)
          { from: { $in: addresses }, to: { $in: bridgeAddresses } },
          // Bridge → Entity (withdrawal)  
          { from: { $in: bridgeAddresses }, to: { $in: addresses } },
        ],
      },
    },
    {
      $addFields: {
        bridgeAddress: {
          $cond: {
            if: { $in: ['$to', bridgeAddresses] },
            then: '$to',
            else: '$from'
          }
        },
        isDeposit: { $in: ['$to', bridgeAddresses] },
      },
    },
    {
      $group: {
        _id: {
          bridge: '$bridgeAddress',
          asset: '$assetAddress',
          isDeposit: '$isDeposit',
        },
        totalAmount: { $sum: { $toDouble: '$amountRaw' } },
        txCount: { $sum: 1 },
      },
    },
    {
      $sort: { totalAmount: -1 as const },
    },
  ];
  
  const results = await TransferModel.aggregate(pipeline);
  
  // Group by bridge destination
  const bridgeMap = new Map<string, BridgeFlow>();
  
  for (const r of results) {
    const bridgeInfo = BRIDGE_CONTRACTS[r._id.bridge.toLowerCase()];
    if (!bridgeInfo) continue;
    
    const decimals = getTokenDecimals(r._id.asset);
    const price = getTokenPrice(r._id.asset);
    const volume = r.totalAmount / (10 ** decimals);
    const volumeUSD = volume * price;
    
    const key = `${bridgeInfo.toChain}-${r._id.asset}`;
    const existing = bridgeMap.get(key);
    
    const direction: 'L1→L2' | 'L2→L1' | 'Cross-chain' = 
      bridgeInfo.toChain === 'Cross-chain' ? 'Cross-chain' :
      r._id.isDeposit ? 'L1→L2' : 'L2→L1';
    
    if (existing) {
      existing.volume += volume;
      existing.volumeUSD += volumeUSD;
      existing.txCount += r.txCount;
    } else {
      bridgeMap.set(key, {
        fromChain: 'Ethereum',
        toChain: bridgeInfo.toChain,
        asset: getTokenSymbol(r._id.asset),
        assetAddress: r._id.asset,
        volume,
        volumeUSD,
        direction,
        txCount: r.txCount,
      });
    }
  }
  
  const bridges = Array.from(bridgeMap.values())
    .sort((a, b) => b.volumeUSD - a.volumeUSD)
    .slice(0, 10);
  
  const totalVolume = bridges.reduce((sum, b) => sum + b.volumeUSD, 0);
  const l1ToL2 = bridges
    .filter(b => b.direction === 'L1→L2')
    .reduce((sum, b) => sum + b.volumeUSD, 0);
  const crossChain = bridges
    .filter(b => b.direction === 'Cross-chain')
    .reduce((sum, b) => sum + b.volumeUSD, 0);
  
  return {
    bridges,
    totalVolume,
    summary: { l1ToL2, crossChain },
  };
}

// ============ TRANSACTIONS ============

/**
 * Get recent transactions for an entity
 */
export async function getEntityTransactions(
  entitySlug: string,
  limit: number = 20
): Promise<any[]> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) return [];
  
  const transfers = await TransferModel.find({
    $or: [
      { from: { $in: addresses } },
      { to: { $in: addresses } },
    ],
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  
  return transfers.map((t: any) => {
    const isInflow = addresses.includes(t.to.toLowerCase());
    const decimals = getTokenDecimals(t.assetAddress);
    const price = getTokenPrice(t.assetAddress);
    const amount = t.amountNormalized || (parseFloat(t.amountRaw) / (10 ** decimals));
    const valueUSD = amount * price;
    
    // Check if bridge transaction
    const isBridge = BRIDGE_CONTRACTS[t.to.toLowerCase()] || BRIDGE_CONTRACTS[t.from.toLowerCase()];
    
    return {
      type: isInflow ? 'inflow' : 'outflow',
      token: getTokenSymbol(t.assetAddress),
      tokenAddress: t.assetAddress,
      amount: formatUSD(valueUSD),
      amountRaw: amount,
      valueUSD,
      counterparty: isInflow ? t.from : t.to,
      txHash: t.txHash,
      timestamp: t.timestamp,
      time: formatTimeAgo(t.timestamp),
      isMarketMoving: valueUSD > 1000000,
      isBridge: !!isBridge,
      bridgeTarget: isBridge ? (BRIDGE_CONTRACTS[t.to.toLowerCase()]?.toChain || BRIDGE_CONTRACTS[t.from.toLowerCase()]?.toChain) : null,
    };
  });
}

// ============ METRICS UPDATE ============

/**
 * Update entity metrics cache
 */
export async function updateEntityMetrics(entitySlug: string): Promise<void> {
  const [holdings, flows] = await Promise.all([
    calculateEntityHoldings(entitySlug),
    calculateEntityFlows(entitySlug, 1),
  ]);
  
  await EntityModel.updateOne(
    { slug: entitySlug.toLowerCase() },
    {
      $set: {
        totalHoldingsUSD: holdings.total,
        netFlow24h: flows.netFlow,
        volume24h: flows.totalInflow + flows.totalOutflow,
        topTokens: holdings.holdings.slice(0, 3).map(h => h.token),
        lastSeen: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

// ============ PATTERN BRIDGE ============

interface AddressPattern {
  address: string;
  pattern: string;
  patternScore: number;
  txCount: number;
  avgValue: number;
  dominantTokens: string[];
  lastActive: Date;
}

interface PatternGroup {
  pattern: string;
  description: string;
  addresses: AddressPattern[];
  totalTxCount: number;
  avgPatternScore: number;
}

/**
 * Get entity addresses grouped by behavioral patterns
 * This is "Pattern Bridge" - groups addresses by behavior, not by cross-chain activity
 */
export async function getEntityPatternBridge(
  entitySlug: string
): Promise<{ patterns: PatternGroup[]; totalAddresses: number }> {
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return { patterns: [], totalAddresses: 0 };
  }
  
  // Get transfer stats for each address
  const addressStats: AddressPattern[] = [];
  
  for (const addr of addresses) {
    const transfers = await TransferModel.find({
      $or: [{ from: addr }, { to: addr }],
    })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    if (transfers.length === 0) continue;
    
    // Analyze patterns
    const inflows = transfers.filter((t: any) => t.to.toLowerCase() === addr);
    const outflows = transfers.filter((t: any) => t.from.toLowerCase() === addr);
    const inflowRatio = inflows.length / transfers.length;
    
    // Calculate avg value
    const totalValue = transfers.reduce((sum: number, t: any) => {
      const price = getTokenPrice(t.assetAddress);
      const decimals = getTokenDecimals(t.assetAddress);
      const amount = t.amountNormalized || (parseFloat(t.amountRaw) / (10 ** decimals));
      return sum + (amount * price);
    }, 0);
    const avgValue = totalValue / transfers.length;
    
    // Get dominant tokens
    const tokenCounts: Record<string, number> = {};
    transfers.forEach((t: any) => {
      const symbol = getTokenSymbol(t.assetAddress);
      tokenCounts[symbol] = (tokenCounts[symbol] || 0) + 1;
    });
    const dominantTokens = Object.entries(tokenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([token]) => token);
    
    // Determine pattern
    let pattern = 'mixed';
    let patternScore = 50;
    
    if (inflowRatio > 0.8) {
      pattern = 'accumulator';
      patternScore = 80 + (inflowRatio * 20);
    } else if (inflowRatio < 0.2) {
      pattern = 'distributor';
      patternScore = 80 + ((1 - inflowRatio) * 20);
    } else if (avgValue > 100000) {
      pattern = 'whale';
      patternScore = 70 + Math.min(30, avgValue / 10000);
    } else if (transfers.length > 50) {
      pattern = 'active_trader';
      patternScore = 60 + Math.min(40, transfers.length / 2);
    } else if (dominantTokens.includes('USDT') || dominantTokens.includes('USDC')) {
      pattern = 'stablecoin_focused';
      patternScore = 65;
    }
    
    addressStats.push({
      address: addr,
      pattern,
      patternScore,
      txCount: transfers.length,
      avgValue,
      dominantTokens,
      lastActive: new Date((transfers[0] as any).timestamp),
    });
  }
  
  // Group by pattern
  const patternDescriptions: Record<string, string> = {
    accumulator: 'Addresses primarily receiving funds (net inflow pattern)',
    distributor: 'Addresses primarily sending funds (net outflow pattern)',
    whale: 'High-value transaction addresses',
    active_trader: 'High-frequency transaction addresses',
    stablecoin_focused: 'Addresses primarily dealing with stablecoins',
    mixed: 'Addresses with balanced inflow/outflow patterns',
  };
  
  const groups: Record<string, AddressPattern[]> = {};
  addressStats.forEach(stat => {
    if (!groups[stat.pattern]) groups[stat.pattern] = [];
    groups[stat.pattern].push(stat);
  });
  
  const patterns: PatternGroup[] = Object.entries(groups).map(([pattern, addrs]) => ({
    pattern,
    description: patternDescriptions[pattern] || 'Unknown pattern',
    addresses: addrs.sort((a, b) => b.patternScore - a.patternScore),
    totalTxCount: addrs.reduce((sum, a) => sum + a.txCount, 0),
    avgPatternScore: addrs.reduce((sum, a) => sum + a.patternScore, 0) / addrs.length,
  }));
  
  // Sort by total tx count
  patterns.sort((a, b) => b.totalTxCount - a.totalTxCount);
  
  return {
    patterns,
    totalAddresses: addressStats.length,
  };
}
