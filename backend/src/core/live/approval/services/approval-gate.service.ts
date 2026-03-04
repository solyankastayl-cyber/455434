/**
 * Approval Gate Service
 * 
 * Main service for processing aggregates through the Approval Gate.
 * 
 * READS: LiveAggregateWindow
 * WRITES: LiveFactApproved, LiveApprovalCursor
 * 
 * NO imports from Ranking / Engine / ML.
 */
import { LiveAggregateWindowModel, type WindowSize } from '../../models/live_aggregate_window.model.js';
import { LiveFactApprovedModel } from '../models/live_fact_approved.model.js';
import { LiveApprovalCursorModel } from '../models/live_approval_cursor.model.js';
import { evaluateWindow } from './approval-rules.engine.js';
import type { WindowData, ApprovalResult, ApprovalStatus } from '../approval.types.js';
import { CANARY_TOKENS, CHAIN_CONFIG } from '../../live_ingestion.types.js';
import { WINDOWS } from '../../services/window_calculator.js';

// ==================== TYPES ====================

export interface ApprovalProcessResult {
  token: string;
  window: WindowSize;
  processed: number;
  approved: number;
  quarantined: number;
  rejected: number;
  skipped: number;
  durationMs: number;
}

export interface ApprovalStats {
  totalFacts: number;
  approved: number;
  quarantined: number;
  rejected: number;
  approvalRate: number;
  lastApprovalAt: Date | null;
  cursorStatus: Array<{
    token: string;
    window: WindowSize;
    lastWindowEnd: Date;
  }>;
}

// ==================== CURSOR MANAGEMENT ====================

async function getCursor(
  tokenAddress: string,
  window: WindowSize
): Promise<Date | null> {
  const cursor = await LiveApprovalCursorModel.findOne({
    tokenAddress: tokenAddress.toLowerCase(),
    window,
  });
  
  return cursor?.lastApprovedWindowEnd ?? null;
}

