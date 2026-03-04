/**
 * Dispatch Follow Events Job
 * 
 * Processes new strategy signals and dispatches them to followers.
 * Runs every 30-60 seconds.
 * 
 * Input: strategy_signals (new)
 * Output: follow_events
 */
import { StrategySignalModel, IStrategySignal } from '../core/strategy_signals/strategy_signals.model.js';
import { dispatchStrategySignal } from '../core/follows/follows.service.js';
import { FollowEventModel } from '../core/follows/follow_events.model.js';

let lastProcessedId: string | null = null;
let lastRunTime: Date | null = null;

export interface DispatchFollowEventsResult {
  processedSignals: number;
  eventsDispatched: number;
  duration: number;
}

/**
 * Dispatch follow events from new signals
 */
export async function dispatchFollowEvents(): Promise<DispatchFollowEventsResult> {
  const startTime = Date.now();
  let processedSignals = 0;
  let eventsDispatched = 0;
  
  try {
    // Get new strategy signals since last run
    const query: Record<string, unknown> = {};
    if (lastRunTime) {
      query.createdAt = { $gt: lastRunTime };
    }
    
    const signals = await StrategySignalModel
      .find(query)
      .sort({ createdAt: 1 })
      .limit(100) // Process in batches
      .lean();
    
    if (signals.length === 0) {
      lastRunTime = new Date();
      return { processedSignals: 0, eventsDispatched: 0, duration: Date.now() - startTime };
    }
    
    // Process each signal
    for (const signal of signals) {
      try {
        const dispatched = await dispatchStrategySignal(signal as IStrategySignal);
        eventsDispatched += dispatched;
        processedSignals++;
      } catch (err) {
        console.error(`[Dispatch Follow Events] Error dispatching signal ${signal._id}:`, err);
      }
    }
    
    // Update last run time to latest signal time
    if (signals.length > 0) {
      const lastSignal = signals[signals.length - 1];
      lastRunTime = new Date(lastSignal.createdAt);
    }
    
  } catch (err) {
    console.error('[Dispatch Follow Events] Job failed:', err);
  }
  
  return {
    processedSignals,
    eventsDispatched,
    duration: Date.now() - startTime,
  };
}

/**
 * Get job status
 */
export async function getDispatchFollowEventsStatus(): Promise<{
  totalEvents: number;
  last24h: number;
  unread: number;
  lastRun: string | null;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [total, last24h, unread] = await Promise.all([
    FollowEventModel.countDocuments(),
    FollowEventModel.countDocuments({ createdAt: { $gte: yesterday } }),
    FollowEventModel.countDocuments({ readAt: null }),
  ]);
  
  return {
    totalEvents: total,
    last24h,
    unread,
    lastRun: lastRunTime?.toISOString() || null,
  };
}
