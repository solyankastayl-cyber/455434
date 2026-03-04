/**
 * Severity Engine (A2)
 * 
 * Purpose: "Насколько это событие важно для пользователя прямо сейчас?"
 * 
 * Responsibilities:
 * - Calculate severityScore (composite)
 * - Assign priority bucket (high/medium/low)
 * - Generate human-readable reason
 * 
 * Formula:
 * severityScore = 
 *   magnitudeScore * confidenceMultiplier * noveltyMultiplier + persistenceBonus
 * 
 * NOT responsible for:
 * - Grouping (A3)
 * - Lifecycle (A3)
 * - Dispatch (A4)
 * 
 * Architecture rule:
 * "A2 — последний слой, где мы считаем 'важность'"
 */
import type { DedupedEvent } from '../deduplication/dedup_event.schema.js';
import type { NormalizedAlertEvent } from '../normalization/normalized_event.schema.js';
import type { ScoredEvent, PriorityBucket, SeverityReason } from './scored_event.schema.js';

export class SeverityEngine {
  /**
   * Main severity calculation
   * 
   * Flow:
   * 1. Calculate magnitude score
   * 2. Calculate confidence multiplier
   * 3. Calculate novelty multiplier (depends on dedupStatus)
   * 4. Calculate persistence bonus (depends on occurrenceCount)
   * 5. Combine into final severity score
   * 6. Assign priority bucket
   * 7. Generate human-readable reason
   */
  score(dedupedEvent: DedupedEvent): ScoredEvent {
    const event = dedupedEvent.normalizedEvent;
    
    // 1. Magnitude Score (насколько сильно)
    const magnitudeScore = this.calculateMagnitudeScore(event);
    
    // 2. Confidence Multiplier (насколько надёжно)
    const confidenceMultiplier = this.calculateConfidenceMultiplier(event.confidence);
    
    // 3. Novelty Multiplier (впервые или повтор)
    const noveltyMultiplier = this.calculateNoveltyMultiplier(dedupedEvent.dedupStatus);
    
    // 4. Persistence Bonus (длительность поведения)
    const persistenceBonus = this.calculatePersistenceBonus(dedupedEvent.occurrenceCount);
    
    // 5. Final Severity Score
    let severityScore = 
      magnitudeScore *
      confidenceMultiplier *
      noveltyMultiplier +
      persistenceBonus;
    
    // Clamp to [0, 5]
    severityScore = this.clamp(severityScore, 0, 5);
    
    // 6. Priority Bucket
    const priority = this.assignPriorityBucket(severityScore);
    
    // 7. Human-readable Reason
    const reason = this.generateReason(
      event,
      dedupedEvent,
      magnitudeScore,
      confidenceMultiplier,
      severityScore,
      priority
    );
    
    return {
      normalizedEvent: event,
      dedupStatus: dedupedEvent.dedupStatus,
      occurrenceCount: dedupedEvent.occurrenceCount,
      dedupKey: dedupedEvent.dedupKey,
      
      severityScore,
      priority,
      reason,
      
      scoreComponents: {
        magnitudeScore,
        confidenceMultiplier,
        noveltyMultiplier,
        persistenceBonus,
      },
    };
  }

  /**
   * 1. Magnitude Score (основа)
   * 
   * Formula: clamp(log10(value / baseline), 0, 3)
   * 
   * Examples:
   * value = baseline      → log10(1) = 0.0  → magnitude = 0.0
   * value = 2x baseline   → log10(2) = 0.3  → magnitude = 0.3
   * value = 10x baseline  → log10(10) = 1.0 → magnitude = 1.0
   * value = 100x baseline → log10(100) = 2.0 → magnitude = 2.0
   * value = 1000x baseline → log10(1000) = 3.0 → magnitude = 3.0 (capped)
   */
  private calculateMagnitudeScore(event: NormalizedAlertEvent): number {
    const { value, baseline } = event.metrics;
    
    if (baseline === 0 || value === 0) {
      return 0;
    }
    
    const ratio = value / baseline;
    
    // log10 of ratio
    const logScore = Math.log10(ratio);
    
    // Clamp to [0, 3]
    return this.clamp(logScore, 0, 3);
  }

  /**
   * 2. Confidence Multiplier (надёжность)
   * 
   * Formula: 0.5 + (confidence * 0.5)
   * 
   * Examples:
   * confidence = 0.0 → multiplier = 0.5
   * confidence = 0.5 → multiplier = 0.75
   * confidence = 1.0 → multiplier = 1.0
   * 
   * This ensures low confidence events have reduced severity
   */
  private calculateConfidenceMultiplier(confidence: number): number {
    return 0.5 + (confidence * 0.5);
  }

