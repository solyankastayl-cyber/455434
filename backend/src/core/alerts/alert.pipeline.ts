/**
 * Smart Alerts Pipeline (A0 → A1 → A2 → A3 → A4)
 * 
 * Unified pipeline that processes raw signals through all layers:
 * - A0: Event Normalization
 * - A1: Deduplication
 * - A2: Severity & Priority
 * - A3: Grouping
 * - A4: Dispatch
 * 
 * Usage:
 *   const result = await alertPipeline.process(rawSignal, ruleId, userId);
 */
import { eventNormalizer } from './normalization/event.normalizer.js';
import { dedupEngine } from './deduplication/dedup.engine.js';
import { severityEngine } from './severity/severity.engine.js';
import { groupingEngine } from './grouping/grouping.engine.js';
import { dispatcherEngine } from './dispatcher/dispatcher.engine.js';

import type { NormalizedAlertEvent } from './normalization/normalized_event.schema.js';
import type { DedupedEvent } from './deduplication/dedup_event.schema.js';
import type { ScoredEvent } from './severity/scored_event.schema.js';
import type { GroupedEvent } from './grouping/alert_group.schema.js';
import type { DispatchDecision, DispatchPayload } from './dispatcher/dispatcher.schema.js';

/**
 * Pipeline Result
 */
export interface PipelineResult {
  // Layer outputs
  normalized: NormalizedAlertEvent;
  deduped: DedupedEvent;
  scored: ScoredEvent;
  grouped: GroupedEvent;
  
  // Dispatch result
  dispatch: {
    decision: DispatchDecision;
    payload?: DispatchPayload;
    delivered?: Record<string, boolean>;
  };
  
  // Summary
  summary: {
    wasNewGroup: boolean;
    wasEscalation: boolean;
    wasNotified: boolean;
    notificationChannels?: string[];
    groupId: string;
    groupStatus: string;
  };
}

export class AlertPipeline {
  /**
   * Process a raw signal through the entire pipeline
   */
  async process(
    rawSignal: any,
    ruleId: string,
    userId: string
  ): Promise<PipelineResult> {
    // A0: Normalize
    const normalized = await eventNormalizer.normalize(rawSignal, ruleId, userId);
    
    // A1: Deduplicate
    const deduped = await dedupEngine.process(normalized);
    
    // A2: Score
    const scored = severityEngine.score(deduped);
    
    // A3: Group
    const grouped = await groupingEngine.process(scored);
    
    // A4: Dispatch
    const dispatch = await dispatcherEngine.process(grouped);
    
    return {
      normalized,
      deduped,
      scored,
      grouped,
      dispatch,
      summary: {
        wasNewGroup: grouped.isNewGroup,
        wasEscalation: grouped.isEscalation,
        wasNotified: dispatch.decision.shouldDispatch,
        notificationChannels: dispatch.decision.channels,
        groupId: grouped.group.groupId,
        groupStatus: grouped.group.status,
      },
    };
  }

  /**
   * Process multiple signals in batch
   */
  async processBatch(
    signals: Array<{ signal: any; ruleId: string; userId: string }>
  ): Promise<PipelineResult[]> {
    const results: PipelineResult[] = [];
    
    for (const { signal, ruleId, userId } of signals) {
      try {
        const result = await this.process(signal, ruleId, userId);
        results.push(result);
      } catch (error) {
        console.error('[AlertPipeline] Failed to process signal:', error);
        // Continue with next signal
      }
    }
    
    return results;
  }

  /**
   * Run maintenance tasks
   */
  async runMaintenance(): Promise<{
    dedupEventsCleared: number;
    groupsTransitioned: { cooling: number; resolved: number };
    oldGroupsCleared: number;
    oldNotificationsCleared: number;
  }> {
    // Clean old dedup events
    const dedupEventsCleared = await dedupEngine.cleanupOldEvents(7);
    
    // Run lifecycle check on groups
    const groupsTransitioned = await groupingEngine.runLifecycleCheck();
    
    // Clean old resolved groups
    const oldGroupsCleared = await groupingEngine.cleanupOldGroups(30);
    
    // Clean old notifications
    const oldNotificationsCleared = await dispatcherEngine.cleanupOldNotifications(30);
    
    return {
      dedupEventsCleared,
      groupsTransitioned: {
        cooling: groupsTransitioned.transitionedToCooling,
        resolved: groupsTransitioned.transitionedToResolved,
      },
      oldGroupsCleared,
      oldNotificationsCleared,
    };
  }
}

// Export singleton instance
export const alertPipeline = new AlertPipeline();
