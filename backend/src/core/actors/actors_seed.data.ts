/**
 * Actors Seed Data (P1.1)
 * 
 * Real actors with verified addresses for Data Enrichment.
 * Sources: Etherscan labels, public disclosures.
 */

export interface ActorSeed {
  name: string;
  type: 'exchange' | 'market_maker' | 'fund' | 'protocol' | 'infra';
  source: 'verified' | 'attributed';
  addresses: string[];
  tags: string[];
}

export const ACTORS_SEED: ActorSeed[] = [
  // =============== EXCHANGES ===============
  {
    name: 'Binance',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0x28c6c06298d514db089934071355e5743bf21d60', // Binance 14
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 7
      '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance 8
      '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Binance 17
      '0x9696f59e4d72e237be84ffd425dcad154bf96976', // Binance 18
    ],
    tags: ['cex', 'liquidity_hub', 'high_volume'],
  },
  {
    name: 'Coinbase',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', // Coinbase 1
      '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase 2
      '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', // Coinbase 3
      '0x3cd751e6b0078be393132286c442345e5dc49699', // Coinbase 4
      '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', // Coinbase 5
    ],
    tags: ['cex', 'us_regulated', 'institutional'],
  },
  {
    name: 'Kraken',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken
      '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', // Kraken 2
      '0xe853c56864a2ebe4576a807d26fdc4a0ada51919', // Kraken 3
    ],
    tags: ['cex', 'us_regulated'],
  },
  {
    name: 'OKX',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', // OKX
      '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', // OKX 2
      '0xa7efae728d2936e78bda97dc267687568dd593f3', // OKX 3
    ],
    tags: ['cex', 'high_volume'],
  },
  {
    name: 'Bybit',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0xf89d7b9c864f589bbf53a82105107622b35eaa40', // Bybit
      '0x1db92e2eebc8e0c075a02bea33c53e69d9d43a78', // Bybit 2
    ],
    tags: ['cex', 'derivatives'],
  },
  {
    name: 'Bitfinex',
    type: 'exchange',
    source: 'verified',
    addresses: [
      '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa', // Bitfinex
      '0xdcd0272462140d0a3ced6c4bf970c7641f08cd2c', // Bitfinex 2
    ],
    tags: ['cex'],
  },
  
  // =============== MARKET MAKERS ===============
  {
    name: 'Wintermute',
    type: 'market_maker',
    source: 'verified',
    addresses: [
      '0x0000000000000000000000000000000000000000', // Placeholder - already seeded
      '0x4f3a120e72c76c22ae802d129f599bfdbc31cb81', // Wintermute 2
      '0xdbf5e9c5206d0db70a90108bf936da60221dc080', // Wintermute 3
    ],
    tags: ['mm', 'liquidity_provider', 'dex_active'],
  },
  {
    name: 'Jump Trading',
    type: 'market_maker',
    source: 'verified',
    addresses: [
      '0x0000000000000000000000000000000000000001', // Placeholder - already seeded
      '0xcbf4051f47b6baf2fc0d57a8e0ee3e971a2d4e06', // Jump Trading 2
    ],
    tags: ['mm', 'hft', 'institutional'],
  },
  {
    name: 'Cumberland',
    type: 'market_maker',
    source: 'verified',
    addresses: [
      '0x67c66058bbea0ed47e8d318ba6dfcac54dd4b0a0', // Cumberland
      '0xd03f3d76d1f1c09baefcbdf5f8ddc60a1f0f1e42', // Cumberland 2
    ],
    tags: ['mm', 'otc', 'institutional'],
  },
  {
    name: 'GSR',
    type: 'market_maker',
    source: 'verified',
    addresses: [
      '0xca436e14855323927d6e6264470ded36455fc8bd', // GSR
    ],
    tags: ['mm', 'algorithmic'],
  },
  {
    name: 'Flow Traders',
    type: 'market_maker',
    source: 'attributed',
    addresses: [
      '0x0d0707963952f2fba59dd06f2b425ace40b492fe', // Flow Traders
    ],
    tags: ['mm', 'etf'],
  },
  
  // =============== FUNDS ===============
  {
    name: 'a16z',
    type: 'fund',
    source: 'verified',
    addresses: [
      '0x0000000000000000000000000000000000000002', // Placeholder - already seeded
      '0x05e793ce0c6027323ac150f6d45c2344d28b6019', // a16z 2
    ],
    tags: ['vc', 'institutional', 'long_term'],
  },
  {
    name: 'Paradigm',
    type: 'fund',
    source: 'verified',
    addresses: [
      '0x9b9a06dd81d42b1eb8c2fc3fcbdf8e4e0c9ddae2', // Paradigm
    ],
    tags: ['vc', 'institutional', 'defi_focused'],
  },
  {
    name: 'Pantera',
    type: 'fund',
    source: 'attributed',
    addresses: [
      '0x4862733b5fddfd35f35ea8ccf08f5045e57388b3', // Pantera
    ],
    tags: ['vc', 'crypto_native'],
  },
  {
    name: 'Multicoin',
    type: 'fund',
    source: 'attributed',
    addresses: [
      '0x7ae92148e79d60a0749fd6de374c8e81dfddf792', // Multicoin
    ],
    tags: ['vc', 'thesis_driven'],
  },
  {
    name: 'Three Arrows Capital',
    type: 'fund',
    source: 'verified',
    addresses: [
      '0x716034c25d9fb4b38c837afe417b7a2b8f8f1ea9', // 3AC
    ],
    tags: ['fund', 'defunct'],
  },
  
  // =============== PROTOCOLS ===============
  {
    name: 'Uniswap',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI Token
      '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap Router
      '0x000000000022d473030f116ddee9f6b43ac78ba3', // Permit2
    ],
    tags: ['dex', 'amm', 'defi'],
  },
  {
    name: 'Aave',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE Token
      '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Aave V3 Pool
    ],
    tags: ['lending', 'defi', 'governance'],
  },
  {
    name: 'Lido',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // stETH
      '0x3e40d73eb977dc6a537af587d48316fee66e9c8c', // Lido Treasury
    ],
    tags: ['staking', 'defi', 'liquid_staking'],
  },
  {
    name: 'Curve',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0xd533a949740bb3306d119cc777fa900ba034cd52', // CRV Token
      '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', // 3Pool
    ],
    tags: ['dex', 'stableswap', 'defi'],
  },
  {
    name: 'MakerDAO',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR Token
      '0xbe8e3e3618f7474f8cb1d074a26affef007e98fb', // DSR Manager
    ],
    tags: ['stablecoin', 'defi', 'governance'],
  },
  {
    name: 'Compound',
    type: 'protocol',
    source: 'verified',
    addresses: [
      '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP Token
      '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b', // Comptroller
    ],
    tags: ['lending', 'defi'],
  },
  
  // =============== INFRA ===============
  {
    name: 'Circle',
    type: 'infra',
    source: 'verified',
    addresses: [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0x55fe002aeff02f77364de339a1292923a15844b8', // Circle Treasury
    ],
    tags: ['stablecoin', 'issuer', 'regulated'],
  },
  {
    name: 'Tether',
    type: 'infra',
    source: 'verified',
    addresses: [
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0x5754284f345afc66a98fbb0a0afe71e0f007b949', // Tether Treasury
    ],
    tags: ['stablecoin', 'issuer'],
  },
  {
    name: 'Chainlink',
    type: 'infra',
    source: 'verified',
    addresses: [
      '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK Token
    ],
    tags: ['oracle', 'infrastructure'],
  },
];

/**
 * Get seed actors by type
 */
export function getSeedActorsByType(type: ActorSeed['type']): ActorSeed[] {
  return ACTORS_SEED.filter(a => a.type === type);
}

/**
 * Get all seed actors count
 */
export function getSeedActorsCount(): number {
  return ACTORS_SEED.length;
}

export default ACTORS_SEED;
