/**
 * Unified Chain Events Model (P2.3.2)
 * 
 * Single source of truth for all cross-chain events
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type EventType = 'TRANSFER' | 'BRIDGE_IN' | 'BRIDGE_OUT';
export type IngestionSource = 'rpc' | 'explorer';

export interface UnifiedChainEvent {
  eventId: string;              // deterministic hash
  chain: string;
  chainId: number | string;
  
  txHash: string;
  blockNumber: number;
  timestamp: number;
  
  from: string;
  to: string;
  
  tokenAddress?: string;
  tokenSymbol?: string;
  
  amount: string;
  amountUsd?: number;
  
  eventType: EventType;
  
  ingestionSource: IngestionSource;
  createdAt: Date;
}

// ============================================
// Unified Chain Event Document
// ============================================

export interface IUnifiedChainEventDocument extends Document {
  eventId: string;
  chain: string;
  chainId: number | string;
  
  txHash: string;
  blockNumber: number;
  timestamp: number;
  
  from: string;
  to: string;
  
  tokenAddress?: string;
  tokenSymbol?: string;
  
  amount: string;
  amountUsd?: number;
  
  eventType: EventType;
  
  ingestionSource: IngestionSource;
  createdAt: Date;
}

const UnifiedChainEventSchema = new Schema<IUnifiedChainEventDocument>({
  eventId: { type: String, required: true, unique: true, index: true },
  chain: { type: String, required: true, index: true },
  chainId: { type: Schema.Types.Mixed, required: true },
  
  txHash: { type: String, required: true, index: true },
  blockNumber: { type: Number, required: true },
  timestamp: { type: Number, required: true, index: true },
  
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  
  tokenAddress: { type: String, index: true },
  tokenSymbol: { type: String },
  
  amount: { type: String, required: true },
  amountUsd: { type: Number },
  
  eventType: { 
    type: String, 
    enum: ['TRANSFER', 'BRIDGE_IN', 'BRIDGE_OUT'],
    required: true,
    index: true 
  },
  
  ingestionSource: { 
    type: String, 
    enum: ['rpc', 'explorer'],
    required: true 
  },
  
  createdAt: { type: Date, default: Date.now, index: true },
});

// Compound indexes for efficient queries
UnifiedChainEventSchema.index({ from: 1, timestamp: -1 });
UnifiedChainEventSchema.index({ to: 1, timestamp: -1 });
UnifiedChainEventSchema.index({ tokenAddress: 1, timestamp: -1 });
UnifiedChainEventSchema.index({ chain: 1, blockNumber: -1 });
UnifiedChainEventSchema.index({ eventType: 1, timestamp: -1 });

export const UnifiedChainEventModel = mongoose.model<IUnifiedChainEventDocument>(
  'unified_chain_events', 
  UnifiedChainEventSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Get events by wallet address
 */
export async function getEventsByWallet(
  address: string, 
  options?: {
    chain?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }
): Promise<IUnifiedChainEventDocument[]> {
  const query: any = {
    $or: [
      { from: address.toLowerCase() },
      { to: address.toLowerCase() }
    ]
  };
  
  if (options?.chain) query.chain = options.chain;
  if (options?.startTime) query.timestamp = { $gte: options.startTime };
  if (options?.endTime) {
    query.timestamp = { ...query.timestamp, $lte: options.endTime };
  }
  
  return UnifiedChainEventModel.find(query)
    .sort({ timestamp: -1 })
    .limit(options?.limit || 100)
    .lean();
}

/**
 * Get events by token
 */
export async function getEventsByToken(
  tokenAddress: string,
  options?: {
    chain?: string;
    limit?: number;
  }
): Promise<IUnifiedChainEventDocument[]> {
  const query: any = {
    tokenAddress: tokenAddress.toLowerCase()
  };
  
  if (options?.chain) query.chain = options.chain;
  
  return UnifiedChainEventModel.find(query)
    .sort({ timestamp: -1 })
    .limit(options?.limit || 100)
    .lean();
}

/**
 * Get events by chain and block range
 */
export async function getEventsByBlockRange(
  chain: string,
  startBlock: number,
  endBlock: number
): Promise<IUnifiedChainEventDocument[]> {
  return UnifiedChainEventModel.find({
    chain,
    blockNumber: { $gte: startBlock, $lte: endBlock }
  })
  .sort({ blockNumber: 1 })
  .lean();
}

/**
 * Check if event exists
 */
export async function eventExists(eventId: string): Promise<boolean> {
  const count = await UnifiedChainEventModel.countDocuments({ eventId });
  return count > 0;
}

/**
 * Get event statistics
 */
export async function getEventStats(chain?: string): Promise<{
  totalEvents: number;
  eventsByType: Record<EventType, number>;
  eventsByChain?: Record<string, number>;
  latestTimestamp: number;
}> {
  const matchStage: any = {};
  if (chain) matchStage.chain = chain;
  
  const [typeStats, chainStats, latest] = await Promise.all([
    // Events by type
    UnifiedChainEventModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]),
    
    // Events by chain (if not filtering by chain)
    !chain ? UnifiedChainEventModel.aggregate([
      { $group: { _id: '$chain', count: { $sum: 1 } } }
    ]) : Promise.resolve([]),
    
    // Latest timestamp
    UnifiedChainEventModel.findOne(matchStage)
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean()
  ]);
  
  const eventsByType = typeStats.reduce((acc, stat) => {
    acc[stat._id as EventType] = stat.count;
    return acc;
  }, {} as Record<EventType, number>);
  
  const eventsByChain = chain ? undefined : chainStats.reduce((acc, stat) => {
    acc[stat._id] = stat.count;
    return acc;
  }, {} as Record<string, number>);
  
  const totalEvents = typeStats.reduce((sum, stat) => sum + stat.count, 0);
  
  return {
    totalEvents,
    eventsByType,
    eventsByChain,
    latestTimestamp: latest?.timestamp || 0
  };
}
