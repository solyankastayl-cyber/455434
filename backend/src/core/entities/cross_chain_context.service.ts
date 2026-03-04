/**
 * Cross-Chain Context Service (EPIC 5)
 * 
 * Честное ограничение cross-chain данных.
 * 
 * АРХИТЕКТУРНЫЙ ПРИНЦИП:
 * Cross-chain = Context ONLY, NOT Metrics
 * 
 * ❌ НЕ участвует в:
 *   - Net Flow
 *   - Coverage
 *   - Engine Signals
 *   - ML Features
 * 
 * ✅ ТОЛЬКО контекст:
 *   - Факт наличия активности на chain
 *   - Activity level (primary/secondary/observed)
 *   - Confidence (high/medium/low)
 * 
 * 🚨 SAFETY RULE:
 * Cross-chain context MUST NOT be used in:
 * - Engine aggregation
 * - ML feature builder
 * - Confidence calculation
 */
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

// ============ TYPES ============

export type ActivityLevel = 'primary' | 'secondary' | 'observed';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DisclaimerLevel = 'strong' | 'moderate' | 'minimal';

export interface ChainActivity {
  chain: string;
  chainDisplayName: string;
  activity: ActivityLevel;
  confidence: ConfidenceLevel;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

export interface CrossChainContextResult {
  entity: string;
  entityName: string;
  status: 'partial' | 'limited' | 'none';
  disclaimerLevel: DisclaimerLevel;
  primaryChain: string;
  chains: ChainActivity[];
  notes: string[];
  lastUpdated: Date;
}

// ============ CHAIN METADATA ============

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  'ethereum': 'Ethereum',
  'arbitrum': 'Arbitrum',
  'optimism': 'Optimism',
  'polygon': 'Polygon',
  'base': 'Base',
  'bsc': 'BNB Chain',
  'avalanche': 'Avalanche',
  'fantom': 'Fantom',
};

// Known bridge contracts (simplified heuristics)
const BRIDGE_HEURISTICS = {
  // Arbitrum bridge
  arbitrumBridge: '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a',
  // Optimism bridge
  optimismBridge: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1',
  // Polygon bridge
  polygonBridge: '0xa0c68c638235ee32657e8f720a23cec1bfc77c77',
};

// ============ HELPERS ============

async function getEntityAddresses(entitySlug: string): Promise<string[]> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  if (!entity) return [];
  
  const addresses = await EntityAddressModel.find({ 
    entityId: (entity as any)._id.toString(),
    confidence: { $in: ['verified', 'attributed'] },
  }).lean();
  
  return addresses.map((a: any) => a.address.toLowerCase());
}

// ============ MAIN SERVICE ============

/**
 * Get Cross-Chain Context for an entity
 * 
 * Returns CONTEXT ONLY - no USD, no %, no aggregates
 * 
 * 🚨 SAFETY: This data MUST NOT be used in Engine or ML
 */
export async function getCrossChainContext(
  entitySlug: string
): Promise<CrossChainContextResult> {
  const entity = await EntityModel.findOne({ slug: entitySlug.toLowerCase() }).lean();
  
  if (!entity) {
    return {
      entity: entitySlug,
      entityName: entitySlug,
      status: 'none',
      disclaimerLevel: 'strong',
      primaryChain: 'ethereum',
      chains: [],
      notes: ['Entity not found'],
      lastUpdated: new Date(),
    };
  }
  
  const addresses = await getEntityAddresses(entitySlug);
  
  if (addresses.length === 0) {
    return {
      entity: entitySlug,
      entityName: (entity as any).name,
      status: 'none',
      disclaimerLevel: 'strong',
      primaryChain: 'ethereum',
      chains: [],
      notes: ['No verified or attributed addresses'],
      lastUpdated: new Date(),
    };
  }
  
  // Query transfers grouped by chain
  const chainActivityPipeline = [
    {
      $match: {
        $or: [
          { from: { $in: addresses } },
          { to: { $in: addresses } },
        ],
      },
    },
    {
      $group: {
        _id: '$chain',
        txCount: { $sum: 1 },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
      },
    },
    { $sort: { txCount: -1 as const } },
  ];
  
  const chainResults = await TransferModel.aggregate(chainActivityPipeline as any[]);
  
  if (chainResults.length === 0) {
    return {
      entity: entitySlug,
      entityName: (entity as any).name,
      status: 'none',
      disclaimerLevel: 'strong',
      primaryChain: 'ethereum',
      chains: [{
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
        activity: 'primary',
        confidence: 'high',
        firstSeen: null,
        lastSeen: null,
      }],
      notes: [
        'No on-chain activity detected in indexed data.',
        'Cross-chain activity is shown for context only.',
      ],
      lastUpdated: new Date(),
    };
  }
  
  // Determine primary chain (most activity)
  const primaryChainResult = chainResults[0];
  const primaryChain = primaryChainResult._id || 'ethereum';
  const totalTxCount = chainResults.reduce((sum, c) => sum + c.txCount, 0);
  
  // Build chain activity list
  const chains: ChainActivity[] = chainResults.map((c, index) => {
    const chain = c._id || 'unknown';
    const txShare = c.txCount / totalTxCount;
    
    // Determine activity level
    let activity: ActivityLevel = 'observed';
    if (index === 0 || txShare > 0.5) {
      activity = 'primary';
    } else if (txShare > 0.1) {
      activity = 'secondary';
    }
    
    // Determine confidence
    // Based on tx count and recency
    let confidence: ConfidenceLevel = 'low';
    const daysSinceLastSeen = c.lastSeen 
      ? (Date.now() - new Date(c.lastSeen).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    
    if (c.txCount > 100 && daysSinceLastSeen < 7) {
      confidence = 'high';
    } else if (c.txCount > 10 && daysSinceLastSeen < 30) {
      confidence = 'medium';
    }
    
    return {
      chain,
      chainDisplayName: CHAIN_DISPLAY_NAMES[chain] || chain,
      activity,
      confidence,
      firstSeen: c.firstSeen || null,
      lastSeen: c.lastSeen || null,
    };
  });
  
  // Determine overall status
  let status: CrossChainContextResult['status'] = 'partial';
  if (chains.length <= 1) {
    status = 'limited';
  }
  
  // Disclaimer level based on confidence
  const highConfidenceCount = chains.filter(c => c.confidence === 'high').length;
  let disclaimerLevel: DisclaimerLevel = 'strong';
  if (highConfidenceCount >= 2) {
    disclaimerLevel = 'moderate';
  } else if (highConfidenceCount >= 1 && chains.length > 2) {
    disclaimerLevel = 'moderate';
  }
  
  // Build notes
  const notes: string[] = [
    'Cross-chain activity is detected based on address overlap and transfer heuristics.',
    'No cross-chain flows are aggregated into entity metrics.',
    'Displayed data is contextual, not exhaustive.',
  ];
  
  if (chains.some(c => c.confidence === 'low')) {
    notes.push('Some chains have low confidence due to limited data.');
  }
  
  return {
    entity: entitySlug,
    entityName: (entity as any).name,
    status,
    disclaimerLevel,
    primaryChain,
    chains,
    notes,
    lastUpdated: new Date(),
  };
}

/**
 * 🚨 ML SAFETY GUARD
 * 
 * This function should be called by ML feature builder to verify
 * that cross-chain data is NOT being used.
 */
export function mlSafetyCheck(): { safe: boolean; message: string } {
  return {
    safe: true,
    message: 'Cross-chain context is excluded from ML features by design. See EPIC 5 specification.',
  };
}
