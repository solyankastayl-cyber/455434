/**
 * Live Aggregation Service
 * 
 * Core LI-3 service: transforms RAW events into time-window aggregates.
 * 
 * RESPONSIBILITIES:
 * - Read from LiveEventRaw
 * - Compute aggregates per (token, window, windowStart)
 * - Write to LiveAggregateWindow
 * - Track progress via LiveAggregationCursor
 * 
 * PROHIBITED:
 * - thresholds, confidence, approval, drift
 * - BUY/SELL signals
 * - ML features
 * - Engine/Ranking imports
 */

import { LiveEventRawModel } from '../live_event_raw.model.js';
import { LiveAggregateWindowModel, type WindowSize } from '../models/live_aggregate_window.model.js';
import { LiveAggregationCursorModel } from '../models/live_aggregation_cursor.model.js';
import {
  WINDOWS,
  WINDOW_DURATIONS_MS,
  getClosedWindows,
  getSafeTime,
  formatWindow,
} from './window_calculator.js';
import { CANARY_TOKENS, CHAIN_CONFIG } from '../live_ingestion.types.js';

// ==================== TYPES ====================

export interface AggregationResult {
  token: string;
  window: WindowSize;
  windowsProcessed: number;
  windowsCreated: number;
  windowsSkipped: number;
  eventsProcessed: number;
  durationMs: number;
}

export interface AggregationStats {
  totalAggregates: number;
  aggregatesLast24h: number;
  lastAggregationAt: Date | null;
  cursors: Array<{
    token: string;
    window: WindowSize;
    lastWindowEnd: Date;
  }>;
}

// ==================== AGGREGATION CURSOR ====================

/**
 * Get aggregation cursor for a token/window
 */
async function getCursor(
  tokenAddress: string,
  window: WindowSize
): Promise<{ lastWindowEnd: Date; lastProcessedBlock: number } | null> {
  const cursor = await LiveAggregationCursorModel.findOne({
    tokenAddress: tokenAddress.toLowerCase(),
    window,
  });
  
  if (!cursor) return null;
  
  return {
    lastWindowEnd: cursor.lastWindowEnd,
    lastProcessedBlock: cursor.lastProcessedBlock,
  };
}

/**
 * Update aggregation cursor
 */
