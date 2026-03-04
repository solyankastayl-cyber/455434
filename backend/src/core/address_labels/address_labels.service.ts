/**
 * Address Labels Service (P0.2.2)
 * 
 * Manages address labels and exchange entities
 */

import {
  AddressLabelModel,
  ExchangeEntityModel,
  generateLabelId,
  generateEntityId,
  getLabel,
  searchLabels,
  getExchangeEntity,
  searchExchangeEntities,
  isExchangeAddress,
  type IAddressLabelDocument,
  type IExchangeEntityDocument,
  type LabelCategory,
  type LabelSource,
  type LabelConfidence,
  type ExchangeWallet
} from './address_labels.model.js';

// ============================================
// Address Label Operations
// ============================================

/**
 * Upsert address label
 */
export async function upsertAddressLabel(data: {
  chain: string;
  address: string;
  name: string;
  category: LabelCategory;
  subcategory?: string;
  exchangeEntityId?: string;
  confidence?: LabelConfidence;
  sources?: LabelSource[];
  tags?: string[];
}): Promise<IAddressLabelDocument> {
  const chainUpper = data.chain.toUpperCase();
  const addressLower = data.address.toLowerCase();
  const labelId = generateLabelId(chainUpper, addressLower);
  
  const label = await AddressLabelModel.findOneAndUpdate(
    { chain: chainUpper, address: addressLower },
    {
      labelId,
      chain: chainUpper,
      address: addressLower,
      name: data.name,
      category: data.category,
      subcategory: data.subcategory,
      exchangeEntityId: data.exchangeEntityId,
      confidence: data.confidence || 'MEDIUM',
      $addToSet: { 
        sources: { $each: data.sources || ['manual'] },
        tags: { $each: data.tags || [] }
      },
      updatedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  
  console.log(`[AddressLabels] Upserted label: ${labelId} (${data.name})`);
  
  return label;
}

/**
 * Batch upsert labels
 */
export async function batchUpsertLabels(
  labels: Array<{
    chain: string;
    address: string;
    name: string;
    category: LabelCategory;
    subcategory?: string;
    exchangeEntityId?: string;
    confidence?: LabelConfidence;
    sources?: LabelSource[];
    tags?: string[];
  }>
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  
  for (const labelData of labels) {
    const existing = await getLabel(labelData.chain, labelData.address);
    await upsertAddressLabel(labelData);
    
    if (existing) {
      updated++;
    } else {
      created++;
    }
  }
  
  return { created, updated };
}

/**
 * Delete address label
 */
export async function deleteAddressLabel(
  chain: string,
  address: string
): Promise<boolean> {
  const result = await AddressLabelModel.deleteOne({
    chain: chain.toUpperCase(),
    address: address.toLowerCase()
  });
  
  return result.deletedCount > 0;
}

/**
 * Verify label (mark as verified by admin)
 */
export async function verifyLabel(
  chain: string,
  address: string,
  verifiedBy: string
): Promise<IAddressLabelDocument | null> {
  return AddressLabelModel.findOneAndUpdate(
    { chain: chain.toUpperCase(), address: address.toLowerCase() },
    {
      verifiedAt: new Date(),
      verifiedBy,
      confidence: 'HIGH',
      updatedAt: new Date()
    },
    { new: true }
  ).lean();
}

/**
 * Get labels by category
 */
export async function getLabelsByCategory(
  category: LabelCategory,
  chain?: string,
  limit: number = 500
): Promise<IAddressLabelDocument[]> {
  const query: any = { category };
  if (chain) {
    query.chain = chain.toUpperCase();
  }
  
  return AddressLabelModel.find(query)
    .sort({ confidence: -1, name: 1 })
    .limit(limit)
    .lean();
}

/**
 * Get labels statistics
 */
export async function getLabelsStats(): Promise<{
  totalLabels: number;
  byCategory: Record<string, number>;
  byChain: Record<string, number>;
  byConfidence: Record<string, number>;
  verified: number;
  recentlyAdded: number;
}> {
  const [byCategory, byChain, byConfidence, verified, recent] = await Promise.all([
    AddressLabelModel.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]),
    AddressLabelModel.aggregate([
      { $group: { _id: '$chain', count: { $sum: 1 } } }
    ]),
    AddressLabelModel.aggregate([
      { $group: { _id: '$confidence', count: { $sum: 1 } } }
    ]),
    AddressLabelModel.countDocuments({ verifiedAt: { $exists: true } }),
    AddressLabelModel.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) }
    })
  ]);
  
  const totalLabels = byCategory.reduce((sum, item) => sum + item.count, 0);
  
  return {
    totalLabels,
    byCategory: byCategory.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    byChain: byChain.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    byConfidence: byConfidence.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    verified,
    recentlyAdded: recent
  };
}

