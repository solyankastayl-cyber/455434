/**
 * S7.1 — OnchainSnapshot Service
 * ===============================
 * 
 * Creates snapshots of on-chain state at signal time.
 * Adapter pattern: reads from existing onchain modules, writes to snapshot.
 * 
 * CRITICAL: Snapshot timestamp MUST be <= t0 (NO LOOKAHEAD!)
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { OnchainSnapshotModel, IOnchainSnapshot, OnchainSource } from './onchain-snapshot.model.js';
import mongoose from 'mongoose';

// ============================================================
// Types
// ============================================================

export interface SnapshotInput {
  signal_id: string;
  observation_id?: string;
  asset: 'BTC' | 'ETH' | 'SOL';
  t0_timestamp: Date;
  window?: '1h' | '4h' | '24h';
}

export interface SnapshotResult {
  snapshot: IOnchainSnapshot | null;
  source: OnchainSource;
  confidence: number;
  data_available: boolean;
}

// ============================================================
// Asset to Network Mapping
// ============================================================

const ASSET_NETWORKS: Record<string, string> = {
  BTC: 'bitcoin',   // BTC doesn't have direct onchain in our system, mock
  ETH: 'ethereum',
  SOL: 'solana',    // Solana not indexed yet, mock
};

const ASSET_TOKEN_ADDRESSES: Record<string, string> = {
  ETH: '0x0000000000000000000000000000000000000000',  // Native ETH
};

// ============================================================
// Whale Thresholds
// ============================================================

const WHALE_THRESHOLDS = {
  ETH: {
    minTxValue: 100,  // $100k minimum for whale
    significantCount: 5,  // 5+ whale txs = whale_activity_flag
  },
  BTC: {
    minTxValue: 100,
    significantCount: 5,
  },
  SOL: {
    minTxValue: 50,
    significantCount: 10,
  },
};

// ============================================================
// OnchainSnapshot Service
// ============================================================

class OnchainSnapshotService {
  private db: Db | null = null;
  private transfers: Collection | null = null;
  private exchangePressure: Collection | null = null;
  
  /**
   * Connect to MongoDB
   */
  async connect(): Promise<void> {
    if (this.db) return;
    
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'price_correlator';
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    this.db = client.db(dbName);
    
    this.transfers = this.db.collection('transfers');
    this.exchangePressure = this.db.collection('exchange_pressure');
    
    console.log('[OnchainSnapshot] Connected to MongoDB');
  }
  
  /**
   * Create snapshot for a signal
   * PRIMARY SOURCE: existing exchange_pressure + transfers
   * FALLBACK: mock data
   */
  async createSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
    await this.connect();
    
    const window = input.window || '1h';
    const network = ASSET_NETWORKS[input.asset] || 'ethereum';
    
    // Check if snapshot already exists
    const existing = await OnchainSnapshotModel.findOne({
      signal_id: input.signal_id,
      window,
    });
    
    if (existing) {
      return {
        snapshot: existing,
        source: existing.source as OnchainSource,
        confidence: existing.confidence,
        data_available: existing.confidence >= 0.4,
      };
    }
    
    // Try to get real data
    let snapshotData = await this.fetchRealOnchainData(input, network, window);
    
    // Fallback to mock if no real data
    if (!snapshotData || snapshotData.confidence < 0.2) {
      console.log(`[OnchainSnapshot] No real data for ${input.signal_id}, using mock`);
      snapshotData = this.generateMockSnapshot(input, window);
    }
    
    // Create snapshot document
    const snapshot = new OnchainSnapshotModel({
      signal_id: input.signal_id,
      observation_id: input.observation_id,
      asset: input.asset,
      network,
      t0_timestamp: input.t0_timestamp,
      snapshot_timestamp: new Date(input.t0_timestamp.getTime() - 60000), // 1 min before t0
      window,
      ...snapshotData,
    });
    
    await snapshot.save();
    
    return {
      snapshot,
      source: snapshotData.source,
      confidence: snapshotData.confidence,
      data_available: snapshotData.confidence >= 0.4,
    };
  }
  
  /**
   * Fetch real on-chain data from existing modules
   * CRITICAL: Only data BEFORE t0
   */
  private async fetchRealOnchainData(
    input: SnapshotInput,
    network: string,
    window: string
  ): Promise<Partial<IOnchainSnapshot> | null> {
    if (!this.exchangePressure || !this.transfers) return null;
    
    // Only ETH has real data in our system
    if (input.asset !== 'ETH') {
      return null;
    }
    
    const windowHours = window === '1h' ? 1 : window === '4h' ? 4 : 24;
    const windowStart = new Date(input.t0_timestamp.getTime() - windowHours * 60 * 60 * 1000);
    
    // 1. Get exchange pressure data (BEFORE t0)
    const pressureData = await this.exchangePressure.findOne({
      network,
      timestamp: { $lte: input.t0_timestamp, $gte: windowStart },
    }, {
      sort: { timestamp: -1 },
    });
    
    // 2. Get transfer counts for whale detection (BEFORE t0)
    const transferAgg = await this.transfers.aggregate([
      {
        $match: {
          chain: network,
          timestamp: { $lte: input.t0_timestamp, $gte: windowStart },
        },
      },
      {
        $group: {
          _id: null,
          total_count: { $sum: 1 },
          large_tx_count: {
            $sum: { $cond: [{ $gt: ['$amountNormalized', 100000] }, 1, 0] },
          },
        },
      },
    ]).toArray();
    
    const transferStats = transferAgg[0] || { total_count: 0, large_tx_count: 0 };
    
    // Calculate derived values
    const raw_signals: IOnchainSnapshot['raw_signals'] = [];
    let data_points = 0;
    
    // Exchange pressure
    let exchange_inflow = 0;
    let exchange_outflow = 0;
    let exchange_pressure = 0;
    let exchange_signal: IOnchainSnapshot['exchange_signal'] = 'NEUTRAL';
    
    if (pressureData) {
      exchange_inflow = pressureData.inflow || 0;
      exchange_outflow = pressureData.outflow || 0;
      exchange_pressure = pressureData.pressure || 0;
      exchange_signal = pressureData.signal || 'NEUTRAL';
      data_points++;
      
      raw_signals.push({
        type: 'exchange_pressure',
        value: exchange_pressure,
        source: 'exchange_pressure_model',
      });
    }
    
    // Whale activity
    const whale_tx_count = transferStats.large_tx_count;
    const whale_activity_flag = whale_tx_count >= (WHALE_THRESHOLDS[input.asset]?.significantCount || 5);
    
    if (transferStats.total_count > 0) {
      data_points++;
      raw_signals.push({
        type: 'whale_tx_count',
        value: whale_tx_count,
        source: 'transfers',
      });
    }
    
    // Calculate confidence based on data completeness
    const confidence = Math.min(1, data_points / 2);
    
    if (confidence < 0.3) {
      return null;
    }
    
    return {
      exchange_inflow,
      exchange_outflow,
      net_flow: exchange_inflow - exchange_outflow,
      whale_tx_count,
      whale_volume: 0,  // Would need amount aggregation
      whale_activity_flag,
      exchange_pressure,
      exchange_signal,
      source: 'exchange_pressure' as OnchainSource,
      confidence,
      data_points_used: data_points,
      raw_signals,
    };
  }
  
  /**
   * Generate mock snapshot with realistic patterns
   * Used when real data unavailable
   */
  private generateMockSnapshot(input: SnapshotInput, window: string): Partial<IOnchainSnapshot> {
    // Generate semi-random but deterministic values based on signal_id
    const hash = this.hashCode(input.signal_id);
    
    // Vary based on hash for realistic distribution
    const inflowBias = (hash % 100) / 100;
    const exchange_inflow = Math.floor(50 + inflowBias * 150);
    const exchange_outflow = Math.floor(50 + (1 - inflowBias) * 150);
    const net_flow = exchange_inflow - exchange_outflow;
    
    // Exchange pressure calculation
    const total = exchange_inflow + exchange_outflow;
    const exchange_pressure = total > 0 ? net_flow / total : 0;
    
    let exchange_signal: IOnchainSnapshot['exchange_signal'] = 'NEUTRAL';
    if (exchange_pressure <= -0.5) exchange_signal = 'STRONG_BUY';
    else if (exchange_pressure <= -0.2) exchange_signal = 'BUY';
    else if (exchange_pressure >= 0.5) exchange_signal = 'STRONG_SELL';
    else if (exchange_pressure >= 0.2) exchange_signal = 'SELL';
    
    // Whale activity
    const whale_tx_count = Math.floor((hash % 20));
    const whale_activity_flag = whale_tx_count >= 5;
    
    return {
      exchange_inflow,
      exchange_outflow,
      net_flow,
      whale_tx_count,
      whale_volume: whale_tx_count * (50000 + (hash % 100000)),
      whale_activity_flag,
      exchange_pressure: Math.round(exchange_pressure * 100) / 100,
      exchange_signal,
      source: 'mock' as OnchainSource,
      confidence: 0.5,  // Mock data gets medium confidence
      data_points_used: 0,
      raw_signals: [
        { type: 'mock_exchange_pressure', value: exchange_pressure, source: 'mock' },
        { type: 'mock_whale_count', value: whale_tx_count, source: 'mock' },
      ],
    };
  }
  
  /**
   * Get snapshot by signal_id
   */
  async getSnapshot(signal_id: string, window: string = '1h'): Promise<IOnchainSnapshot | null> {
    await this.connect();
    return OnchainSnapshotModel.findOne({ signal_id, window });
  }
  
  /**
   * Get snapshots for multiple signals
   */
  async getSnapshots(signal_ids: string[]): Promise<IOnchainSnapshot[]> {
    await this.connect();
    return OnchainSnapshotModel.find({ signal_id: { $in: signal_ids } });
  }
  
  /**
   * Get snapshot statistics
   */
  async getStats(): Promise<{
    total: number;
    by_source: Record<string, number>;
    by_asset: Record<string, number>;
    avg_confidence: number;
    data_available_rate: number;
  }> {
    await this.connect();
    
    const stats = await OnchainSnapshotModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avg_confidence: { $avg: '$confidence' },
          data_available: { $sum: { $cond: [{ $gte: ['$confidence', 0.4] }, 1, 0] } },
        },
      },
    ]);
    
    const bySource = await OnchainSnapshotModel.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]);
    
    const byAsset = await OnchainSnapshotModel.aggregate([
      { $group: { _id: '$asset', count: { $sum: 1 } } },
    ]);
    
    const s = stats[0] || { total: 0, avg_confidence: 0, data_available: 0 };
    
    return {
      total: s.total,
      by_source: Object.fromEntries(bySource.map((x: { _id: string; count: number }) => [x._id, x.count])),
      by_asset: Object.fromEntries(byAsset.map((x: { _id: string; count: number }) => [x._id, x.count])),
      avg_confidence: Math.round(s.avg_confidence * 100) / 100,
      data_available_rate: s.total > 0 ? Math.round((s.data_available / s.total) * 100) : 0,
    };
  }
  
  /**
   * Simple hash function for deterministic mock generation
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

export const onchainSnapshotService = new OnchainSnapshotService();
