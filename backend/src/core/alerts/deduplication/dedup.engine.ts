/**
 * Deduplication Engine (A1)
 * 
 * Purpose: "Это новое событие или повтор уже известного поведения?"
 * 
 * Responsibilities:
 * - Generate dedupKey
 * - Check time windows
 * - Track occurrence count
 * - Mark: first_seen | repeated | suppressed
 * 
 * NOT responsible for:
 * - Severity calculation (A2)
 * - Dispatch decisions (A4)
 * - Grouping (A3)
 * - UI logic
 * 
 * Architecture rule:
 * "Если хочешь изменить поведение алертов — меняешь A2 или A3, но НЕ A1"
 */
import crypto from 'crypto';
import type { NormalizedAlertEvent } from '../normalization/normalized_event.schema.js';
import type { DedupedEvent, DedupStatus } from './dedup_event.schema.js';
import { DedupEventModel } from './dedup_event.model.js';

/**
 * Time windows for deduplication (in minutes)
 * These are NOT for alerts, only for dedup
 */
const DEDUP_WINDOWS: Record<string, number> = {
  accumulation: 60,
  distribution: 60,
  smart_money_entry: 120,
  smart_money_exit: 120,
  large_move: 30,
  activity_spike: 15,
  net_flow_spike: 30,
  // Default fallback
  default: 60,
};

export class DedupEngine {
  /**
   * Main deduplication process
   * 
   * Flow:
   * 1. Generate dedupKey
   * 2. Check if exists
   * 3. If not exists → first_seen
   * 4. If exists and within window → repeated
   * 5. If exists and outside window → reset to first_seen
   */
  async process(event: NormalizedAlertEvent): Promise<DedupedEvent> {
    const dedupKey = this.generateDedupKey(event);
    const existing = await this.findDedupEvent(dedupKey);
    
    if (!existing) {
      // New event - first time seeing this behavior
      await this.saveDedupEvent(event, dedupKey, 'first_seen');
      
      return {
        normalizedEvent: event,
        dedupStatus: 'first_seen',
        occurrenceCount: 1,
        firstSeenAt: event.triggeredAt,
        dedupKey,
      };
    }
    
    // Event exists - check if within window
    const windowMinutes = this.getWindowMinutes(event.signalType);
    const isWithinWindow = this.isWithinWindow(existing.lastSeenAt, event.triggeredAt, windowMinutes);
    
    if (isWithinWindow) {
      // Repeated occurrence within window
      await this.updateDedupEvent(existing, event, 'repeated');
      
      return {
        normalizedEvent: event,
        dedupStatus: 'repeated',
        occurrenceCount: existing.count + 1,
        firstSeenAt: existing.firstSeenAt,
        dedupKey,
      };
    }
    
    // Outside window - reset to first_seen
    await this.resetDedupEvent(existing, event, 'first_seen');
    
    return {
      normalizedEvent: event,
      dedupStatus: 'first_seen',
      occurrenceCount: 1,
      firstSeenAt: event.triggeredAt,
      dedupKey,
    };
  }

  /**
   * Generate dedupKey (CRITICAL)
   * 
   * Formula:
   * dedupKey = hash(
   *   signalType +
   *   scope +
   *   targetId +
   *   direction +
   *   thresholdBucket
   * )
   * 
   * thresholdBucket: округление для избежания микрошумов
   */
  private generateDedupKey(event: NormalizedAlertEvent): string {
    const thresholdBucket = this.roundToThresholdBucket(event.metrics.threshold);
    
    const keyComponents = [
      event.signalType,
      event.scope,
      event.targetId,
      event.metrics.direction,
      thresholdBucket.toString(),
    ];
    
    const keyString = keyComponents.join('|');
    
    return crypto
      .createHash('sha256')
      .update(keyString)
      .digest('hex')
      .substring(0, 16); // Short hash for efficiency
  }

  /**
   * Round threshold to bucket to avoid micro-noise
   * 
   * Examples:
   * 1,000,000 → 1,000,000
   * 1,050,000 → 1,000,000
   * 1,500,000 → 2,000,000
   */
  private roundToThresholdBucket(threshold: number): number {
    if (threshold === 0) return 0;
    
    // Round to nearest 1,000,000 for large numbers
    if (threshold >= 1_000_000) {
      return Math.round(threshold / 1_000_000) * 1_000_000;
    }
    
    // Round to nearest 100,000 for medium numbers
    if (threshold >= 100_000) {
      return Math.round(threshold / 100_000) * 100_000;
    }
    
    // Round to nearest 10,000 for small numbers
    if (threshold >= 10_000) {
      return Math.round(threshold / 10_000) * 10_000;
    }
    
    // Round to nearest 1,000 for very small numbers
    return Math.round(threshold / 1_000) * 1_000;
  }

  /**
   * Get dedup window for signal type
   */
  private getWindowMinutes(signalType: string): number {
    return DEDUP_WINDOWS[signalType] || DEDUP_WINDOWS.default;
  }

  /**
   * Check if event is within dedup window
   */
  private isWithinWindow(lastSeenAt: Date, currentTime: Date, windowMinutes: number): boolean {
    const windowMs = windowMinutes * 60 * 1000;
    const timeDiff = currentTime.getTime() - lastSeenAt.getTime();
    
    return timeDiff <= windowMs;
  }

  /**
   * Find existing dedup event
   */
  private async findDedupEvent(dedupKey: string) {
    return await DedupEventModel.findOne({ dedupKey });
  }

  /**
   * Save new dedup event
   */
  private async saveDedupEvent(
    event: NormalizedAlertEvent,
    dedupKey: string,
    status: DedupStatus
  ): Promise<void> {
    await DedupEventModel.create({
      dedupKey,
      firstSeenAt: event.triggeredAt,
      lastSeenAt: event.triggeredAt,
      count: 1,
      status,
      lastEventId: event.eventId,
      signalType: event.signalType,
      targetId: event.targetId,
    });
  }

  /**
   * Update existing dedup event (repeated occurrence)
   */
  private async updateDedupEvent(
    existing: any,
    event: NormalizedAlertEvent,
    status: DedupStatus
  ): Promise<void> {
    existing.lastSeenAt = event.triggeredAt;
    existing.count += 1;
    existing.status = status;
    existing.lastEventId = event.eventId;
    
    await existing.save();
  }

  /**
   * Reset dedup event (outside window)
   */
  private async resetDedupEvent(
    existing: any,
    event: NormalizedAlertEvent,
    status: DedupStatus
  ): Promise<void> {
    existing.firstSeenAt = event.triggeredAt;
    existing.lastSeenAt = event.triggeredAt;
    existing.count = 1;
    existing.status = status;
    existing.lastEventId = event.eventId;
    
    await existing.save();
  }

  /**
   * Clean up old dedup events (maintenance)
   * Called periodically by background job
   */
  async cleanupOldEvents(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await DedupEventModel.deleteMany({
      lastSeenAt: { $lt: cutoffDate },
    });
    
    return result.deletedCount || 0;
  }
}

// Export singleton instance
export const dedupEngine = new DedupEngine();