// ============================================
// Exchange Entity Operations
// ============================================

/**
 * Upsert exchange entity
 */
export async function upsertExchangeEntity(data: {
  name: string;
  shortName: string;
  type: 'CEX' | 'DEX' | 'BRIDGE' | 'PROTOCOL';
  tier?: 1 | 2 | 3;
  isRegulated?: boolean;
  jurisdiction?: string;
  wallets?: ExchangeWallet[];
  coingeckoExchangeId?: string;
  website?: string;
}): Promise<IExchangeEntityDocument> {
  const entityId = generateEntityId(data.name);
  
  // Calculate chains present
  const chainsPresent = data.wallets 
    ? [...new Set(data.wallets.map(w => w.chain))]
    : [];
  
  const entity = await ExchangeEntityModel.findOneAndUpdate(
    { entityId },
    {
      entityId,
      name: data.name,
      shortName: data.shortName,
      type: data.type,
      tier: data.tier || 2,
      isRegulated: data.isRegulated || false,
      jurisdiction: data.jurisdiction,
      wallets: data.wallets || [],
      totalWallets: data.wallets?.length || 0,
      chainsPresent,
      coingeckoExchangeId: data.coingeckoExchangeId,
      website: data.website,
      updatedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  
  console.log(`[AddressLabels] Upserted exchange entity: ${entityId}`);
  
  return entity;
}

/**
 * Add wallet to exchange entity
 */
export async function addWalletToEntity(
  entityId: string,
  wallet: ExchangeWallet
): Promise<IExchangeEntityDocument | null> {
  const entity = await ExchangeEntityModel.findOne({ entityId });
  if (!entity) return null;
  
  // Check if wallet already exists
  const exists = entity.wallets.some(
    w => w.chain === wallet.chain && w.address === wallet.address
  );
  
  if (!exists) {
    entity.wallets.push(wallet);
    entity.totalWallets = entity.wallets.length;
    entity.chainsPresent = [...new Set(entity.wallets.map(w => w.chain))];
    entity.updatedAt = new Date();
    await entity.save();
  }
  
  return entity.toObject();
}

/**
 * Remove wallet from exchange entity
 */
export async function removeWalletFromEntity(
  entityId: string,
  chain: string,
  address: string
): Promise<IExchangeEntityDocument | null> {
  const entity = await ExchangeEntityModel.findOne({ entityId });
  if (!entity) return null;
  
  entity.wallets = entity.wallets.filter(
    w => !(w.chain === chain.toUpperCase() && w.address === address.toLowerCase())
  );
  entity.totalWallets = entity.wallets.length;
  entity.chainsPresent = [...new Set(entity.wallets.map(w => w.chain))];
  entity.updatedAt = new Date();
  
  await entity.save();
  
  return entity.toObject();
}

/**
 * Delete exchange entity
 */
export async function deleteExchangeEntity(entityId: string): Promise<boolean> {
  const result = await ExchangeEntityModel.deleteOne({ entityId });
  return result.deletedCount > 0;
}

/**
 * Get exchange entity statistics
 */
export async function getExchangeStats(): Promise<{
  totalEntities: number;
  byType: Record<string, number>;
  byTier: Record<number, number>;
  regulated: number;
  totalWallets: number;
}> {
  const [byType, byTier, regulated, wallets] = await Promise.all([
    ExchangeEntityModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]),
    ExchangeEntityModel.aggregate([
      { $group: { _id: '$tier', count: { $sum: 1 } } }
    ]),
    ExchangeEntityModel.countDocuments({ isRegulated: true }),
    ExchangeEntityModel.aggregate([
      { $group: { _id: null, total: { $sum: '$totalWallets' } } }
    ])
  ]);
  
  const totalEntities = byType.reduce((sum, item) => sum + item.count, 0);
  
  return {
    totalEntities,
    byType: byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    byTier: byTier.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<number, number>),
    regulated,
    totalWallets: wallets[0]?.total || 0
  };
}

