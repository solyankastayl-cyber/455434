/**
 * Timelines Service
 */
import * as repo from './timelines.repository.js';
import { IStrategyTimelineEvent, StrategyTimelineEventType } from './strategy_timeline.model.js';
import { ISignalTimelineEvent } from './signal_timeline.model.js';
import { IBundleTimelineEvent } from './bundle_timeline.model.js';

/**
 * Combined timeline entry for unified view
 */
export interface UnifiedTimelineEntry {
  type: 'strategy' | 'signal' | 'bundle';
  timestamp: Date;
  title: string;
  description: string;
  severity?: number;
  confidence?: number;
  data: IStrategyTimelineEvent | ISignalTimelineEvent | IBundleTimelineEvent;
  // Priority weight for consistent ordering
  priorityWeight: number;
}

/**
 * Event type priority weights
 * Higher = more important, shown first when same timestamp
 * 
 * strategy_shift > alert_signal > other_signal > bundle
 */
const EVENT_TYPE_WEIGHTS: Record<string, number> = {
  // Strategy events (highest priority)
  'strategy_shift': 100,
  'strategy_confirmed': 90,
  'strategy_detected': 85,
  'strategy_phase_change': 80,
  'confidence_change': 70,
  'stability_change': 65,
  
  // Signal events (medium-high priority)
  'strategy_risk_spike': 75,
  'strategy_intensity_spike': 70,
  'strategy_influence_jump': 68,
  'intensity_spike': 60,
  'new_corridor': 55,
  'accumulation_start': 50,
  'distribution_start': 50,
  
  // Bundle events (lower priority)
  'bundle_started': 30,
  'bundle_intensified': 28,
  'bundle_peaked': 35,
  'bundle_completed': 25,
  'bundle_broken': 40,
};

/**
 * Get priority weight for event
 */
function getEventWeight(type: string, eventType?: string): number {
  // Check specific event type first
  if (eventType && EVENT_TYPE_WEIGHTS[eventType]) {
    return EVENT_TYPE_WEIGHTS[eventType];
  }
  
  // Fall back to general type weight
  const typeWeights: Record<string, number> = {
    'strategy': 80,
    'signal': 50,
    'bundle': 30,
  };
  
  return typeWeights[type] || 20;
}

/**
 * Get strategy timeline
 */
export async function getStrategyTimeline(
  address: string,
  limit: number = 50
): Promise<IStrategyTimelineEvent[]> {
  return repo.getStrategyTimeline(address, limit);
}

/**
 * Get signal timeline
 */
export async function getSignalTimeline(
  address: string,
  limit: number = 50
): Promise<ISignalTimelineEvent[]> {
  return repo.getSignalTimeline(address, limit);
}

/**
 * Get bundle timeline
 */
export async function getBundleTimeline(
  address: string,
  limit: number = 50
): Promise<IBundleTimelineEvent[]> {
  return repo.getBundleTimeline(address, limit);
}

/**
 * Get unified timeline (all events merged and sorted)
 * 
 * Sorting: timestamp DESC, then by priority weight DESC
 * This ensures strategy_shift > alert > signal > bundle when same time
 */
export async function getUnifiedTimeline(
  address: string,
  limit: number = 50
): Promise<UnifiedTimelineEntry[]> {
  // Fetch all timelines in parallel
  const [strategyEvents, signalEvents, bundleEvents] = await Promise.all([
    repo.getStrategyTimeline(address, limit),
    repo.getSignalTimeline(address, limit),
    repo.getBundleTimeline(address, limit),
  ]);
  
  // Convert to unified format with priority weights
  const unified: UnifiedTimelineEntry[] = [];
  
  for (const event of strategyEvents) {
    const weight = getEventWeight('strategy', event.eventType);
    unified.push({
      type: 'strategy',
      timestamp: event.timestamp,
      title: `Strategy: ${event.eventType.replace(/_/g, ' ')}`,
      description: event.reason,
      confidence: event.confidence,
      data: event,
      priorityWeight: weight,
    });
  }
  
  for (const event of signalEvents) {
    const weight = getEventWeight('signal', event.signalType);
    unified.push({
      type: 'signal',
      timestamp: event.timestamp,
      title: event.title,
      description: event.description,
      severity: event.severity,
      confidence: event.confidence,
      data: event,
      priorityWeight: weight,
    });
  }
  
  for (const event of bundleEvents) {
    const weight = getEventWeight('bundle', `bundle_${event.phase}`);
    unified.push({
      type: 'bundle',
      timestamp: event.timestamp,
      title: `Bundle: ${event.bundleType} (${event.phase})`,
      description: event.description,
      confidence: event.confidence,
      data: event,
      priorityWeight: weight,
    });
  }
  
  // Sort by timestamp descending, then by priority weight descending
  // This ensures important events appear first when timestamps are close
  unified.sort((a, b) => {
    const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
    
    // If timestamps are within 1 second, sort by priority
    if (Math.abs(timeDiff) < 1000) {
      return b.priorityWeight - a.priorityWeight;
    }
    
    return timeDiff;
  });
  
  // Limit
  return unified.slice(0, limit);
}

/**
 * Record strategy timeline event
 */
export async function recordStrategyEvent(
  input: repo.CreateStrategyTimelineInput
): Promise<IStrategyTimelineEvent> {
  return repo.createStrategyTimelineEvent(input);
}

/**
 * Record signal timeline event
 */
export async function recordSignalEvent(
  input: repo.CreateSignalTimelineInput
): Promise<ISignalTimelineEvent> {
  return repo.createSignalTimelineEvent(input);
}

/**
 * Record bundle timeline event
 */
export async function recordBundleEvent(
  input: repo.CreateBundleTimelineInput
): Promise<IBundleTimelineEvent> {
  return repo.createBundleTimelineEvent(input);
}