async function updateCursor(
  tokenAddress: string,
  window: WindowSize,
  lastWindowEnd: Date,
  lastProcessedBlock: number
): Promise<void> {
  await LiveAggregationCursorModel.findOneAndUpdate(
    {
      tokenAddress: tokenAddress.toLowerCase(),
      window,
    },
    {
      $set: {
        lastWindowEnd,
        lastProcessedBlock,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// ==================== RAW DATA ACCESS ====================

/**
 * Get RAW events for a time window
 */
async function getRawEventsForWindow(
  tokenAddress: string,
  windowStart: Date,
  windowEnd: Date
): Promise<Array<{
  from: string;
  to: string;
  amount: string;
  blockNumber: number;
}>> {
  const events = await LiveEventRawModel.find({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    timestamp: {
      $gte: windowStart,
      $lt: windowEnd,
    },
  }).select('from to amount blockNumber').lean();
  
  return events;
}

// ==================== AGGREGATE COMPUTATION (PURE MATH) ====================

/**
 * Compute aggregate from RAW events
 * 
 * Pure function - no side effects
 */
function computeAggregate(
  events: Array<{ from: string; to: string; amount: string; blockNumber: number }>
): {
  inflowCount: number;
  outflowCount: number;
  inflowAmount: bigint;
  outflowAmount: bigint;
  uniqueSenders: number;
  uniqueReceivers: number;
  eventCount: number;
  firstBlock: number;
  lastBlock: number;
} {
  const senders = new Set<string>();
  const receivers = new Set<string>();
  
  let inflowAmount = BigInt(0);
  let outflowAmount = BigInt(0);
  let inflowCount = 0;
  let outflowCount = 0;
  let firstBlock = Infinity;
  let lastBlock = 0;
  
  for (const event of events) {
    // Track unique actors
    senders.add(event.from.toLowerCase());
    receivers.add(event.to.toLowerCase());
    
    // Parse amount (hex string)
    let amount = BigInt(0);
    try {
      if (event.amount && event.amount !== '0x') {
        amount = BigInt(event.amount);
      }
    } catch {
      // Invalid amount, skip
    }
    
    // Count as both inflow and outflow (transfer is both)
    // For now, we count all transfers as events
    // Later LI-4 can classify by actor type
    inflowCount++;
    outflowCount++;
    inflowAmount += amount;
    outflowAmount += amount;
    
    // Block tracking
    if (event.blockNumber < firstBlock) firstBlock = event.blockNumber;
    if (event.blockNumber > lastBlock) lastBlock = event.blockNumber;
  }
  
  return {
    inflowCount,
    outflowCount,
    inflowAmount,
    outflowAmount,
    uniqueSenders: senders.size,
    uniqueReceivers: receivers.size,
    eventCount: events.length,
    firstBlock: firstBlock === Infinity ? 0 : firstBlock,
    lastBlock,
  };
}

// ==================== MAIN AGGREGATION ====================

/**
 * Aggregate a single window for a token
 * 
 * Idempotent: skips if aggregate already exists
 */
async function aggregateSingleWindow(
  tokenAddress: string,
  window: WindowSize,
  windowStart: Date,
  windowEnd: Date
): Promise<{ created: boolean; eventsProcessed: number }> {
  // Check if aggregate already exists
  const existing = await LiveAggregateWindowModel.findOne({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    windowStart,
  });
  
  if (existing) {
    return { created: false, eventsProcessed: 0 };
  }
  
  // Get RAW events
  const events = await getRawEventsForWindow(tokenAddress, windowStart, windowEnd);
  
  // Compute aggregate (pure math)
  const agg = computeAggregate(events);
  
  // Create aggregate document
  await LiveAggregateWindowModel.create({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    windowStart,
    windowEnd,
    inflowCount: agg.inflowCount,
    outflowCount: agg.outflowCount,
    inflowAmount: agg.inflowAmount.toString(),
    outflowAmount: agg.outflowAmount.toString(),
    netFlowAmount: (agg.inflowAmount - agg.outflowAmount).toString(),
    uniqueSenders: agg.uniqueSenders,
    uniqueReceivers: agg.uniqueReceivers,
    eventCount: agg.eventCount,
    firstBlock: agg.firstBlock,
    lastBlock: agg.lastBlock,
    computedAt: new Date(),
  });
  
  return { created: true, eventsProcessed: events.length };
}

/**
 * Aggregate all closed windows for a token/window size
 */
export async function aggregateToken(
  tokenAddress: string,
  window: WindowSize
): Promise<AggregationResult> {
  const startTime = Date.now();
  const token = CANARY_TOKENS.find(t => 
    t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  const tokenSymbol = token?.symbol || tokenAddress.slice(0, 10);
  
  // Get cursor
  const cursor = await getCursor(tokenAddress, window);
  
  // Determine start time for finding closed windows
  let fromTime: Date;
  if (cursor) {
    fromTime = cursor.lastWindowEnd;
  } else {
    // No cursor - start from 24h ago or earliest RAW event
    const earliest = await LiveEventRawModel.findOne({
      chainId: CHAIN_CONFIG.CHAIN_ID,
      tokenAddress: tokenAddress.toLowerCase(),
    }).sort({ timestamp: 1 }).select('timestamp').lean();
    
    if (!earliest) {
      // No RAW events for this token
      return {
        token: tokenSymbol,
        window,
        windowsProcessed: 0,
        windowsCreated: 0,
        windowsSkipped: 0,
        eventsProcessed: 0,
        durationMs: Date.now() - startTime,
      };
    }
    
    fromTime = earliest.timestamp;
  }
  
  // Get safe time (now - confirmations buffer)
  const safeTime = getSafeTime(new Date());
  
  // Get all closed windows to process
  const closedWindows = getClosedWindows(fromTime, safeTime, window);
  
  if (closedWindows.length === 0) {
    return {
      token: tokenSymbol,
      window,
      windowsProcessed: 0,
      windowsCreated: 0,
      windowsSkipped: 0,
      eventsProcessed: 0,
      durationMs: Date.now() - startTime,
    };
  }
  
  // Process each window
  let windowsCreated = 0;
  let windowsSkipped = 0;
  let totalEvents = 0;
  let lastWindowEnd = fromTime;
  let lastBlock = cursor?.lastProcessedBlock || 0;
  
  for (const win of closedWindows) {
    const result = await aggregateSingleWindow(
      tokenAddress,
      window,
      win.start,
      win.end
    );
    
    if (result.created) {
      windowsCreated++;
      totalEvents += result.eventsProcessed;
    } else {
      windowsSkipped++;
    }
    
    lastWindowEnd = win.end;
  }
  
  // Update cursor
  if (closedWindows.length > 0) {
    // Get last block from RAW events
    const lastEvent = await LiveEventRawModel.findOne({
      chainId: CHAIN_CONFIG.CHAIN_ID,
      tokenAddress: tokenAddress.toLowerCase(),
      timestamp: { $lt: lastWindowEnd },
    }).sort({ blockNumber: -1 }).select('blockNumber').lean();
    
    lastBlock = lastEvent?.blockNumber || lastBlock;
    
    await updateCursor(tokenAddress, window, lastWindowEnd, lastBlock);
  }
  
  return {
    token: tokenSymbol,
    window,
    windowsProcessed: closedWindows.length,
    windowsCreated,
    windowsSkipped,
    eventsProcessed: totalEvents,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Aggregate all windows for all canary tokens
 */
export async function aggregateAll(): Promise<{
  results: AggregationResult[];
  totalWindowsCreated: number;
  totalEventsProcessed: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  const results: AggregationResult[] = [];
  let totalWindowsCreated = 0;
  let totalEventsProcessed = 0;
  
  // Sequential processing (v1: no parallelism)
  for (const token of CANARY_TOKENS) {
    for (const window of WINDOWS) {
      const result = await aggregateToken(token.address, window);
      results.push(result);
      totalWindowsCreated += result.windowsCreated;
      totalEventsProcessed += result.eventsProcessed;
    }
  }
  
  return {
    results,
    totalWindowsCreated,
    totalEventsProcessed,
    durationMs: Date.now() - startTime,
  };
}

// ==================== STATS ====================

/**
 * Get aggregation statistics
 */
export async function getAggregationStats(): Promise<AggregationStats> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const [totalAggregates, aggregatesLast24h, latestAggregate, cursors] = await Promise.all([
    LiveAggregateWindowModel.countDocuments(),
    LiveAggregateWindowModel.countDocuments({
      computedAt: { $gte: twentyFourHoursAgo },
    }),
    LiveAggregateWindowModel.findOne().sort({ computedAt: -1 }).lean(),
    LiveAggregationCursorModel.find().lean(),
  ]);
  
  return {
    totalAggregates,
    aggregatesLast24h,
    lastAggregationAt: latestAggregate?.computedAt || null,
    cursors: cursors.map(c => ({
      token: CANARY_TOKENS.find(t => 
        t.address.toLowerCase() === c.tokenAddress.toLowerCase()
      )?.symbol || c.tokenAddress.slice(0, 10),
      window: c.window as WindowSize,
      lastWindowEnd: c.lastWindowEnd,
    })),
  };
}

// ==================== READ AGGREGATES ====================

/**
 * Get aggregates for a token
 */
export async function getAggregates(params: {
  tokenAddress?: string;
  window?: WindowSize;
  limit?: number;
}): Promise<Array<{
  token: string;
  window: WindowSize;
  windowStart: Date;
  windowEnd: Date;
  eventCount: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  inflowCount: number;
  outflowCount: number;
  computedAt: Date;
}>> {
  const filter: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
  };
  
  if (params.tokenAddress) {
    filter.tokenAddress = params.tokenAddress.toLowerCase();
  }
  
  if (params.window) {
    filter.window = params.window;
  }
  
  const limit = Math.min(params.limit || 50, 100);
  
  const aggregates = await LiveAggregateWindowModel.find(filter)
    .sort({ windowEnd: -1 })
    .limit(limit)
    .lean();
  
  return aggregates.map(a => ({
    token: CANARY_TOKENS.find(t => 
      t.address.toLowerCase() === a.tokenAddress.toLowerCase()
    )?.symbol || a.tokenAddress.slice(0, 10),
    window: a.window as WindowSize,
    windowStart: a.windowStart,
    windowEnd: a.windowEnd,
    eventCount: a.eventCount,
    uniqueSenders: a.uniqueSenders,
    uniqueReceivers: a.uniqueReceivers,
    inflowCount: a.inflowCount,
    outflowCount: a.outflowCount,
    computedAt: a.computedAt,
  }));
}

/**
 * Get latest aggregate per token per window
 */
export async function getLatestAggregates(): Promise<Array<{
  token: string;
  window: WindowSize;
  windowStart: Date;
  windowEnd: Date;
  eventCount: number;
  computedAt: Date;
}>> {
  const results = [];
  
  for (const token of CANARY_TOKENS) {
    for (const window of WINDOWS) {
      const latest = await LiveAggregateWindowModel.findOne({
        chainId: CHAIN_CONFIG.CHAIN_ID,
        tokenAddress: token.address.toLowerCase(),
        window,
      })
        .sort({ windowEnd: -1 })
        .lean();
      
      if (latest) {
        results.push({
          token: token.symbol,
          window,
          windowStart: latest.windowStart,
          windowEnd: latest.windowEnd,
          eventCount: latest.eventCount,
          computedAt: latest.computedAt,
        });
      }
    }
  }
  
  return results;
}