// ============================================
// Resolution & Lookup
// ============================================

/**
 * Resolve address to label and entity
 */
export async function resolveAddress(
  chain: string,
  address: string
): Promise<{
  label: IAddressLabelDocument | null;
  entity: IExchangeEntityDocument | null;
  isExchange: boolean;
  isKnown: boolean;
}> {
  const label = await getLabel(chain, address);
  
  if (!label) {
    return { label: null, entity: null, isExchange: false, isKnown: false };
  }
  
  let entity: IExchangeEntityDocument | null = null;
  if (label.exchangeEntityId) {
    entity = await ExchangeEntityModel.findOne({ 
      entityId: label.exchangeEntityId 
    }).lean();
  }
  
  return {
    label,
    entity,
    isExchange: ['CEX', 'DEX'].includes(label.category),
    isKnown: true
  };
}

/**
 * Batch resolve addresses
 */
export async function batchResolveAddresses(
  addresses: Array<{ chain: string; address: string }>
): Promise<Map<string, { label: IAddressLabelDocument | null; isExchange: boolean }>> {
  const results = new Map();
  
  // Batch query all labels
  const queries = addresses.map(a => ({
    chain: a.chain.toUpperCase(),
    address: a.address.toLowerCase()
  }));
  
  const labels = await AddressLabelModel.find({
    $or: queries
  }).lean();
  
  // Create lookup map
  const labelMap = new Map<string, IAddressLabelDocument>();
  for (const label of labels) {
    const key = `${label.chain}:${label.address}`;
    labelMap.set(key, label);
  }
  
  // Build results
  for (const addr of addresses) {
    const key = `${addr.chain.toUpperCase()}:${addr.address.toLowerCase()}`;
    const label = labelMap.get(key) || null;
    
    results.set(key, {
      label,
      isExchange: label ? ['CEX', 'DEX'].includes(label.category) : false
    });
  }
  
  return results;
}

// ============================================
// Seed Known Data
// ============================================

