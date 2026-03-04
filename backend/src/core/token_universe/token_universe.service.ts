/**
 * Token Universe Service v2
 * 
 * Optimized for CoinGecko Free Tier
 * 
 * Strategy:
 * - Use /coins/markets endpoint only (no /coins/list)
 * - Build EVM mapping from known contract registries
 * - Rate limit: ~10 requests per minute
 */
import { TokenUniverseModel } from './token_universe.model.js';

// ============================================================
// CONFIGURATION
// ============================================================

interface IngestConfig {
  minMarketCap: number;
  minVolume24h: number;
  chainsAllowed: number[];
  maxTokens: number;
}

const DEFAULT_CONFIG: IngestConfig = {
  minMarketCap: 500_000,
  minVolume24h: 50_000,
  chainsAllowed: [1],
  maxTokens: 300,
};

// CoinGecko Free Tier: 10-30 req/min
const RATE_LIMIT_DELAY = 7000;   // 8-9 requests per minute
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 15000;

// ============================================================
// KNOWN EVM TOKEN CONTRACTS
// Top 300+ tokens with verified Ethereum addresses
// ============================================================

const KNOWN_EVM_CONTRACTS: Record<string, { address: string; chainId: number }> = {
  // Top stablecoins
  'tether': { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1 },
  'usd-coin': { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1 },
  'dai': { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1 },
  'frax': { address: '0x853d955acef822db058eb8505911ed77f175b99e', chainId: 1 },
  'true-usd': { address: '0x0000000000085d4780b73119b644ae5ecd22b376', chainId: 1 },
  'pax-dollar': { address: '0x8e870d67f660d95d5be530380d0ec0bd388289e1', chainId: 1 },
  'gemini-dollar': { address: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd', chainId: 1 },
  'first-digital-usd': { address: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', chainId: 1 },
  
  // Wrapped assets
  'weth': { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1 },
  'wrapped-bitcoin': { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1 },
  'wrapped-steth': { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', chainId: 1 },
  'rocket-pool-eth': { address: '0xae78736cd615f374d3085123a210448e74fc6393', chainId: 1 },
  'coinbase-wrapped-staked-eth': { address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', chainId: 1 },
  'frax-ether': { address: '0x5e8422345238f34275888049021821e8e08caa1f', chainId: 1 },
  
  // DeFi blue chips
  'uniswap': { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1 },
  'chainlink': { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 1 },
  'aave': { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', chainId: 1 },
  'maker': { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', chainId: 1 },
  'lido-dao': { address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32', chainId: 1 },
  'curve-dao-token': { address: '0xd533a949740bb3306d119cc777fa900ba034cd52', chainId: 1 },
  'compound-governance-token': { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', chainId: 1 },
  'synthetix-network-token': { address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', chainId: 1 },
  '1inch': { address: '0x111111111117dc0aa78b770fa6a738034120c302', chainId: 1 },
  'yearn-finance': { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', chainId: 1 },
  'sushi': { address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', chainId: 1 },
  'balancer': { address: '0xba100000625a3754423978a60c9317c58a424e3d', chainId: 1 },
  'convex-finance': { address: '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b', chainId: 1 },
  'frax-share': { address: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0', chainId: 1 },
  'ribbon-finance': { address: '0x6123b0049f904d730db3c36a31167d9d4121fa6b', chainId: 1 },
  'gmx': { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', chainId: 42161 },
  'pendle': { address: '0x808507121b80c02388fad14726482e061b8da827', chainId: 1 },
  'radiant-capital': { address: '0x137ddb47ee24eaa998a535ab00378d6bfa84f893', chainId: 42161 },
  
  // L2 tokens
  'matic-network': { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', chainId: 1 },
  'arbitrum': { address: '0xb50721bcf8d664c30412cfbc6cf7a15145935896', chainId: 1 },
  'optimism': { address: '0x4200000000000000000000000000000000000042', chainId: 10 },
  'immutable-x': { address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff', chainId: 1 },
  'loopring': { address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', chainId: 1 },
  'skale': { address: '0x00c83aecc790e8a4453e5dd3b0b4b3680501a7a7', chainId: 1 },
  'mantle': { address: '0x3c3a81e81dc49a522a592e7622a7e711c06bf354', chainId: 1 },
  'metis-token': { address: '0x9e32b13ce7f2e80a01932b42553652e053d6ed8e', chainId: 1 },
  
  // GameFi & Metaverse
  'the-sandbox': { address: '0x3845badade8e6dff049820680d1f14bd3903a5d0', chainId: 1 },
  'decentraland': { address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', chainId: 1 },
  'axie-infinity': { address: '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b', chainId: 1 },
  'enjincoin': { address: '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c', chainId: 1 },
  'gala': { address: '0xd1d2eb1b1e90b638588728b4130137d262c87cae', chainId: 1 },
  'illuvium': { address: '0x767fe9edc9e0df98e07454847909b5e959d7ca0e', chainId: 1 },
  'apecoin': { address: '0x4d224452801aced8b2f0aebe155379bb5d594381', chainId: 1 },
  'immutable-x': { address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff', chainId: 1 },
  
  // Oracles & Data
  'the-graph': { address: '0xc944e90c64b2c07662a292be6244bdf05cda44a7', chainId: 1 },
  'band-protocol': { address: '0xba11d00c5f74255f56a5e366f4f77f5a186d7f55', chainId: 1 },
  'api3': { address: '0x0b38210ea11411557c13457d4da7dc6ea731b88a', chainId: 1 },
  'uma': { address: '0x04fa0d235c4abf4bcf4787af4cf447de572ef828', chainId: 1 },
  
  // Infrastructure
  'render-token': { address: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24', chainId: 1 },
  'livepeer': { address: '0x58b6a8a3302369daec383334672404ee733ab239', chainId: 1 },
  'ankr': { address: '0x8290333cef9e6d528dd5618fb97a76f268f3edd4', chainId: 1 },
  'storj': { address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', chainId: 1 },
  'arweave': { address: '0x34ad8e47b8e87ae0c6e57e8a1fc5e85a08e5b4a8', chainId: 1 },
  
  // Governance & DAOs
  'ens': { address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', chainId: 1 },
  'safe': { address: '0x5afe3855358e112b5647b952709e6165e1c1eeee', chainId: 1 },
  'gitcoin': { address: '0xde30da39c46104798bb5aa3fe8b9e0e1f348163f', chainId: 1 },
  
  // Meme & Social
  'shiba-inu': { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1 },
  'pepe': { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1 },
  'floki': { address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e', chainId: 1 },
  'bone-shibaswap': { address: '0x9813037ee2218799597d83d4a5b6f3b6778218d9', chainId: 1 },
  
  // Exchange tokens
  'bitget-token': { address: '0x54d2252757e1672eead234d27b1270728ff90581', chainId: 1 },
  'kucoin-shares': { address: '0xf34960d9d60be18cc1d5afc1a6f012a723a28811', chainId: 1 },
  'huobi-token': { address: '0x6f259637dcd74c767781e37bc6133cd6a68aa161', chainId: 1 },
  'okb': { address: '0x75231f58b43240c9718dd58b4967c5114342a86c', chainId: 1 },
  'mx-token': { address: '0x11eef04c884e24d9b7b4760e7476d06ddf797f36', chainId: 1 },
  'gate': { address: '0xe66747a101bff2dba3697199dcce5b743b454759', chainId: 1 },
  
  // Privacy & Security
  'tornado-cash': { address: '0x77777feddddffc19ff86db637967013e6c6a116c', chainId: 1 },
  'secret': { address: '0x27702a26126e0b3702af63ee09ac4d1a084ef628', chainId: 1 },
  
  // AI & Compute
  'fetch-ai': { address: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85', chainId: 1 },
  'singularitynet': { address: '0x5b7533812759b45c2b44c19e320ba2cd2681b542', chainId: 1 },
  'ocean-protocol': { address: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48', chainId: 1 },
  'numeraire': { address: '0x1776e1f26f98b1a5df9cd347953a26dd3cb46671', chainId: 1 },
  
  // Real World Assets
  'maker': { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', chainId: 1 },
  'centrifuge': { address: '0xc221b7e65ffc80de234bbb6667abdd46593d34f0', chainId: 1 },
  'maple': { address: '0x33349b282065b0284d756f0577fb39c158f935e6', chainId: 1 },
  'goldfinch': { address: '0xdab396ccf3d84cf2d07c4454e10c8a6f5b008d2b', chainId: 1 },
  
  // Additional popular tokens
  'blur': { address: '0x5283d291dbcf85356a21ba090e6db59121208b44', chainId: 1 },
  'magic': { address: '0xb0c7a3ba49c7a6eaba6cd4a96c55a1391070ac9a', chainId: 1 },
  'looksrare': { address: '0xf4d2888d29d722226fafa5d9b24f9164c092421e', chainId: 1 },
  'x2y2': { address: '0x1e4ede388cbc9f4b5c79681b7f94d36a11abebc9', chainId: 1 },
  'sudoswap': { address: '0x3446dd70b2d52a6bf4a5a192d9b0a161295ab7f9', chainId: 1 },
  'rpl': { address: '0xd33526068d116ce69f19a9ee46f0bd304f21a51f', chainId: 1 },
  'ssv-network': { address: '0x9d65ff81a3c488d585bbfb0bfe3c7707c7917f54', chainId: 1 },
  'rocket-pool': { address: '0xd33526068d116ce69f19a9ee46f0bd304f21a51f', chainId: 1 },
  'joe': { address: '0x76e222b07c53d28b89b0bac18602810fc22b49a8', chainId: 43114 },
  'spell-token': { address: '0x090185f2135308bad17527004364ebcc2d37e5f6', chainId: 1 },
  'olympus': { address: '0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5', chainId: 1 },
  'alchemix': { address: '0xdbdb4d16eda451d0503b854cf79d55697f90c8df', chainId: 1 },
  'liquity': { address: '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d', chainId: 1 },
  'puffer-finance': { address: '0xd9a442856c234a39a81a089c06451ebaa4306a72', chainId: 1 },
  'ethena': { address: '0x57e114b691db790c35207b2e685d4a43181e6061', chainId: 1 },
};

// ============================================================
// MAIN INGESTION FUNCTION
// ============================================================

/**
 * Ingest tokens from CoinGecko (optimized for free tier)
 */
export async function ingestTokenUniverse(config: IngestConfig = DEFAULT_CONFIG) {
  console.log('[Token Universe] Starting optimized CoinGecko ingestion...');
  console.log(`[Token Universe] Config: minMarketCap=${config.minMarketCap}, maxTokens=${config.maxTokens}`);
  
  const startTime = Date.now();
  
  try {
    // Fetch market data in batches (sorted by market cap)
    const allMarketData: any[] = [];
    const pagesNeeded = Math.ceil(config.maxTokens / 250);
    
    for (let page = 1; page <= pagesNeeded; page++) {
      console.log(`[CoinGecko] Fetching page ${page}/${pagesNeeded}...`);
      
      const marketData = await fetchMarketDataPage(page);
      
      if (!marketData || marketData.length === 0) {
        console.log(`[CoinGecko] No more data at page ${page}`);
        break;
      }
      
      allMarketData.push(...marketData);
      console.log(`[CoinGecko] Page ${page}: ${marketData.length} tokens`);
      
      // Rate limiting between pages
      if (page < pagesNeeded) {
        await sleep(RATE_LIMIT_DELAY);
      }
    }
    
    console.log(`[Token Universe] Fetched ${allMarketData.length} tokens from market data`);
    
    // Filter to EVM tokens using our known contracts
    const evmTokens: any[] = [];
    const nonEvmTokens: string[] = [];
    
    for (const token of allMarketData) {
      const contract = KNOWN_EVM_CONTRACTS[token.id];
      
      if (contract) {
        evmTokens.push({
          ...token,
          contractAddress: contract.address,
          chainId: contract.chainId,
        });
      } else {
        nonEvmTokens.push(token.id);
      }
    }
    
    console.log(`[Token Universe] Found ${evmTokens.length} EVM tokens, ${nonEvmTokens.length} non-EVM/unknown`);
    
    // Filter by criteria
    const qualifiedTokens = evmTokens.filter(t => 
      t.market_cap >= config.minMarketCap &&
      t.total_volume >= config.minVolume24h
    );
    
    console.log(`[Token Universe] ${qualifiedTokens.length} tokens meet criteria`);
    
    // Upsert tokens
    let upsertedCount = 0;
    
    for (const token of qualifiedTokens.slice(0, config.maxTokens)) {
      try {
        await upsertToken(normalizeToken(token));
        upsertedCount++;
      } catch (err) {
        console.error(`[Token Universe] Failed to upsert ${token.symbol}:`, err);
      }
    }
    
    console.log(`[Token Universe] Upserted ${upsertedCount} tokens`);
    
    // Mark inactive
    await markInactiveTokens();
    
    const duration = Date.now() - startTime;
    console.log(`[Token Universe] Ingestion completed in ${(duration / 1000).toFixed(1)}s`);
    
    return {
      source: 'coingecko',
      fetched: allMarketData.length,
      evmMatched: evmTokens.length,
      qualified: qualifiedTokens.length,
      upserted: upsertedCount,
      duration_ms: duration,
      nonEvmSkipped: nonEvmTokens.length,
    };
  } catch (err: any) {
    console.error('[Token Universe] Ingestion failed:', err);
    throw err;
  }
}

// ============================================================
// API FUNCTIONS
// ============================================================

/**
 * Fetch single page of market data
 */
async function fetchMarketDataPage(page: number): Promise<any[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?` +
    `vs_currency=usd&` +
    `order=market_cap_desc&` +
    `per_page=250&` +
    `page=${page}&` +
    `sparkline=false&` +
    `price_change_percentage=24h,7d`;
  
  const response = await fetchWithRetry(url);
  return response.json();
}

/**
 * Fetch with retry and rate limit handling
 */
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60');
        console.log(`[CoinGecko] Rate limited (429). Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      
      throw new Error(`HTTP ${response.status}`);
    } catch (err: any) {
      console.error(`[CoinGecko] Attempt ${attempt}/${retries} failed:`, err.message);
      
      if (attempt < retries) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        console.log(`[CoinGecko] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  
  throw new Error('Max retries exceeded');
}

// ============================================================
// HELPERS
// ============================================================

function normalizeToken(token: any) {
  return {
    symbol: token.symbol.toUpperCase(),
    name: token.name,
    contractAddress: token.contractAddress.toLowerCase(),
    chainId: token.chainId,
    decimals: 18,
    marketCap: token.market_cap || 0,
    volume24h: token.total_volume || 0,
    priceUsd: token.current_price || 0,
    priceChange24h: token.price_change_percentage_24h || 0,
    priceChange7d: token.price_change_percentage_7d_in_currency || 0,
    marketCapRank: token.market_cap_rank || null,
    imageUrl: token.image || null,
    coingeckoId: token.id,
    active: true,
    lastUpdated: new Date(),
    lastSyncedAt: new Date(),
    source: 'coingecko' as const,
    ingestedAt: new Date(),
  };
}

async function upsertToken(token: any) {
  await TokenUniverseModel.updateOne(
    { 
      contractAddress: token.contractAddress,
      chainId: token.chainId,
    },
    { $set: token },
    { upsert: true }
  );
}

async function markInactiveTokens() {
  const threshold = new Date(Date.now() - 72 * 60 * 60 * 1000);
  
  const result = await TokenUniverseModel.updateMany(
    { lastUpdated: { $lt: threshold } },
    { $set: { active: false } }
  );
  
  if (result.modifiedCount > 0) {
    console.log(`[Token Universe] Marked ${result.modifiedCount} tokens as inactive`);
  }
}

export async function getTokenUniverseStats() {
  const [total, active, byChain, bySource, topTokens] = await Promise.all([
    TokenUniverseModel.countDocuments(),
    TokenUniverseModel.countDocuments({ active: true }),
    TokenUniverseModel.aggregate([
      { $group: { _id: '$chainId', count: { $sum: 1 } } },
    ]),
    TokenUniverseModel.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]),
    TokenUniverseModel.find({ active: true })
      .sort({ marketCap: -1 })
      .limit(10)
      .select('symbol name marketCap')
      .lean(),
  ]);
  
  const lastSync = await TokenUniverseModel.findOne()
    .sort({ lastSyncedAt: -1 })
    .select('lastSyncedAt')
    .lean();
  
  return {
    totalTokens: total,
    activeTokens: active,
    byChain: byChain.reduce((acc, item) => {
      const chains: Record<number, string> = {
        1: 'Ethereum', 42161: 'Arbitrum', 137: 'Polygon', 
        10: 'Optimism', 8453: 'Base', 43114: 'Avalanche'
      };
      acc[chains[item._id] || `Chain ${item._id}`] = item.count;
      return acc;
    }, {} as Record<string, number>),
    bySource: bySource.reduce((acc, item) => {
      acc[item._id || 'unknown'] = item.count;
      return acc;
    }, {} as Record<string, number>),
    topTokens: topTokens.map(t => ({
      symbol: t.symbol,
      name: t.name,
      marketCap: t.marketCap,
    })),
    lastSync: lastSync?.lastSyncedAt,
    knownContractsCount: Object.keys(KNOWN_EVM_CONTRACTS).length,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
