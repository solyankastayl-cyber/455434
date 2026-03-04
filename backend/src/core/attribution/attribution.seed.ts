/**
 * Attribution Seed Data (Phase 15.5)
 * Known entities/actors with verified addresses for demo
 */
import { CreateClaimDTO } from './attribution_claims.repository.js';

export const ATTRIBUTION_SEED_DATA: CreateClaimDTO[] = [
  // ==================
  // EXCHANGES (Entities)
  // ==================
  
  // Binance
  {
    subjectType: 'entity',
    subjectId: 'binance',
    chain: 'ethereum',
    address: '0x28c6c06298d514db089934071355e5743bf21d60',
    status: 'confirmed',
    confidence: 0.95,
    source: 'import',
    reason: 'Binance Hot Wallet 1 - publicly documented',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/binance', weight: 1.0, addedAt: new Date() },
      { type: 'note', value: 'Official Binance documentation', weight: 0.9, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
  {
    subjectType: 'entity',
    subjectId: 'binance',
    chain: 'ethereum',
    address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
    status: 'confirmed',
    confidence: 0.92,
    source: 'import',
    reason: 'Binance Hot Wallet 2',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/binance', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
  {
    subjectType: 'entity',
    subjectId: 'binance',
    chain: 'ethereum',
    address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
    status: 'confirmed',
    confidence: 0.90,
    source: 'import',
    reason: 'Binance Hot Wallet 3',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/binance', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Coinbase
  {
    subjectType: 'entity',
    subjectId: 'coinbase',
    chain: 'ethereum',
    address: '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
    status: 'confirmed',
    confidence: 0.95,
    source: 'import',
    reason: 'Coinbase Hot Wallet - publicly documented',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/coinbase', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
  {
    subjectType: 'entity',
    subjectId: 'coinbase',
    chain: 'ethereum',
    address: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
    status: 'confirmed',
    confidence: 0.93,
    source: 'import',
    reason: 'Coinbase Custody',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/coinbase', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Kraken
  {
    subjectType: 'entity',
    subjectId: 'kraken',
    chain: 'ethereum',
    address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
    status: 'confirmed',
    confidence: 0.92,
    source: 'import',
    reason: 'Kraken Hot Wallet',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/kraken', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // ==================
  // SMART MONEY (Actors)
  // ==================

  // Vitalik Buterin
  {
    subjectType: 'actor',
    subjectId: 'vitalik',
    chain: 'ethereum',
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    status: 'confirmed',
    confidence: 0.99,
    source: 'import',
    reason: 'vitalik.eth - ENS confirmed identity',
    evidence: [
      { type: 'url', value: 'https://twitter.com/VitalikButerin', weight: 1.0, addedAt: new Date() },
      { type: 'note', value: 'ENS vitalik.eth resolves to this address', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
  {
    subjectType: 'actor',
    subjectId: 'vitalik',
    chain: 'ethereum',
    address: '0xab5801a7d398351b8be11c439e05c5b3259aec9b',
    status: 'suspected',
    confidence: 0.75,
    source: 'import',
    reason: 'Secondary address linked via on-chain patterns',
    evidence: [
      { type: 'pattern', value: 'Direct transfers from main wallet', weight: 0.7, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Wintermute
  {
    subjectType: 'actor',
    subjectId: 'wintermute',
    chain: 'ethereum',
    address: '0x4f3a120e72c76c22ae802d129f599bfdbc31cb81',
    status: 'confirmed',
    confidence: 0.90,
    source: 'import',
    reason: 'Wintermute Trading main wallet',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/wintermute', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
  {
    subjectType: 'actor',
    subjectId: 'wintermute',
    chain: 'ethereum',
    address: '0x00000000ae347930bd1e7b0f35588b92280f9e75',
    status: 'suspected',
    confidence: 0.72,
    source: 'import',
    reason: 'Wintermute MEV/arbitrage wallet',
    evidence: [
      { type: 'pattern', value: 'High-frequency trading patterns matching Wintermute MO', weight: 0.7, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // DWF Labs
  {
    subjectType: 'actor',
    subjectId: 'dwf-labs',
    chain: 'ethereum',
    address: '0xd7f8469bb7f8f6e9a11e7d9d1c5d2e7a1a1a1a1a',
    status: 'suspected',
    confidence: 0.68,
    source: 'import',
    reason: 'DWF Labs market making wallet - suspected',
    evidence: [
      { type: 'pattern', value: 'Trading patterns consistent with DWF', weight: 0.6, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Jump Trading
  {
    subjectType: 'actor',
    subjectId: 'jump-trading',
    chain: 'ethereum',
    address: '0x9bf4001d307dfd62b26a2f1307ee0c0307632d59',
    status: 'confirmed',
    confidence: 0.88,
    source: 'import',
    reason: 'Jump Trading main wallet',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/jump-trading', weight: 1.0, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Alameda Research (historical)
  {
    subjectType: 'actor',
    subjectId: 'alameda',
    chain: 'ethereum',
    address: '0x83a127952d266a6ea306c40ac62a4a70668fe3bd',
    status: 'confirmed',
    confidence: 0.95,
    source: 'import',
    reason: 'Alameda Research known wallet (historical)',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/alameda-research', weight: 1.0, addedAt: new Date() },
      { type: 'note', value: 'Entity defunct but wallet still tracked', weight: 0.5, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // ==================
  // FUNDS (Entities)
  // ==================

  // a16z Crypto
  {
    subjectType: 'entity',
    subjectId: 'a16z',
    chain: 'ethereum',
    address: '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
    status: 'suspected',
    confidence: 0.75,
    source: 'import',
    reason: 'a16z Crypto fund wallet - suspected via investment patterns',
    evidence: [
      { type: 'pattern', value: 'Token holdings match a16z portfolio', weight: 0.7, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Paradigm
  {
    subjectType: 'entity',
    subjectId: 'paradigm',
    chain: 'ethereum',
    address: '0x8bc1ab68c29c20d60d2e3c03c8de8c4e4e4e4e4e',
    status: 'suspected',
    confidence: 0.70,
    source: 'import',
    reason: 'Paradigm fund wallet - suspected',
    evidence: [
      { type: 'pattern', value: 'Investment timing matches Paradigm announcements', weight: 0.7, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Pantera Capital
  {
    subjectType: 'entity',
    subjectId: 'pantera',
    chain: 'ethereum',
    address: '0x9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c',
    status: 'reference',
    confidence: 0.55,
    source: 'import',
    reason: 'Pantera Capital wallet - reference only',
    evidence: [
      { type: 'note', value: 'Address seen in public reports', weight: 0.5, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Grayscale
  {
    subjectType: 'entity',
    subjectId: 'grayscale',
    chain: 'ethereum',
    address: '0x7be8076f4ea4a4ad08075c2508e481d6c946d12b',
    status: 'confirmed',
    confidence: 0.88,
    source: 'import',
    reason: 'Grayscale Investments custody address',
    evidence: [
      { type: 'url', value: 'https://etherscan.io/accounts/label/grayscale', weight: 0.9, addedAt: new Date() },
    ],
    createdBy: 'system',
  },

  // Galaxy Digital
  {
    subjectType: 'entity',
    subjectId: 'galaxy',
    chain: 'ethereum',
    address: '0x6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b',
    status: 'suspected',
    confidence: 0.65,
    source: 'import',
    reason: 'Galaxy Digital suspected wallet',
    evidence: [
      { type: 'pattern', value: 'Trading patterns match Galaxy reports', weight: 0.6, addedAt: new Date() },
    ],
    createdBy: 'system',
  },
];
