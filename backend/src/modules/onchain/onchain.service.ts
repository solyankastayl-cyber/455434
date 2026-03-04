/**
 * C2.1.1 — Onchain Snapshot Service
 * ==================================
 * 
 * Service for creating and managing on-chain snapshots.
 */

import {
  OnchainSnapshot,
  OnchainWindow,
  OnchainSnapshotResponse,
  OnchainHistoryResponse,
  ONCHAIN_THRESHOLDS,
} from './onchain.contracts.js';

import { generateMockSnapshot } from './onchain.provider.js';
import { OnchainSnapshotModel, OnchainProviderHealthModel, IOnchainSnapshotDoc } from './onchain.models.js';

class OnchainSnapshotService {
  private initialized = false;
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Initialize mock provider health
    await OnchainProviderHealthModel.findOneAndUpdate(
      { providerId: 'mock_onchain_v1' },
      {
        providerId: 'mock_onchain_v1',
        providerName: 'Mock Onchain Provider',
        status: 'UP',
        chains: ['bitcoin', 'ethereum', 'solana', 'arbitrum', 'base'],
        lastSuccessAt: Date.now(),
        successRate24h: 1.0,
        avgLatencyMs: 10,
        checkedAt: Date.now(),
      },
      { upsert: true, new: true }
    );
    
    this.initialized = true;
    console.log('[C2.1] OnchainSnapshotService initialized');
  }
  
  async getSnapshot(
    symbol: string,
    t0?: number,
    window: OnchainWindow = '1h'
  ): Promise<OnchainSnapshotResponse> {
    await this.initialize();
    
    const effectiveT0 = t0 || Date.now();
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    // Check DB for existing
    const tolerance = 60_000;
    const existing = await OnchainSnapshotModel.findOne({
      symbol: normalizedSymbol,
      window,
      t0: { $gte: effectiveT0 - tolerance, $lte: effectiveT0 + tolerance },
    });
    
    if (existing) {
      return {
        ok: true,
        snapshot: this.docToSnapshot(existing),
        source: existing.source,
        confidence: existing.sourceQuality,
        dataAvailable: existing.sourceQuality >= ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE,
      };
    }
    
    // Generate mock snapshot
    const snapshot = generateMockSnapshot(normalizedSymbol, effectiveT0, window);
    
    // Store in DB
    try {
      await OnchainSnapshotModel.findOneAndUpdate(
        { symbol: normalizedSymbol, t0: effectiveT0, window },
        snapshot,
        { upsert: true }
      );
    } catch (error) {
      if ((error as any).code !== 11000) {
        console.error('[Onchain] Store error:', error);
      }
    }
    
    return {
      ok: true,
      snapshot,
      source: 'mock',
      confidence: snapshot.sourceQuality,
      dataAvailable: snapshot.sourceQuality >= ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE,
    };
  }
  
  async getLatest(symbol: string, window: OnchainWindow = '1h'): Promise<OnchainSnapshotResponse> {
    await this.initialize();
    
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const latest = await OnchainSnapshotModel.findOne(
      { symbol: normalizedSymbol, window },
      {},
      { sort: { t0: -1 } }
    );
    
    if (latest) {
      return {
        ok: true,
        snapshot: this.docToSnapshot(latest),
        source: latest.source,
        confidence: latest.sourceQuality,
        dataAvailable: latest.sourceQuality >= ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE,
      };
    }
    
    return this.getSnapshot(normalizedSymbol, Date.now(), window);
  }
  
  async getHistory(
    symbol: string,
    from: number,
    to: number,
    window: OnchainWindow = '1h'
  ): Promise<OnchainHistoryResponse> {
    await this.initialize();
    
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const snapshots = await OnchainSnapshotModel.find({
      symbol: normalizedSymbol,
      window,
      t0: { $gte: from, $lte: to },
    }).sort({ t0: 1 }).limit(1000);
    
    return {
      ok: true,
      observations: snapshots.map(s => ({
        id: s._id.toString(),
        symbol: s.symbol,
        t0: s.t0,
        window: s.window,
        snapshot: this.docToSnapshot(s),
        metrics: {
          symbol: s.symbol,
          t0: s.t0,
          window: s.window,
          flowScore: 0,
          exchangePressure: 0,
          whaleActivity: 0,
          networkHeat: 0,
          dataCompleteness: 1 - (s.missingFields?.length || 0) / 15,
          confidence: s.sourceQuality,
          drivers: [],
          missing: s.missingFields || [],
        },
        diagnostics: {
          calculatedAt: s.createdAt?.getTime() || Date.now(),
          processingTimeMs: 0,
          provider: s.sourceProvider || 'mock',
          warnings: [],
        },
        createdAt: s.createdAt?.getTime() || Date.now(),
        updatedAt: s.createdAt?.getTime() || Date.now(),
      })),
      count: snapshots.length,
      range: { from, to },
    };
  }
  
  private docToSnapshot(doc: IOnchainSnapshotDoc): OnchainSnapshot {
    return {
      symbol: doc.symbol,
      chain: doc.chain,
      t0: doc.t0,
      snapshotTimestamp: doc.snapshotTimestamp,
      window: doc.window,
      exchangeInflowUsd: doc.exchangeInflowUsd,
      exchangeOutflowUsd: doc.exchangeOutflowUsd,
      exchangeNetUsd: doc.exchangeNetUsd,
      netInflowUsd: doc.netInflowUsd,
      netOutflowUsd: doc.netOutflowUsd,
      netFlowUsd: doc.netFlowUsd,
      activeAddresses: doc.activeAddresses,
      txCount: doc.txCount,
      feesUsd: doc.feesUsd,
      largeTransfersCount: doc.largeTransfersCount,
      largeTransfersVolumeUsd: doc.largeTransfersVolumeUsd,
      topHolderDeltaUsd: doc.topHolderDeltaUsd,
      source: doc.source,
      sourceProvider: doc.sourceProvider,
      sourceQuality: doc.sourceQuality,
      missingFields: doc.missingFields || [],
    };
  }
}

export const onchainSnapshotService = new OnchainSnapshotService();

console.log('[C2.1] OnchainSnapshotService loaded');