async function updateCursor(
  tokenAddress: string,
  window: WindowSize,
  lastWindowEnd: Date
): Promise<void> {
  await LiveApprovalCursorModel.findOneAndUpdate(
    {
      tokenAddress: tokenAddress.toLowerCase(),
      window,
    },
    {
      $set: {
        lastApprovedWindowEnd: lastWindowEnd,
        lastProcessedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// ==================== CONVERT AGGREGATE TO WINDOW DATA ====================

function aggregateToWindowData(aggregate: any): WindowData {
  return {
    token: aggregate.tokenAddress,
    window: aggregate.window,
    windowStart: aggregate.windowStart,
    windowEnd: aggregate.windowEnd,
    eventCount: aggregate.eventCount,
    inflowCount: aggregate.inflowCount,
    outflowCount: aggregate.outflowCount,
    inflowAmount: aggregate.inflowAmount,
    outflowAmount: aggregate.outflowAmount,
    netFlowAmount: aggregate.netFlowAmount,
    uniqueSenders: aggregate.uniqueSenders,
    uniqueReceivers: aggregate.uniqueReceivers,
    firstBlock: aggregate.firstBlock,
    lastBlock: aggregate.lastBlock,
  };
}

// ==================== CHECK IF ALREADY PROCESSED ====================

async function isAlreadyProcessed(
  tokenAddress: string,
  window: WindowSize,
  windowStart: Date
): Promise<boolean> {
  const existing = await LiveFactApprovedModel.findOne({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    windowStart,
  });
  
  return !!existing;
}

// ==================== CREATE APPROVED FACT ====================

async function createApprovedFact(
  aggregate: any,
  result: ApprovalResult,
  tokenSymbol: string
): Promise<void> {
  await LiveFactApprovedModel.create({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: aggregate.tokenAddress.toLowerCase(),
    tokenSymbol,
    window: aggregate.window,
    windowStart: aggregate.windowStart,
    windowEnd: aggregate.windowEnd,
    metrics: {
      eventCount: aggregate.eventCount,
      volumeIn: aggregate.inflowAmount,
      volumeOut: aggregate.outflowAmount,
      netFlow: aggregate.netFlowAmount,
      uniqueSenders: aggregate.uniqueSenders,
      uniqueReceivers: aggregate.uniqueReceivers,
      firstBlock: aggregate.firstBlock,
      lastBlock: aggregate.lastBlock,
    },
    approval: {
      status: result.status,
      score: result.score,
      failedRules: result.failedRules,
    },
    sourceAggregateId: aggregate._id?.toString(),
    approvedAt: new Date(),
  });
}

// ==================== PROCESS TOKEN ====================

/**
 * Process all pending aggregates for a token/window
 */
export async function processToken(
  tokenAddress: string,
  tokenSymbol: string,
  window: WindowSize
): Promise<ApprovalProcessResult> {
  const startTime = Date.now();
  
  // Get cursor
  const cursorDate = await getCursor(tokenAddress, window);
  
  // Find aggregates to process
  const query: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
  };
  
  if (cursorDate) {
    query.windowEnd = { $gt: cursorDate };
  }
  
  const aggregates = await LiveAggregateWindowModel.find(query)
    .sort({ windowStart: 1 })
    .lean();
  
  if (aggregates.length === 0) {
    return {
      token: tokenSymbol,
      window,
      processed: 0,
      approved: 0,
      quarantined: 0,
      rejected: 0,
      skipped: 0,
      durationMs: Date.now() - startTime,
    };
  }
  
  // Get previous aggregate for continuity checking
  let previousAggregate: any = null;
  if (cursorDate) {
    previousAggregate = await LiveAggregateWindowModel.findOne({
      chainId: CHAIN_CONFIG.CHAIN_ID,
      tokenAddress: tokenAddress.toLowerCase(),
      window,
      windowEnd: { $lte: cursorDate },
    })
      .sort({ windowEnd: -1 })
      .lean();
  }
  
  // Process each aggregate
  let approved = 0;
  let quarantined = 0;
  let rejected = 0;
  let skipped = 0;
  let lastWindowEnd = cursorDate;
  
  for (const aggregate of aggregates) {
    // Check idempotency
    const alreadyProcessed = await isAlreadyProcessed(
      tokenAddress,
      window,
      aggregate.windowStart
    );
    
    if (alreadyProcessed) {
      skipped++;
      continue;
    }
    
    // Convert to WindowData
    const currentWindow = aggregateToWindowData(aggregate);
    const previousWindow = previousAggregate 
      ? aggregateToWindowData(previousAggregate)
      : undefined;
    
    // Evaluate
    const result = evaluateWindow(currentWindow, previousWindow);
    
    // Create fact
    await createApprovedFact(aggregate, result, tokenSymbol);
    
    // Track counts
    switch (result.status) {
      case 'APPROVED':
        approved++;
        break;
      case 'QUARANTINED':
        quarantined++;
        break;
      case 'REJECTED':
        rejected++;
        break;
    }
    
    // Update for next iteration
    previousAggregate = aggregate;
    lastWindowEnd = aggregate.windowEnd;
  }
  
  // Update cursor
  if (lastWindowEnd) {
    await updateCursor(tokenAddress, window, lastWindowEnd);
  }
  
  return {
    token: tokenSymbol,
    window,
    processed: aggregates.length,
    approved,
    quarantined,
    rejected,
    skipped,
    durationMs: Date.now() - startTime,
  };
}

// ==================== PROCESS ALL ====================

/**
 * Process all tokens and windows
 */
export async function processAll(): Promise<{
  results: ApprovalProcessResult[];
  totals: {
    processed: number;
    approved: number;
    quarantined: number;
    rejected: number;
  };
  durationMs: number;
}> {
  const startTime = Date.now();
  const results: ApprovalProcessResult[] = [];
  
  let totalProcessed = 0;
  let totalApproved = 0;
  let totalQuarantined = 0;
  let totalRejected = 0;
  
  // Sequential processing
  for (const token of CANARY_TOKENS) {
    for (const window of WINDOWS) {
      const result = await processToken(token.address, token.symbol, window);
      results.push(result);
      
      totalProcessed += result.processed;
      totalApproved += result.approved;
      totalQuarantined += result.quarantined;
      totalRejected += result.rejected;
    }
  }
  
  return {
    results,
    totals: {
      processed: totalProcessed,
      approved: totalApproved,
      quarantined: totalQuarantined,
      rejected: totalRejected,
    },
    durationMs: Date.now() - startTime,
  };
}

// ==================== STATS ====================

/**
 * Get approval statistics
 */
export async function getApprovalStats(): Promise<ApprovalStats> {
  const [
    totalFacts,
    approved,
    quarantined,
    rejected,
    latestFact,
    cursors,
  ] = await Promise.all([
    LiveFactApprovedModel.countDocuments(),
    LiveFactApprovedModel.countDocuments({ 'approval.status': 'APPROVED' }),
    LiveFactApprovedModel.countDocuments({ 'approval.status': 'QUARANTINED' }),
    LiveFactApprovedModel.countDocuments({ 'approval.status': 'REJECTED' }),
    LiveFactApprovedModel.findOne().sort({ approvedAt: -1 }).lean(),
    LiveApprovalCursorModel.find().lean(),
  ]);
  
  const approvalRate = totalFacts > 0 ? approved / totalFacts : 0;
  
  return {
    totalFacts,
    approved,
    quarantined,
    rejected,
    approvalRate,
    lastApprovalAt: latestFact?.approvedAt ?? null,
    cursorStatus: cursors.map(c => ({
      token: CANARY_TOKENS.find(t => 
        t.address.toLowerCase() === c.tokenAddress.toLowerCase()
      )?.symbol || c.tokenAddress.slice(0, 10),
      window: c.window as WindowSize,
      lastWindowEnd: c.lastApprovedWindowEnd,
    })),
  };
}

// ==================== GET APPROVED FACTS ====================

/**
 * Get approved facts only (for Drift / ML)
 */
export async function getApprovedFacts(params: {
  tokenAddress?: string;
  window?: WindowSize;
  limit?: number;
}): Promise<any[]> {
  const filter: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
    'approval.status': 'APPROVED',
  };
  
  if (params.tokenAddress) {
    filter.tokenAddress = params.tokenAddress.toLowerCase();
  }
  
  if (params.window) {
    filter.window = params.window;
  }
  
  const limit = Math.min(params.limit || 50, 100);
  
  const facts = await LiveFactApprovedModel.find(filter)
    .sort({ windowEnd: -1 })
    .limit(limit)
    .select('-__v')
    .lean();
  
  return facts.map(f => ({
    ...f,
    _id: undefined,
  }));
}

/**
 * Get all facts (including quarantined/rejected) for debugging
 */
export async function getAllFacts(params: {
  tokenAddress?: string;
  window?: WindowSize;
  status?: ApprovalStatus;
  limit?: number;
}): Promise<any[]> {
  const filter: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
  };
  
  if (params.tokenAddress) {
    filter.tokenAddress = params.tokenAddress.toLowerCase();
  }
  
  if (params.window) {
    filter.window = params.window;
  }
  
  if (params.status) {
    filter['approval.status'] = params.status;
  }
  
  const limit = Math.min(params.limit || 50, 100);
  
  const facts = await LiveFactApprovedModel.find(filter)
    .sort({ windowEnd: -1 })
    .limit(limit)
    .select('-__v')
    .lean();
  
  return facts.map(f => ({
    ...f,
    _id: undefined,
  }));
}
