/**
 * Exchange Snapshot Service (BLOCK 1)
 * 
 * Core service for managing prediction snapshots.
 * Key method: archiveAndCreate - atomically archives previous ACTIVE and creates new one.
 * 
 * CRITICAL: This service ensures the immutable ledger property:
 * - Old snapshots are NEVER modified (only status changes)
 * - New predictions always create NEW records
 * - Only ONE ACTIVE snapshot per symbol/horizon at any time
 */

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ExchangePredictionSnapshot,
  SnapshotStatus,
  SnapshotOutcome,
} from './exchange_prediction_snapshot.model.js';
import {
  ExchangePredictionSnapshotRepo,
  getExchangePredictionSnapshotRepo,
} from './exchange_prediction_snapshot.repo.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeEventLoggerService } from '../lifecycle/exchange_event_logger.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateSnapshotInput {
  symbol: string;
  horizon: ExchangeHorizon;
  modelId: string;
  modelVersion: number;
  retrainBatchId?: string;
  prediction: number;
  predictedClass: 'WIN' | 'LOSS';
  confidence: number;
  entryPrice: number;
  biasModifier?: number;
  biasBreakdown?: {
    fromParentHorizon?: string;
    parentBias?: number;
    weightedInfluence?: number;
    decayState?: string;
  };
}

export interface ArchiveAndCreateResult {
  newSnapshot: ExchangePredictionSnapshot;
  archivedSnapshotId: string | null;
  wasArchived: boolean;
}

