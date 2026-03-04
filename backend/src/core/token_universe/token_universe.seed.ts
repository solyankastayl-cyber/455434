/**
 * Seed Token Universe with known top tokens
 * 
 * For testing and initial deployment
 */
import { TokenUniverseModel } from './token_universe.model.js';

export const KNOWN_TOKENS = [
  { symbol: 'WETH', name: 'Wrapped Ether', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', marketCap: 7000000000, volume24h: 1500000000, price: 2250 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', marketCap: 35000000000, volume24h: 5000000000, price: 1.00 },
  { symbol: 'USDT', name: 'Tether USD', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', marketCap: 95000000000, volume24h: 50000000000, price: 1.00 },
  { symbol: 'WBTC', name: 'Wrapped BTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', marketCap: 8000000000, volume24h: 300000000, price: 43000 },
  { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6b175474e89094c44da98b954eedeac495271d0f', marketCap: 5300000000, volume24h: 200000000, price: 1.00 },
  { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', marketCap: 5200000000, volume24h: 150000000, price: 7.50 },
  { symbol: 'LINK', name: 'Chainlink', address: '0x514910771af9ca656af840dff83e8264ecf986ca', marketCap: 8500000000, volume24h: 400000000, price: 15.20 },
  { symbol: 'MATIC', name: 'Polygon', address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', marketCap: 6500000000, volume24h: 250000000, price: 0.85 },
  { symbol: 'AAVE', name: 'Aave', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', marketCap: 2400000000, volume24h: 120000000, price: 165 },
  { symbol: 'CRV', name: 'Curve DAO Token', address: '0xd533a949740bb3306d119cc777fa900ba034cd52', marketCap: 1100000000, volume24h: 80000000, price: 0.75 },
  { symbol: 'MKR', name: 'Maker', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', marketCap: 1500000000, volume24h: 50000000, price: 1650 },
  { symbol: 'SNX', name: 'Synthetix', address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', marketCap: 950000000, volume24h: 45000000, price: 3.20 },
  { symbol: 'COMP', name: 'Compound', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', marketCap: 780000000, volume24h: 35000000, price: 52 },
  { symbol: 'LDO', name: 'Lido DAO', address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32', marketCap: 1800000000, volume24h: 95000000, price: 2.10 },
  { symbol: 'ARB', name: 'Arbitrum', address: '0xb50721bcf8d664c30412cfbc6cf7a15145935896', marketCap: 3200000000, volume24h: 180000000, price: 1.25 },
];

export async function seedTokenUniverse() {
  console.log('[Token Universe] Seeding with known top tokens...');
  
  let seeded = 0;
  
  for (const token of KNOWN_TOKENS) {
    await TokenUniverseModel.updateOne(
      { 
        contractAddress: token.address.toLowerCase(),
        chainId: 1,
      },
      {
        $set: {
          symbol: token.symbol,
          name: token.name,
          contractAddress: token.address.toLowerCase(),
          chainId: 1,
          decimals: 18,
          marketCap: token.marketCap,
          volume24h: token.volume24h,
          priceUsd: token.price,
          active: true,
          lastUpdated: new Date(),
          source: 'seed',
          ingestedAt: new Date(),
        },
      },
      { upsert: true }
    );
    seeded++;
  }
  
  console.log(`[Token Universe] Seeded ${seeded} tokens`);
  
  return seeded;
}