  /**
   * 3. Novelty Multiplier (A1 dependency)
   * 
   * Formula:
   * first_seen  → 1.2 (boost new events)
   * repeated    → 1.0 (neutral)
   * suppressed  → 0.6 (reduce noise)
   */
  private calculateNoveltyMultiplier(dedupStatus: string): number {
    switch (dedupStatus) {
      case 'first_seen':
        return 1.2; // Boost new behaviors
      case 'repeated':
        return 1.0; // Neutral
      case 'suppressed':
        return 0.6; // Reduce suppressed events
      default:
        return 1.0;
    }
  }

  /**
   * 4. Persistence Bonus (sustained behavior)
   * 
   * Formula:
   * count >= 5 → +0.5
   * count >= 3 → +0.3
   * count < 3  → 0
   * 
   * This rewards sustained behaviors
   */
  private calculatePersistenceBonus(occurrenceCount: number): number {
    if (occurrenceCount >= 5) {
      return 0.5;
    } else if (occurrenceCount >= 3) {
      return 0.3;
    }
    return 0;
  }

  /**
   * Assign Priority Bucket
   * 
   * Severity ≥ 3.5 → high
   * Severity ≥ 2.0 → medium
   * Severity < 2.0 → low
   */
  private assignPriorityBucket(severityScore: number): PriorityBucket {
    if (severityScore >= 3.5) {
      return 'high';
    } else if (severityScore >= 2.0) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Generate Human-Readable Reason (CRITICAL)
   * 
   * This goes directly to:
   * - UI (InsightBlock)
   * - Telegram
   * - AlertsPage
   * 
   * Must be readable by user, not developer
   */
  private generateReason(
    event: NormalizedAlertEvent,
    dedupedEvent: DedupedEvent,
    magnitudeScore: number,
    confidenceMultiplier: number,
    severityScore: number,
    priority: PriorityBucket
  ): SeverityReason {
    const { signalType, metrics, targetMeta } = event;
    const { occurrenceCount, dedupStatus } = dedupedEvent;
    
    // Summary (1 line, human language)
    const summary = this.generateSummary(signalType, targetMeta, dedupStatus, occurrenceCount);
    
    // Details (2-4 bullet points)
    const details: string[] = [];
    
    // 1. Magnitude detail
    const deviationPercent = Math.round(metrics.deviation);
    if (deviationPercent > 0) {
      const comparison = metrics.value > metrics.baseline ? 'above' : 'below';
      details.push(`Activity is ${Math.abs(deviationPercent)}% ${comparison} normal baseline`);
    }
    
    // 2. Persistence detail (if repeated)
    if (occurrenceCount > 1) {
      details.push(`Observed ${occurrenceCount} times, showing sustained behavior`);
    }
    
    // 3. Confidence detail
    const confidenceLabel = event.confidence >= 0.8 ? 'High' : 
                           event.confidence >= 0.6 ? 'Moderate' : 'Limited';
    details.push(`Data confidence: ${confidenceLabel} (${Math.round(event.confidence * 100)}%)`);
    
    // 4. Priority context
    if (priority === 'high') {
      details.push('Immediate attention recommended');
    } else if (priority === 'medium') {
      details.push('Notable activity worth monitoring');
    }
    
    return {
      summary,
      details,
    };
  }

  /**
   * Generate summary sentence
   */
  private generateSummary(
    signalType: string,
    targetMeta: any,
    dedupStatus: string,
    occurrenceCount: number
  ): string {
    const asset = targetMeta?.symbol || 'this asset';
    
    const summaryMap: Record<string, string> = {
      accumulation: `Large wallets are consistently accumulating ${asset}`,
      distribution: `Holders are distributing ${asset} to the market`,
      large_move: `Significant movement of ${asset} detected`,
      smart_money_entry: `Historically profitable wallets are entering ${asset}`,
      smart_money_exit: `Historically profitable wallets are exiting ${asset}`,
      net_flow_spike: `Unusual flow activity detected for ${asset}`,
      activity_spike: `Transaction activity spiking for ${asset}`,
    };
    
    let summary = summaryMap[signalType] || `Notable on-chain behavior for ${asset}`;
    
    // Add persistence context if repeated
    if (occurrenceCount >= 3 && dedupStatus === 'repeated') {
      summary += ' (sustained pattern)';
    }
    
    return summary;
  }

  /**
   * Utility: clamp value between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

// Export singleton instance
export const severityEngine = new SeverityEngine();