export interface SnapshotTimelineEntry {
  snapshotId: string;
  symbol: string;
  horizon: ExchangeHorizon;
  prediction: number;
  predictedClass: 'WIN' | 'LOSS';
  confidence: number;
  entryPrice: number;
  entryTimestamp: Date;
  status: SnapshotStatus;
  outcome?: SnapshotOutcome;
  exitPrice?: number;
  priceChangePercent?: number;
  modelId: string;
  modelVersion: number;
  biasModifier?: number;
  createdAt: Date;
  archivedAt?: Date;
  resolvedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeSnapshotService {
  private repo: ExchangePredictionSnapshotRepo;
  
  constructor(private db: Db) {
    this.repo = getExchangePredictionSnapshotRepo(db);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CORE METHOD: ARCHIVE AND CREATE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Atomically archive the current ACTIVE snapshot and create a new one.
   * 
   * This is the PRIMARY method for recording new predictions.
   * It ensures:
   * 1. Previous ACTIVE snapshot is archived (if exists)
   * 2. New snapshot is created with ACTIVE status
   * 3. Link between old and new is maintained (previousSnapshotId)
   * 
   * NOTE: In MongoDB, we can't do true atomic multi-document transactions
   * without replica set. We use a two-step approach with careful ordering:
   * 1. Archive old (sets status=ARCHIVED, archivedAt=now)
   * 2. Create new with previousSnapshotId linking to old
   * 
   * The partial unique index ensures only one ACTIVE per symbol/horizon.
   */
  async archiveAndCreate(input: CreateSnapshotInput): Promise<ArchiveAndCreateResult> {
    const { symbol, horizon } = input;
    
    // Step 1: Archive current active (if exists)
    const archivedSnapshotId = await this.repo.archiveActiveByTarget(symbol, horizon);
    
    // Step 2: Create new snapshot
    const newSnapshot = await this.repo.create({
      symbol,
      horizon,
      modelId: input.modelId,
      modelVersion: input.modelVersion,
      retrainBatchId: input.retrainBatchId,
      prediction: input.prediction,
      predictedClass: input.predictedClass,
      confidence: input.confidence,
      entryPrice: input.entryPrice,
      entryTimestamp: new Date(),
      biasModifier: input.biasModifier,
      biasBreakdown: input.biasBreakdown,
      previousSnapshotId: archivedSnapshotId || undefined,
    });
    
    // Log event
    try {
      const eventLogger = getExchangeEventLoggerService(this.db);
      await eventLogger.log({
        type: 'EXCH_SNAPSHOT_CREATED',
        horizon,
        modelId: input.modelId,
        details: {
          snapshotId: newSnapshot.snapshotId,
          symbol,
          prediction: input.prediction,
          predictedClass: input.predictedClass,
          confidence: input.confidence,
          entryPrice: input.entryPrice,
          biasModifier: input.biasModifier,
          archivedPreviousId: archivedSnapshotId,
        },
      });
    } catch (err) {
      console.error('[SnapshotService] Failed to log event:', err);
    }
    
    return {
      newSnapshot,
      archivedSnapshotId,
      wasArchived: !!archivedSnapshotId,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // READ METHODS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get the current ACTIVE snapshot for a symbol/horizon.
   */
  async getActive(
    symbol: string,
    horizon: ExchangeHorizon
  ): Promise<ExchangePredictionSnapshot | null> {
    return this.repo.getActive(symbol, horizon);
  }
  
  /**
   * Get all ACTIVE snapshots for a horizon.
   */
  async getAllActiveByHorizon(horizon: ExchangeHorizon): Promise<ExchangePredictionSnapshot[]> {
    return this.repo.getAllActive(horizon);
  }
  
  /**
   * Get snapshot by ID.
   */
  async getById(snapshotId: string): Promise<ExchangePredictionSnapshot | null> {
    return this.repo.getById(snapshotId);
  }
  
  /**
   * Get prediction timeline for a symbol/horizon.
   * Returns simplified entries for UI display.
   */
  async getTimeline(
    symbol: string,
    horizon: ExchangeHorizon,
    limit: number = 50
  ): Promise<SnapshotTimelineEntry[]> {
    const snapshots = await this.repo.getHistory(symbol, horizon, limit);
    
    return snapshots.map(s => ({
      snapshotId: s.snapshotId,
      symbol: s.symbol,
      horizon: s.horizon,
      prediction: s.prediction,
      predictedClass: s.predictedClass,
      confidence: s.confidence,
      entryPrice: s.entryPrice,
      entryTimestamp: s.entryTimestamp,
      status: s.status,
      outcome: s.outcome,
      exitPrice: s.exitPrice,
      priceChangePercent: s.priceChangePercent,
      modelId: s.modelId,
      modelVersion: s.modelVersion,
      biasModifier: s.biasModifier,
      createdAt: s.createdAt,
      archivedAt: s.archivedAt,
      resolvedAt: s.resolvedAt,
    }));
  }
  
  /**
   * Get snapshots by horizon with filtering.
   */
  async getByHorizon(
    horizon: ExchangeHorizon,
    options: {
      status?: SnapshotStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ExchangePredictionSnapshot[]> {
    return this.repo.getByHorizon(horizon, options);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RESOLUTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Resolve a snapshot with its outcome.
   * Called by the outcome resolution scheduler.
   */
  async resolveSnapshot(
    snapshotId: string,
    exitPrice: number,
    winThresholdPct: number = 0.01
  ): Promise<{
    resolved: boolean;
    outcome?: SnapshotOutcome;
    priceChangePercent?: number;
  }> {
    const snapshot = await this.repo.getById(snapshotId);
    
    if (!snapshot) {
      return { resolved: false };
    }
    
    if (snapshot.status === 'RESOLVED') {
      return {
        resolved: true,
        outcome: snapshot.outcome,
        priceChangePercent: snapshot.priceChangePercent,
      };
    }
    
    const priceChangePercent = (exitPrice - snapshot.entryPrice) / snapshot.entryPrice;
    
    // Determine outcome based on price change
    let outcome: SnapshotOutcome;
    if (priceChangePercent >= winThresholdPct) {
      outcome = 'WIN';
    } else if (priceChangePercent <= -winThresholdPct) {
      outcome = 'LOSS';
    } else {
      outcome = 'NEUTRAL';
    }
    
    const resolved = await this.repo.resolve(snapshotId, {
      outcome,
      exitPrice,
      priceChangePercent,
    });
    
    if (resolved) {
      // Log event
      try {
        const eventLogger = getExchangeEventLoggerService(this.db);
        await eventLogger.log({
          type: 'EXCH_SNAPSHOT_RESOLVED',
          horizon: snapshot.horizon,
          modelId: snapshot.modelId,
          details: {
            snapshotId,
            symbol: snapshot.symbol,
            predictedClass: snapshot.predictedClass,
            outcome,
            entryPrice: snapshot.entryPrice,
            exitPrice,
            priceChangePercent,
            correct: (outcome === 'WIN' && snapshot.predictedClass === 'WIN') ||
                     (outcome === 'LOSS' && snapshot.predictedClass === 'LOSS'),
          },
        });
      } catch (err) {
        console.error('[SnapshotService] Failed to log resolution event:', err);
      }
    }
    
    return {
      resolved,
      outcome,
      priceChangePercent,
    };
  }
  
  /**
   * Get snapshots pending resolution.
   */
  async getPendingResolution(
    horizon: ExchangeHorizon,
    beforeTimestamp: Date,
    limit: number = 100
  ): Promise<ExchangePredictionSnapshot[]> {
    return this.repo.getPendingResolution(horizon, beforeTimestamp, limit);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get comprehensive snapshot statistics.
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<SnapshotStatus, number>;
    byHorizon: Record<ExchangeHorizon, number>;
    byOutcome: Record<string, number>;
    accuracy: {
      overall: number;
      byHorizon: Record<ExchangeHorizon, number>;
    };
    oldestActive: Date | null;
    newestActive: Date | null;
  }> {
    const repoStats = await this.repo.getStats();
    
    // Calculate accuracy from resolved snapshots
    const resolvedSnapshots = await this.repo.getByHorizon('1D', { status: 'RESOLVED', limit: 1000 });
    const resolved7D = await this.repo.getByHorizon('7D', { status: 'RESOLVED', limit: 1000 });
    const resolved30D = await this.repo.getByHorizon('30D', { status: 'RESOLVED', limit: 1000 });
    
    const calculateAccuracy = (snapshots: ExchangePredictionSnapshot[]): number => {
      if (snapshots.length === 0) return 0;
      
      let correct = 0;
      for (const s of snapshots) {
        if (s.outcome === 'NEUTRAL') continue;
        if (
          (s.outcome === 'WIN' && s.predictedClass === 'WIN') ||
          (s.outcome === 'LOSS' && s.predictedClass === 'LOSS')
        ) {
          correct++;
        }
      }
      
      const nonNeutral = snapshots.filter(s => s.outcome !== 'NEUTRAL').length;
      return nonNeutral > 0 ? correct / nonNeutral : 0;
    };
    
    const allResolved = [...resolvedSnapshots, ...resolved7D, ...resolved30D];
    
    return {
      ...repoStats,
      accuracy: {
        overall: calculateAccuracy(allResolved),
        byHorizon: {
          '1D': calculateAccuracy(resolvedSnapshots),
          '7D': calculateAccuracy(resolved7D),
          '30D': calculateAccuracy(resolved30D),
        },
      },
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Ensure indexes are created.
   */
  async ensureIndexes(): Promise<void> {
    await this.repo.ensureIndexes();
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: ExchangeSnapshotService | null = null;

export function getExchangeSnapshotService(db: Db): ExchangeSnapshotService {
  if (!serviceInstance) {
    serviceInstance = new ExchangeSnapshotService(db);
  }
  return serviceInstance;
}

console.log('[Exchange ML] Snapshot Service loaded');
