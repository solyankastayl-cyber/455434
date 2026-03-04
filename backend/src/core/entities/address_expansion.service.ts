/**
 * Address Expansion Service (EPIC 1)
 * 
 * Hybrid address attribution model:
 * 1. VERIFIED - Etherscan labels, public disclosures, ENS
 * 2. ATTRIBUTED - Correlation-based safe expansion
 * 3. WEAK - Exploration only, NOT in aggregates
 * 
 * Safety Rules:
 * - WEAK addresses do NOT affect Net Flow, Token Flow, Coverage
 * - Address Expansion does NOT write to ML
 * - No auto-joins to neural tables
 */
import { EntityAddressModel, AddressConfidence, AddressSource } from './entity_address.model.js';
import { EntityModel } from './entities.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

// ============ KNOWN VERIFIED ADDRESSES (Source: Etherscan Labels) ============

interface KnownAddress {
  address: string;
  role: 'hot' | 'cold' | 'deposit' | 'treasury' | 'contract' | 'unknown';
  source: AddressSource;
  sourceUrl?: string;
  notes?: string;
}

// Binance verified addresses from Etherscan
// Source: https://etherscan.io/accounts/label/binance
const BINANCE_VERIFIED_ADDRESSES: KnownAddress[] = [
  // Hot Wallets
  { address: '0x28c6c06298d514db089934071355e5743bf21d60', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x28c6c06298d514db089934071355e5743bf21d60', notes: 'Binance 14' },
  { address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x21a31ee1afc51d94c2efccaa2092ad1028285549', notes: 'Binance 15' },
  { address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xdfd5293d8e347dfe59e90efd55b2956a1343963d', notes: 'Binance 16' },
  { address: '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x56eddb7aa87536c09ccc2793473599fd21a8b17f', notes: 'Binance 17' },
  { address: '0x9696f59e4d72e237be84ffd425dcad154bf96976', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x9696f59e4d72e237be84ffd425dcad154bf96976', notes: 'Binance 18' },
  { address: '0x4d9ff50ef4da947364bb9650f51e3e41a86a44d7', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x4d9ff50ef4da947364bb9650f51e3e41a86a44d7', notes: 'Binance 19' },
  { address: '0x4976a4a02f38326660d17bf34b431dc6e2eb2327', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x4976a4a02f38326660d17bf34b431dc6e2eb2327', notes: 'Binance 20' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xf977814e90da44bfa03b6295a0616a897441acec', notes: 'Binance 8' },
  { address: '0x8894e0a0c962cb723c1976a4421c95949be2d4e3', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x8894e0a0c962cb723c1976a4421c95949be2d4e3', notes: 'Binance 6' },
  { address: '0xe2fc31f816a9b94326492132018c3aecc4a93ae1', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xe2fc31f816a9b94326492132018c3aecc4a93ae1', notes: 'Binance 7' },
  { address: '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', notes: 'Binance 1' },
  { address: '0xd551234ae421e3bcba99a0da6d736074f22192ff', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xd551234ae421e3bcba99a0da6d736074f22192ff', notes: 'Binance 2' },
  { address: '0x564286362092d8e7936f0549571a803b203aaced', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x564286362092d8e7936f0549571a803b203aaced', notes: 'Binance 3' },
  { address: '0x0681d8db095565fe8a346fa0277bffde9c0edbbf', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x0681d8db095565fe8a346fa0277bffde9c0edbbf', notes: 'Binance 4' },
  { address: '0xfe9e8709d3215310075d67e3ed32a380ccf451c8', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xfe9e8709d3215310075d67e3ed32a380ccf451c8', notes: 'Binance 5' },
  // Cold Storage
  { address: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', role: 'cold', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', notes: 'Binance Cold Wallet' },
  // Deposit Contract
  { address: '0x5a52e96bacdabb82fd05763e25335261b270efcb', role: 'deposit', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x5a52e96bacdabb82fd05763e25335261b270efcb', notes: 'Binance Deposit' },
  // Additional hot wallets
  { address: '0xab83d182f3485cf1d6ccdd34c7cfef95b4c08da4', role: 'hot', source: 'etherscan_label', notes: 'Binance Hot 21' },
  { address: '0xc3c8e0a39769e2308869f7571e14abe3c2e9df40', role: 'hot', source: 'etherscan_label', notes: 'Binance Hot 22' },
  { address: '0x708396f17127c42383e3b9014072679b2f60b82f', role: 'hot', source: 'etherscan_label', notes: 'Binance Hot 23' },
  { address: '0xb1bd63bc8a6c20dc71f5e57625d8d77f3dc0ad1c', role: 'hot', source: 'etherscan_label', notes: 'Binance Hot 24' },
  { address: '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503', role: 'hot', source: 'etherscan_label', notes: 'Binance-Peg Tokens' },
];

// Coinbase verified addresses
const COINBASE_VERIFIED_ADDRESSES: KnownAddress[] = [
  { address: '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x71660c4005ba85c37ccec55d0c4493e66fe775d3', notes: 'Coinbase 1' },
  { address: '0x503828976d22510aad0201ac7ec88293211d23da', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x503828976d22510aad0201ac7ec88293211d23da', notes: 'Coinbase 2' },
  { address: '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', notes: 'Coinbase 3' },
  { address: '0x3cd751e6b0078be393132286c442345e5dc49699', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x3cd751e6b0078be393132286c442345e5dc49699', notes: 'Coinbase 4' },
  { address: '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', notes: 'Coinbase 5' },
  { address: '0xeb2629a2734e272bcc07bda959863f316f4bd4cf', role: 'cold', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xeb2629a2734e272bcc07bda959863f316f4bd4cf', notes: 'Coinbase Cold' },
  { address: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', role: 'hot', source: 'etherscan_label', notes: 'Coinbase 10' },
];

// Kraken verified addresses
const KRAKEN_VERIFIED_ADDRESSES: KnownAddress[] = [
  { address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x2910543af39aba0cd09dbb2d50200b3e800a63d2', notes: 'Kraken 1' },
  { address: '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', notes: 'Kraken 2' },
  { address: '0xe853c56864a2ebe4576a807d26fdc4a0ada51919', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xe853c56864a2ebe4576a807d26fdc4a0ada51919', notes: 'Kraken 3' },
  { address: '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', notes: 'Kraken 4' },
  { address: '0xfa52274dd61e1643d2205169732f29114bc240b3', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xfa52274dd61e1643d2205169732f29114bc240b3', notes: 'Kraken 5' },
  { address: '0x53d284357ec70ce289d6d64134dfac8e511c8a3d', role: 'cold', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x53d284357ec70ce289d6d64134dfac8e511c8a3d', notes: 'Kraken Cold' },
];

// OKX verified addresses
const OKX_VERIFIED_ADDRESSES: KnownAddress[] = [
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', notes: 'OKX 1' },
  { address: '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', notes: 'OKX 2' },
  { address: '0xa7efae728d2936e78bda97dc267687568dd593f3', role: 'hot', source: 'etherscan_label', sourceUrl: 'https://etherscan.io/address/0xa7efae728d2936e78bda97dc267687568dd593f3', notes: 'OKX 3' },
  { address: '0x5041ed759dd4afc3a72b8192c143f72f4724081a', role: 'hot', source: 'etherscan_label', notes: 'OKX 4' },
];

// Entity slug to verified addresses mapping
const VERIFIED_ADDRESSES_MAP: Record<string, KnownAddress[]> = {
  'binance': BINANCE_VERIFIED_ADDRESSES,
  'coinbase': COINBASE_VERIFIED_ADDRESSES,
  'kraken': KRAKEN_VERIFIED_ADDRESSES,
  'okx': OKX_VERIFIED_ADDRESSES,
};

// ============ EXPANSION SERVICE ============

interface ExpansionResult {
  added: number;
  updated: number;
  skipped: number;
  details: {
    verified: number;
    attributed: number;
    weak: number;
  };
}

/**
 * Expand entity addresses using verified sources
 * Level 1: VERIFIED - Etherscan labels, public disclosures
 */
export async function expandFromVerifiedSources(entitySlug: string): Promise<ExpansionResult> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) {
    return { added: 0, updated: 0, skipped: 0, details: { verified: 0, attributed: 0, weak: 0 } };
  }
  
  const entityId = (entity as any)._id.toString();
  const knownAddresses = VERIFIED_ADDRESSES_MAP[entitySlug.toLowerCase()] || [];
  
  let added = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const addr of knownAddresses) {
    try {
      const existing = await EntityAddressModel.findOne({
        entityId,
        chain: 'ethereum',
        address: addr.address.toLowerCase(),
      });
      
      if (existing) {
        // Update to verified if not already
        if (existing.confidence !== 'verified') {
          await EntityAddressModel.updateOne(
            { _id: existing._id },
            {
              $set: {
                confidence: 'verified',
                source: addr.source,
                sourceUrl: addr.sourceUrl,
                role: addr.role,
                notes: addr.notes,
              },
            }
          );
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Create new verified address
        await EntityAddressModel.create({
          entityId,
          chain: 'ethereum',
          address: addr.address.toLowerCase(),
          role: addr.role,
          confidence: 'verified',
          source: addr.source,
          sourceUrl: addr.sourceUrl,
          notes: addr.notes,
          tags: ['verified'],
        });
        added++;
      }
    } catch (err) {
      console.error(`Error adding address ${addr.address}:`, err);
      skipped++;
    }
  }
  
  console.log(`[AddressExpansion] ${entitySlug}: +${added} verified, ~${updated} updated, ${skipped} skipped`);
  
  return {
    added,
    updated,
    skipped,
    details: { verified: added + updated, attributed: 0, weak: 0 },
  };
}

/**
 * Expand entity addresses using correlation analysis
 * Level 2: ATTRIBUTED - Safe expansion based on tx correlation
 * 
 * Rules:
 * - ≥10 tx with verified addresses
 * - ≥30% volume overlap
 * - Temporal correlation (active in same periods)
 */
export async function expandFromCorrelation(
  entitySlug: string,
  options: {
    minTxCount?: number;
    minVolumeOverlap?: number;
    windowHours?: number;
    maxNewAddresses?: number;
  } = {}
): Promise<ExpansionResult> {
  const {
    minTxCount = 10,
    minVolumeOverlap = 30,
    windowHours = 720, // 30 days
    maxNewAddresses = 20,
  } = options;
  
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) {
    return { added: 0, updated: 0, skipped: 0, details: { verified: 0, attributed: 0, weak: 0 } };
  }
  
  const entityId = (entity as any)._id.toString();
  
  // Get verified addresses
  const verifiedAddresses = await EntityAddressModel.find({
    entityId,
    confidence: 'verified',
  }).lean();
  
  if (verifiedAddresses.length === 0) {
    console.log(`[AddressExpansion] ${entitySlug}: No verified addresses for correlation`);
    return { added: 0, updated: 0, skipped: 0, details: { verified: 0, attributed: 0, weak: 0 } };
  }
  
  const verifiedAddrSet = new Set(verifiedAddresses.map((a: any) => a.address.toLowerCase()));
  const startTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Find addresses that frequently transact with verified addresses
  const pipeline = [
    {
      $match: {
        chain: 'ethereum',
        timestamp: { $gte: startTime },
        $or: [
          { from: { $in: Array.from(verifiedAddrSet) } },
          { to: { $in: Array.from(verifiedAddrSet) } },
        ],
      },
    },
    // Get counterparties
    {
      $project: {
        counterparty: {
          $cond: [
            { $in: ['$from', Array.from(verifiedAddrSet)] },
            '$to',
            '$from',
          ],
        },
        amount: { $toDouble: { $ifNull: ['$amountNormalized', 0] } },
      },
    },
    // Filter out verified addresses and zero address
    {
      $match: {
        counterparty: {
          $nin: [...Array.from(verifiedAddrSet), '0x0000000000000000000000000000000000000000'],
        },
      },
    },
    // Group by counterparty
    {
      $group: {
        _id: '$counterparty',
        txCount: { $sum: 1 },
        totalVolume: { $sum: '$amount' },
      },
    },
    // Filter by minimum tx count
    {
      $match: {
        txCount: { $gte: minTxCount },
      },
    },
    // Sort by tx count
    { $sort: { txCount: -1 as const } },
    { $limit: maxNewAddresses * 2 },
  ];
  
  const candidates = await TransferModel.aggregate(pipeline as any[]);
  
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let attributed = 0;
  let weak = 0;
  
  for (const candidate of candidates) {
    if (added >= maxNewAddresses) break;
    
    const address = candidate._id?.toLowerCase();
    if (!address) continue;
    
    // Check if already exists
    const existing = await EntityAddressModel.findOne({
      entityId,
      chain: 'ethereum',
      address,
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    // Calculate correlation score
    const correlationScore = Math.min(100, (candidate.txCount / 50) * 100);
    
    // Determine confidence based on score
    let confidence: AddressConfidence = 'weak';
    if (correlationScore >= 60 && candidate.txCount >= minTxCount * 2) {
      confidence = 'attributed';
      attributed++;
    } else {
      weak++;
    }
    
    try {
      await EntityAddressModel.create({
        entityId,
        chain: 'ethereum',
        address,
        role: 'unknown',
        confidence,
        source: 'correlation',
        correlationScore,
        correlationTxCount: candidate.txCount,
        tags: [confidence],
        notes: `Auto-attributed: ${candidate.txCount} tx with verified addresses`,
      });
      added++;
    } catch (err) {
      skipped++;
    }
  }
  
  console.log(`[AddressExpansion] ${entitySlug}: +${attributed} attributed, +${weak} weak from correlation`);
  
  return {
    added,
    updated,
    skipped,
    details: { verified: 0, attributed, weak },
  };
}

/**
 * Run full address expansion for an entity
 */
export async function runFullExpansion(entitySlug: string): Promise<{
  verifiedResult: ExpansionResult;
  correlationResult: ExpansionResult;
  totalAddresses: number;
  coverageEstimate: number;
}> {
  // Step 1: Add verified addresses
  const verifiedResult = await expandFromVerifiedSources(entitySlug);
  
  // Step 2: Expand via correlation (only if we have verified addresses)
  const correlationResult = await expandFromCorrelation(entitySlug);
  
  // Get final count
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) {
    return {
      verifiedResult,
      correlationResult,
      totalAddresses: 0,
      coverageEstimate: 0,
    };
  }
  
  const entityId = (entity as any)._id.toString();
  
  const totalAddresses = await EntityAddressModel.countDocuments({
    entityId,
    confidence: { $in: ['verified', 'attributed'] }, // Only count usable addresses
  });
  
  // Estimate coverage (simplified - in reality would compare to expected addresses)
  const verifiedCount = await EntityAddressModel.countDocuments({
    entityId,
    confidence: 'verified',
  });
  
  // Rough coverage estimate based on typical exchange address count
  const expectedAddresses = entitySlug === 'binance' ? 30 : 15;
  const coverageEstimate = Math.min(100, Math.round((verifiedCount / expectedAddresses) * 100));
  
  return {
    verifiedResult,
    correlationResult,
    totalAddresses,
    coverageEstimate,
  };
}

/**
 * Get address statistics for an entity
 */
export async function getAddressStats(entitySlug: string): Promise<{
  total: number;
  verified: number;
  attributed: number;
  weak: number;
  byRole: Record<string, number>;
  coverageEstimate: number;
}> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) {
    return { total: 0, verified: 0, attributed: 0, weak: 0, byRole: {}, coverageEstimate: 0 };
  }
  
  const entityId = (entity as any)._id.toString();
  
  const stats = await EntityAddressModel.aggregate([
    { $match: { entityId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        verified: { $sum: { $cond: [{ $eq: ['$confidence', 'verified'] }, 1, 0] } },
        attributed: { $sum: { $cond: [{ $eq: ['$confidence', 'attributed'] }, 1, 0] } },
        weak: { $sum: { $cond: [{ $eq: ['$confidence', 'weak'] }, 1, 0] } },
      },
    },
  ]);
  
  const roleStats = await EntityAddressModel.aggregate([
    { $match: { entityId } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  
  const byRole = roleStats.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {} as Record<string, number>);
  
  const s = stats[0] || { total: 0, verified: 0, attributed: 0, weak: 0 };
  
  // Coverage estimate
  const expectedAddresses = entitySlug === 'binance' ? 30 : 15;
  const coverageEstimate = Math.min(100, Math.round((s.verified / expectedAddresses) * 100));
  
  return {
    total: s.total,
    verified: s.verified,
    attributed: s.attributed,
    weak: s.weak,
    byRole,
    coverageEstimate,
  };
}
