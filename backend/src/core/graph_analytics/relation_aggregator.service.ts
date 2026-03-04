/**
 * Relation Aggregator Service - ETAP D1
 * 
 * Core service for aggregating raw transactions into analytical relations.
 * This is the KEY layer between raw data and graph builder.
 * 
 * PRINCIPLE:
 * - Graph builder NEVER reads raw tx
 * - Graph builder ONLY reads aggregated relations
 * - 1 relation = many transactions
 */

import { mongoose } from '../../db/mongoose.js';
import type { NetworkType } from '../../common/network.types.js';
import type { AggregatedRelation } from './aggregation.pipeline.js';
import { buildAddressRelationsPipeline } from './aggregation.pipeline.js';
import { calculateConfidence, calculateEdgeWeight, getConfidenceLevel } from './confidence_calculator.js';
import { checkIfBridgeDestination } from '../cross_chain/cross_chain_detector.js';

/**
 * Options for relation aggregation
 */
export interface AggregationOptions {
  network: NetworkType;
  limit?: number;
  minTxCount?: number;
  minVolumeUsd?: number;
  timeWindowDays?: number;
  includeLabels?: boolean;
}

/**
 * Known entity labels (CEX, DEX, Bridge, etc.)
 */
const KNOWN_ENTITIES: Record<string, { type: string; name: string }> = {
  // CEX Hot Wallets
  '0x28c6c06298d514db089934071355e5743bf21d60': { type: 'CEX', name: 'Binance' },
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { type: 'CEX', name: 'Binance' },
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { type: 'CEX', name: 'Binance' },
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': { type: 'CEX', name: 'Binance' },
  '0xf977814e90da44bfa03b6295a0616a897441acec': { type: 'CEX', name: 'Binance' },
  '0x2f47a1c2db4a3b78cda44eade915c3b19107ddcc': { type: 'CEX', name: 'Coinbase' },
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': { type: 'CEX', name: 'Coinbase' },
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { type: 'CEX', name: 'Coinbase' },
  '0x503828976d22510aad0201ac7ec88293211d23da': { type: 'CEX', name: 'Coinbase' },
  '0xeb2629a2734e272bcc07bda959863f316f4bd4cf': { type: 'CEX', name: 'Kraken' },
  '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': { type: 'CEX', name: 'Kraken' },
  // DEX Routers
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { type: 'DEX', name: 'Uniswap V2' },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { type: 'DEX', name: 'Uniswap V3' },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { type: 'DEX', name: 'Uniswap Router' },
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': { type: 'DEX', name: 'SushiSwap' },
  '0x1111111254fb6c44bac0bed2854e76f90643097d': { type: 'DEX', name: '1inch' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { type: 'DEX', name: '1inch V5' },
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': { type: 'DEX', name: '0x' },
};

/**
 * Aggregate relations for a specific address
 * 
 * This is the MAIN entry point for graph builder.
 */
export async function aggregateRelationsForAddress(
  address: string,
  options: AggregationOptions
): Promise<AggregatedRelation[]> {
  const addr = address.toLowerCase();
  const network = options.network;
  
  console.log(`[Aggregator] Aggregating relations for ${addr} on ${network}...`);
  
  try {
    const db = mongoose.connection?.db;
    if (!db) {
      console.warn('[Aggregator] No DB connection');
      return [];
    }
    
    // Run aggregation pipeline on transfers
    const pipeline = buildAddressRelationsPipeline(addr, network, {
      limit: options.limit ?? 50,
      minTxCount: options.minTxCount ?? 1,
      minVolumeUsd: options.minVolumeUsd ?? 0,
      timeWindowDays: options.timeWindowDays ?? 365,
    });
    
    const rawResults = await db.collection('transfers').aggregate(pipeline).toArray();
    
    console.log(`[Aggregator] Pipeline returned ${rawResults.length} aggregated relations`);
    
    if (rawResults.length === 0) {
      // Fallback to relations collection
      console.log('[Aggregator] Trying relations collection...');
      return await aggregateFromRelations(addr, network, options);
    }
    
    // Calculate max volume for weight normalization
    const maxVolume = Math.max(...rawResults.map(r => r.volumeUsd || 0), 1);
    
    // Transform to AggregatedRelation format
    const relations: AggregatedRelation[] = rawResults.map(r => {
      const confidence = calculateConfidence({
        txCount: r.txCount,
        volumeUsd: r.volumeUsd || 0,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        tokens: r.tokens,
      });
      
      const weight = calculateEdgeWeight(
        { volumeUsd: r.volumeUsd || 0, confidence },
        maxVolume
      );
      
      // Detect entity type
      const counterparty = r.counterparty;
      const entityInfo = getEntityInfo(counterparty, network);
      
      return {
        from: r._id.from,
        to: r._id.to,
        network,
        txCount: r.txCount,
        volumeUsd: r.volumeUsd || 0,
        volumeNative: r.volumeNative || 0,
        avgTxSize: r.avgTxSize || 0,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        confidence,
        confidenceLevel: getConfidenceLevel(confidence),
        weight,
        direction: r.direction as 'IN' | 'OUT',
        counterparty,
        tags: entityInfo.tags,
        entityType: entityInfo.type,
        entityName: entityInfo.name,
      } as AggregatedRelation & { 
        weight: number; 
        counterparty: string;
        entityType?: string;
        entityName?: string;
        confidenceLevel: string;
      };
    });
    
    console.log(`[Aggregator] Returning ${relations.length} aggregated relations`);
    
    return relations;
    
  } catch (err) {
    console.error('[Aggregator] Error:', err);
    return [];
  }
}

/**
 * Fallback: Aggregate from relations collection
 */
async function aggregateFromRelations(
  address: string,
  network: NetworkType,
  options: AggregationOptions
): Promise<AggregatedRelation[]> {
  const addr = address.toLowerCase();
  const db = mongoose.connection?.db;
  if (!db) return [];
  
  const relations = await db.collection('relations')
    .find({
      $or: [
        { from: { $regex: addr, $options: 'i' } },
        { to: { $regex: addr, $options: 'i' } },
      ],
      $or: [
        { chain: network },
        { chain: network.toLowerCase() },
      ],
    })
    .sort({ volumeUsd: -1, interactionCount: -1 })
    .limit(options.limit ?? 50)
    .toArray();
  
  console.log(`[Aggregator] Found ${relations.length} relations from relations collection`);
  
  const maxVolume = Math.max(...relations.map(r => parseFloat(r.volumeUsd || r.volumeRaw || '0')), 1);
  
  return relations.map(r => {
    const isOutgoing = r.from.toLowerCase() === addr;
    const counterparty = isOutgoing ? r.to : r.from;
    const volumeUsd = parseFloat(r.volumeUsd || r.volumeRaw || '0');
    const txCount = r.interactionCount || 1;
    
    const confidence = calculateConfidence({
      txCount,
      volumeUsd,
      firstSeen: r.firstSeenAt || new Date(),
      lastSeen: r.lastSeenAt || new Date(),
    });
    
    const weight = calculateEdgeWeight({ volumeUsd, confidence }, maxVolume);
    const entityInfo = getEntityInfo(counterparty, network);
    
    return {
      from: r.from.toLowerCase(),
      to: r.to.toLowerCase(),
      network,
      txCount,
      volumeUsd,
      volumeNative: parseFloat(r.volumeRaw || '0'),
      avgTxSize: txCount > 0 ? volumeUsd / txCount : 0,
      firstSeen: r.firstSeenAt || new Date(),
      lastSeen: r.lastSeenAt || new Date(),
      confidence,
      weight,
      direction: isOutgoing ? 'OUT' : 'IN',
      counterparty,
      tags: entityInfo.tags,
      entityType: entityInfo.type,
      entityName: entityInfo.name,
    } as AggregatedRelation & { weight: number; counterparty: string };
  });
}

/**
 * Get entity info (CEX, DEX, Bridge, etc.)
 */
function getEntityInfo(address: string, network: NetworkType): {
  type?: string;
  name?: string;
  tags: string[];
} {
  const addr = address.toLowerCase();
  const tags: string[] = [];
  
  // Check known entities
  const known = KNOWN_ENTITIES[addr];
  if (known) {
    tags.push(known.type);
    return { type: known.type, name: known.name, tags };
  }
  
  // Check if bridge
  const bridgeCheck = checkIfBridgeDestination(addr, network);
  if (bridgeCheck.isBridge) {
    tags.push('BRIDGE');
    return { type: 'BRIDGE', name: bridgeCheck.protocol, tags };
  }
  
  return { tags };
}

/**
 * Export singleton-style
 */
export const relationAggregator = {
  aggregateRelationsForAddress,
};
