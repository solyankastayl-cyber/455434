/**
 * C2.1.3 — On-chain Persistence Builder
 * ======================================
 * 
 * Persist on-chain observations with snapshot + metrics.
 * 
 * RESPONSIBILITIES:
 * - Create immutable observations at t0
 * - Rate limiting (1 obs/min/symbol)
 * - Idempotency (no duplicates)
 * - Backfill support
 * 
 * INVARIANTS:
 * - On-chain does NOT initiate time (follows Exchange)
 * - NO_DATA is valid observation
 * - Observations are immutable once created
 */

import { v4 as uuidv4 } from 'uuid';
import {
  OnchainSnapshot,
  OnchainMetrics,
  OnchainObservation,
  OnchainWindow,
  ONCHAIN_THRESHOLDS,
} from './onchain.contracts.js';
import { onchainSnapshotService } from './onchain.service.js';
import { onchainMetricsEngine } from './onchain.metrics.js';
import { OnchainObservationModel, IOnchainObservationDoc } from './onchain.models.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Rate limit: 1 observation per minute per symbol
const RATE_LIMIT_MS = 60_000;

// Exceptions to rate limit
const SPIKE_THRESHOLD_WHALE = 0.8;
const SPIKE_THRESHOLD_PRESSURE = 0.5;

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class OnchainPersistenceBuilder {
  // Track last observation time per symbol
  private lastTickTime: Map<string, number> = new Map();
  private lastMetrics: Map<string, OnchainMetrics> = new Map();
  
  /**
   * Create observation for a symbol at t0
   * 
   * @param symbol - Trading symbol
   * @param t0 - Reference timestamp (from Exchange tick)
   * @param window - Aggregation window
   * @param force - Bypass rate limit
   */
  async tick(
    symbol: string,
    t0?: number,
    window: OnchainWindow = '1h',
    force: boolean = false
  ): Promise<{ ok: boolean; observation?: OnchainObservation; skipped?: string }> {
    const effectiveT0 = t0 || Date.now();
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    // Check rate limit (unless forced)
    if (!force) {
      const rateLimitResult = await this.checkRateLimit(normalizedSymbol, effectiveT0);
      if (!rateLimitResult.allowed) {
        return { ok: true, skipped: rateLimitResult.reason };
      }
    }
    
    // Check idempotency - observation exists for this t0?
    const existing = await this.findExisting(normalizedSymbol, effectiveT0, window);
    if (existing) {
      return { ok: true, observation: this.docToObservation(existing), skipped: 'already_exists' };
    }
    
    // Get snapshot
    const snapshotRes = await onchainSnapshotService.getSnapshot(normalizedSymbol, effectiveT0, window);
    if (!snapshotRes.ok || !snapshotRes.snapshot) {
      return { ok: false, skipped: 'snapshot_failed' };
    }
    
    // Calculate metrics
    const startTime = Date.now();
    const metrics = onchainMetricsEngine.calculate(snapshotRes.snapshot);
    const processingTimeMs = Date.now() - startTime;
    
    // Build observation
    const observation: OnchainObservation = {
      id: uuidv4(),
      symbol: normalizedSymbol,
      t0: effectiveT0,
      window,
      snapshot: snapshotRes.snapshot,
      metrics,
      diagnostics: {
        calculatedAt: Date.now(),
        processingTimeMs,
        provider: snapshotRes.snapshot.sourceProvider || 'mock',
        warnings: this.generateWarnings(metrics, snapshotRes.snapshot),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Persist
    await this.saveObservation(observation);
    
    // Update tracking
    this.lastTickTime.set(normalizedSymbol, effectiveT0);
    this.lastMetrics.set(normalizedSymbol, metrics);
    
    return { ok: true, observation };
  }
  
  /**
   * Backfill observations for a time range
   */
  async backfill(
    symbol: string,
    from: number,
    to: number,
    stepMs: number = 60_000,  // 1 minute steps
    window: OnchainWindow = '1h'
  ): Promise<{ ok: boolean; created: number; skipped: number }> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    let created = 0;
    let skipped = 0;
    
    for (let t0 = from; t0 <= to; t0 += stepMs) {
      const result = await this.tick(normalizedSymbol, t0, window, true);
      
      if (result.observation && !result.skipped) {
        created++;
      } else {
        skipped++;
      }
    }
    
    return { ok: true, created, skipped };
  }
  
  /**
   * Get latest observation for a symbol
   */
  async getLatest(
    symbol: string,
    window: OnchainWindow = '1h'
  ): Promise<OnchainObservation | null> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const doc = await OnchainObservationModel.findOne(
      { symbol: normalizedSymbol, window },
      {},
      { sort: { t0: -1 } }
    );
    
    return doc ? this.docToObservation(doc) : null;
  }
  
  /**
   * Get observation at specific t0
   */
  async getAt(
    symbol: string,
    t0: number,
    window: OnchainWindow = '1h'
  ): Promise<OnchainObservation | null> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const tolerance = 30_000;  // 30 second tolerance
    const doc = await OnchainObservationModel.findOne({
      symbol: normalizedSymbol,
      window,
      t0: { $gte: t0 - tolerance, $lte: t0 + tolerance },
    });
    
    return doc ? this.docToObservation(doc) : null;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Check rate limit for symbol
   */
  private async checkRateLimit(
    symbol: string,
    t0: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    const lastTick = this.lastTickTime.get(symbol) || 0;
    const elapsed = t0 - lastTick;
    
    // Basic rate limit
    if (elapsed < RATE_LIMIT_MS) {
      // Check for spike exceptions
      const lastMetrics = this.lastMetrics.get(symbol);
      if (lastMetrics) {
        // Exception: whale activity spike
        if (lastMetrics.whaleActivity > SPIKE_THRESHOLD_WHALE) {
          return { allowed: true };
        }
        // Exception: exchange pressure change
        // (would need current metrics to compare, so skip for now)
      }
      
      return { allowed: false, reason: 'rate_limited' };
    }
    
    return { allowed: true };
  }
  
  /**
   * Find existing observation
   */
  private async findExisting(
    symbol: string,
    t0: number,
    window: OnchainWindow
  ): Promise<IOnchainObservationDoc | null> {
    // Idempotency key: floor(t0 / 60s)
    const bucket = Math.floor(t0 / 60_000) * 60_000;
    const tolerance = 30_000;
    
    return OnchainObservationModel.findOne({
      symbol,
      window,
      t0: { $gte: bucket - tolerance, $lte: bucket + tolerance },
    });
  }
  
  /**
   * Save observation to MongoDB
   */
  private async saveObservation(observation: OnchainObservation): Promise<void> {
    try {
      await OnchainObservationModel.create(observation);
    } catch (error) {
      // Ignore duplicate key errors
      if ((error as any).code !== 11000) {
        throw error;
      }
    }
  }
  
  /**
   * Generate warnings for observation
   */
  private generateWarnings(metrics: OnchainMetrics, snapshot: OnchainSnapshot): string[] {
    const warnings: string[] = [];
    
    if (metrics.confidence < ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE) {
      warnings.push('Low confidence - observation may not be usable for validation');
    }
    
    if (snapshot.source === 'mock') {
      warnings.push('Mock data source - not suitable for production validation');
    }
    
    if (metrics.dataCompleteness < 0.5) {
      warnings.push(`Data incomplete: ${Math.round(metrics.dataCompleteness * 100)}%`);
    }
    
    return warnings;
  }
  
  /**
   * Convert MongoDB doc to OnchainObservation
   */
  private docToObservation(doc: IOnchainObservationDoc): OnchainObservation {
    return {
      id: doc.id,
      symbol: doc.symbol,
      t0: doc.t0,
      window: doc.window,
      snapshot: doc.snapshot as OnchainSnapshot,
      metrics: doc.metrics as OnchainMetrics,
      diagnostics: doc.diagnostics as OnchainObservation['diagnostics'],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}

export const onchainPersistenceBuilder = new OnchainPersistenceBuilder();

console.log('[C2.1.3] OnchainPersistenceBuilder loaded');