const KNOWN_EXCHANGES = [
  {
    name: 'Binance',
    shortName: 'BNB',
    type: 'CEX' as const,
    tier: 1 as const,
    isRegulated: true,
    website: 'https://binance.com',
    coingeckoExchangeId: 'binance',
    wallets: [
      { chain: 'ETH', address: '0x28c6c06298d514db089934071355e5743bf21d60', type: 'hot' as const },
      { chain: 'ETH', address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549', type: 'hot' as const },
      { chain: 'ETH', address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', type: 'hot' as const },
      { chain: 'ETH', address: '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', type: 'hot' as const },
      { chain: 'ARB', address: '0xb38e8c17e38363af6ebdcb3dae12e0243582891d', type: 'hot' as const },
      { chain: 'ARB', address: '0x28c6c06298d514db089934071355e5743bf21d60', type: 'hot' as const }
    ]
  },
  {
    name: 'Coinbase',
    shortName: 'CB',
    type: 'CEX' as const,
    tier: 1 as const,
    isRegulated: true,
    jurisdiction: 'US',
    website: 'https://coinbase.com',
    coingeckoExchangeId: 'coinbase-exchange',
    wallets: [
      { chain: 'ETH', address: '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', type: 'hot' as const },
      { chain: 'ETH', address: '0x503828976d22510aad0339f595bc9a8297e93d42', type: 'cold' as const },
      { chain: 'ETH', address: '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', type: 'hot' as const },
      { chain: 'BASE', address: '0x1a16ef684d4c07b81c9b8f0b79d8b6a0f4f4c4e1', type: 'hot' as const }
    ]
  },
  {
    name: 'Kraken',
    shortName: 'KRK',
    type: 'CEX' as const,
    tier: 1 as const,
    isRegulated: true,
    jurisdiction: 'US',
    website: 'https://kraken.com',
    coingeckoExchangeId: 'kraken',
    wallets: [
      { chain: 'ETH', address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', type: 'cold' as const },
      { chain: 'ETH', address: '0x53d284357ec70ce289d6d64134dfac8e511c8a3d', type: 'hot' as const }
    ]
  },
  {
    name: 'OKX',
    shortName: 'OKX',
    type: 'CEX' as const,
    tier: 1 as const,
    isRegulated: false,
    website: 'https://okx.com',
    coingeckoExchangeId: 'okex',
    wallets: [
      { chain: 'ETH', address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', type: 'hot' as const },
      { chain: 'ETH', address: '0x98ec059dc3adfbdd63429454aeb0c990fba4a128', type: 'hot' as const }
    ]
  }
];

const KNOWN_BRIDGES = [
  {
    name: 'Stargate Finance',
    shortName: 'STG',
    type: 'BRIDGE' as const,
    tier: 1 as const,
    website: 'https://stargate.finance',
    wallets: [
      { chain: 'ETH', address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', type: 'router' as const },
      { chain: 'ARB', address: '0x53bf833a5d6c4dda888f69c22c88c9f356a41614', type: 'router' as const },
      { chain: 'OP', address: '0xb0d502e938ed5f4df2e681fe6e419ff29631d62b', type: 'router' as const },
      { chain: 'BASE', address: '0x45f1a95a4d3f3836523f5c83673c797f4d4d263b', type: 'router' as const }
    ]
  },
  {
    name: 'Hop Protocol',
    shortName: 'HOP',
    type: 'BRIDGE' as const,
    tier: 2 as const,
    website: 'https://hop.exchange',
    wallets: [
      { chain: 'ETH', address: '0xb8901acb165ed027e32754e0ffe830802919727f', type: 'router' as const },
      { chain: 'ARB', address: '0x0e0e3d2c5c292161999474b9f12e3c66b1cf8b1c', type: 'router' as const },
      { chain: 'OP', address: '0x2ad09850b0ca4c7c1b33f5acd6cbabcab5d6e796', type: 'router' as const }
    ]
  },
  {
    name: 'Across Protocol',
    shortName: 'ACX',
    type: 'BRIDGE' as const,
    tier: 2 as const,
    website: 'https://across.to',
    wallets: [
      { chain: 'ETH', address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', type: 'router' as const },
      { chain: 'ARB', address: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', type: 'router' as const },
      { chain: 'OP', address: '0x6f26bf09b1c792e3228e5467807a900a503c0281', type: 'router' as const }
    ]
  }
];

/**
 * Seed known exchanges and bridges
 */
export async function seedKnownLabels(): Promise<{
  entities: number;
  labels: number;
}> {
  let entitiesCreated = 0;
  let labelsCreated = 0;
  
  // Seed exchanges
  for (const exchange of KNOWN_EXCHANGES) {
    const entity = await upsertExchangeEntity(exchange);
    entitiesCreated++;
    
    // Create labels for each wallet
    for (const wallet of exchange.wallets) {
      await upsertAddressLabel({
        chain: wallet.chain,
        address: wallet.address,
        name: `${exchange.name} ${wallet.type.charAt(0).toUpperCase() + wallet.type.slice(1)} Wallet`,
        category: exchange.type,
        subcategory: wallet.type,
        exchangeEntityId: entity.entityId,
        confidence: 'HIGH',
        sources: ['manual'],
        tags: [wallet.type, exchange.shortName.toLowerCase()]
      });
      labelsCreated++;
    }
  }
  
  // Seed bridges
  for (const bridge of KNOWN_BRIDGES) {
    const entity = await upsertExchangeEntity(bridge);
    entitiesCreated++;
    
    for (const wallet of bridge.wallets) {
      await upsertAddressLabel({
        chain: wallet.chain,
        address: wallet.address,
        name: `${bridge.name} ${wallet.type.charAt(0).toUpperCase() + wallet.type.slice(1)}`,
        category: 'BRIDGE',
        subcategory: wallet.type,
        exchangeEntityId: entity.entityId,
        confidence: 'HIGH',
        sources: ['manual'],
        tags: [wallet.type, bridge.shortName.toLowerCase(), 'bridge']
      });
      labelsCreated++;
    }
  }
  
  console.log(`[AddressLabels] Seeded ${entitiesCreated} entities and ${labelsCreated} labels`);
  
  return { entities: entitiesCreated, labels: labelsCreated };
}

// Re-export model functions
export {
  getLabel,
  searchLabels,
  getExchangeEntity,
  searchExchangeEntities,
  isExchangeAddress
};
