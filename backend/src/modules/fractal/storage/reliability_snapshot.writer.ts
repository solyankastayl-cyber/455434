/**
 * BLOCK 43.2 — Reliability Snapshot Writer Service
 * Writes snapshots after certification, MC, rolling validation
 */

import { 
  FractalReliabilitySnapshotModel, 
  ReliabilityBadge,
  IReliabilityComponents,
  IReliabilityMetrics,
  IReliabilityContext
} from './models/fractal_reliability_snapshot.model.js';
import { FractalEntropyHistoryModel } from './models/fractal_entropy_history.model.js';

export interface ReliabilitySnapshotInput {
  ts: number;
  modelKey: string;
  presetKey: string;
  badge: ReliabilityBadge;
  reliabilityScore: number;
  components: IReliabilityComponents;
  metrics?: IReliabilityMetrics;
  context?: IReliabilityContext;
}

export interface EntropyTickInput {
  ts: number;
  modelKey: string;
  presetKey: string;
  entropy: number;
  emaEntropy: number;
  sizeMultiplier: number;
  dominance?: number;
  horizons?: Record<string, any>;
}

const SCORE_CHANGE_THRESHOLD = 0.03; // Only write if score changed > 3%
const MIN_WRITE_INTERVAL_MS = 60_000; // Min 1 minute between writes

export class ReliabilitySnapshotWriter {
  private lastWriteTs: Map<string, number> = new Map();
  private lastScore: Map<string, number> = new Map();

  /**
   * Write reliability snapshot with deduplication
   */
  async write(input: ReliabilitySnapshotInput): Promise<{ written: boolean; reason?: string }> {
    const key = `${input.modelKey}:${input.presetKey}`;
    const now = Date.now();

    // Check rate limiting
    const lastTs = this.lastWriteTs.get(key) || 0;
    if (now - lastTs < MIN_WRITE_INTERVAL_MS) {
      return { written: false, reason: 'RATE_LIMITED' };
    }

    // Check score change threshold (skip if no significant change)
    const lastScoreVal = this.lastScore.get(key);
    if (lastScoreVal !== undefined) {
      const scoreDiff = Math.abs(input.reliabilityScore - lastScoreVal);
      if (scoreDiff < SCORE_CHANGE_THRESHOLD) {
        return { written: false, reason: 'NO_SIGNIFICANT_CHANGE' };
      }
    }

    try {
      await FractalReliabilitySnapshotModel.create({
        ts: input.ts,
        modelKey: input.modelKey,
        presetKey: input.presetKey,
        badge: input.badge,
        reliabilityScore: input.reliabilityScore,
        components: input.components,
        metrics: input.metrics,
        context: input.context,
      });

      // Update tracking
      this.lastWriteTs.set(key, now);
      this.lastScore.set(key, input.reliabilityScore);

      console.log(`[ReliabilityWriter] Snapshot written: ${key} badge=${input.badge} score=${input.reliabilityScore.toFixed(3)}`);
      return { written: true };
    } catch (err) {
      console.error('[ReliabilityWriter] Write failed:', err);
      return { written: false, reason: 'DB_ERROR' };
    }
  }

  /**
   * Force write snapshot (bypass deduplication)
   */
  async forceWrite(input: ReliabilitySnapshotInput): Promise<{ written: boolean }> {
    try {
      await FractalReliabilitySnapshotModel.create({
        ts: input.ts,
        modelKey: input.modelKey,
        presetKey: input.presetKey,
        badge: input.badge,
        reliabilityScore: input.reliabilityScore,
        components: input.components,
        metrics: input.metrics,
        context: input.context,
      });
      
      const key = `${input.modelKey}:${input.presetKey}`;
      this.lastWriteTs.set(key, Date.now());
      this.lastScore.set(key, input.reliabilityScore);
      
      return { written: true };
    } catch (err) {
      console.error('[ReliabilityWriter] Force write failed:', err);
      return { written: false };
    }
  }

  /**
   * Write entropy tick
   */
  async writeEntropyTick(input: EntropyTickInput): Promise<{ written: boolean }> {
    try {
      await FractalEntropyHistoryModel.create({
        ts: input.ts,
        modelKey: input.modelKey,
        presetKey: input.presetKey,
        entropy: input.entropy,
        emaEntropy: input.emaEntropy,
        sizeMultiplier: input.sizeMultiplier,
        dominance: input.dominance,
        horizons: input.horizons,
      });
      return { written: true };
    } catch (err) {
      console.error('[ReliabilityWriter] Entropy tick failed:', err);
      return { written: false };
    }
  }

  /**
   * Get latest snapshot for modelKey/presetKey
   */
  async getLatest(modelKey: string, presetKey: string) {
    return FractalReliabilitySnapshotModel
      .findOne({ modelKey, presetKey })
      .sort({ ts: -1 })
      .lean();
  }

  /**
   * Get snapshot history
   */
  async getHistory(modelKey: string, presetKey: string, limit = 100) {
    return FractalReliabilitySnapshotModel
      .find({ modelKey, presetKey })
      .sort({ ts: -1 })
      .limit(limit)
      .lean();
  }
}

// Singleton instance
export const reliabilitySnapshotWriter = new ReliabilitySnapshotWriter();
