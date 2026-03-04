/**
 * PHASE 5.1 — Outcome Job
 * ========================
 * Processes pending decisions and calculates their outcomes
 */

import { v4 as uuidv4 } from 'uuid';
import {
  OutcomeJobResult,
  OutcomeJobRequest,
  MIN_HORIZON_MS,
  MAX_PENDING_AGE_MS,
} from '../contracts/outcome.types.js';
import { DecisionOutcomeModel } from '../storage/outcome.model.js';
import { DecisionRecordModel } from '../../finalDecision/storage/decision.storage.js';
import { buildOutcome, shouldSkipDecision, isReadyForCalculation } from '../services/outcome.builder.js';

/**
 * Find decisions that need outcome calculation
 */
async function findPendingDecisions(
  request: OutcomeJobRequest
): Promise<any[]> {
  const now = Date.now();
  const minTimestamp = now - MAX_PENDING_AGE_MS;
  const maxTimestamp = now - MIN_HORIZON_MS; // At least 1h old
  
  const query: any = {
    timestamp: { 
      $gte: minTimestamp, 
      $lte: maxTimestamp 
    },
  };
  
  // Filter by symbol if specified
  if (request.symbol) {
    query.symbol = request.symbol;
  }
  
  // Find decisions that don't have outcomes yet (or need recalc)
  const existingOutcomeIds = await DecisionOutcomeModel
    .find(request.forceRecalc ? {} : { status: { $in: ['CALCULATED', 'SKIPPED'] } })
    .distinct('decisionId');
  
  if (!request.forceRecalc && existingOutcomeIds.length > 0) {
    query._id = { $nin: existingOutcomeIds.map(id => id) };
  }
  
  const decisions = await DecisionRecordModel
    .find(query)
    .sort({ timestamp: -1 })
    .limit(request.limit || 100)
    .lean();
  
  return decisions;
}

/**
 * Process a single decision and create/update its outcome
 */
async function processDecision(
  decision: any
): Promise<{ status: 'calculated' | 'skipped' | 'error'; error?: string }> {
  try {
    // Check if should skip
    const skipCheck = shouldSkipDecision(decision);
    if (skipCheck.skip) {
      // Create skipped outcome record
      await DecisionOutcomeModel.findOneAndUpdate(
        { decisionId: decision._id.toString() },
        {
          $set: {
            decisionId: decision._id.toString(),
            symbol: decision.symbol,
            decisionTimestamp: decision.timestamp,
            action: decision.action,
            confidence: decision.confidence,
            verdict: decision.explainability?.verdict || 'NEUTRAL',
            priceAtDecision: 0,
            horizons: [],
            status: 'SKIPPED',
            errorMessage: skipCheck.reason,
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      return { status: 'skipped' };
    }
    
    // Check if ready for calculation
    if (!isReadyForCalculation(decision.timestamp)) {
      return { status: 'skipped' };
    }
    
    // Build outcome
    const outcome = await buildOutcome(decision);
    
    // Save or update outcome
    await DecisionOutcomeModel.findOneAndUpdate(
      { decisionId: outcome.decisionId },
      {
        $set: {
          ...outcome,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    
    return { status: outcome.status === 'CALCULATED' ? 'calculated' : 'skipped' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Record error in outcome
    try {
      await DecisionOutcomeModel.findOneAndUpdate(
        { decisionId: decision._id.toString() },
        {
          $set: {
            decisionId: decision._id.toString(),
            symbol: decision.symbol,
            decisionTimestamp: decision.timestamp,
            action: decision.action,
            confidence: decision.confidence || 0,
            verdict: decision.explainability?.verdict || 'NEUTRAL',
            priceAtDecision: 0,
            horizons: [],
            status: 'ERROR',
            errorMessage,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (saveError) {
      // Ignore save errors
    }
    
    return { status: 'error', error: errorMessage };
  }
}

/**
 * Run outcome calculation job
 */
export async function runOutcomeJob(
  request: OutcomeJobRequest = {}
): Promise<OutcomeJobResult> {
  const runId = uuidv4();
  const startedAt = Date.now();
  
  console.log(`[OutcomeJob] Starting job ${runId}`, request);
  
  const result: OutcomeJobResult = {
    runId,
    startedAt,
    completedAt: 0,
    decisions: {
      pending: 0,
      processed: 0,
      calculated: 0,
      skipped: 0,
      errors: 0,
    },
    errors: [],
  };
  
  try {
    // Find pending decisions
    const decisions = await findPendingDecisions(request);
    result.decisions.pending = decisions.length;
    
    console.log(`[OutcomeJob] Found ${decisions.length} decisions to process`);
    
    // Process each decision
    for (const decision of decisions) {
      const processResult = await processDecision(decision);
      result.decisions.processed++;
      
      switch (processResult.status) {
        case 'calculated':
          result.decisions.calculated++;
          break;
        case 'skipped':
          result.decisions.skipped++;
          break;
        case 'error':
          result.decisions.errors++;
          result.errors.push({
            decisionId: decision._id.toString(),
            error: processResult.error || 'Unknown error',
          });
          break;
      }
    }
    
    result.completedAt = Date.now();
    
    console.log(`[OutcomeJob] Completed job ${runId}:`, {
      duration: result.completedAt - startedAt,
      calculated: result.decisions.calculated,
      skipped: result.decisions.skipped,
      errors: result.decisions.errors,
    });
    
  } catch (error) {
    result.completedAt = Date.now();
    result.errors.push({
      decisionId: 'JOB_ERROR',
      error: error instanceof Error ? error.message : 'Unknown job error',
    });
    console.error(`[OutcomeJob] Job ${runId} failed:`, error);
  }
  
  return result;
}

/**
 * Get outcome statistics
 */
export async function getOutcomeStats(
  symbol?: string,
  period: '24h' | '7d' | '30d' | 'all' = '7d'
): Promise<any> {
  const periodMs: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    'all': Infinity,
  };
  
  const minTimestamp = period === 'all' 
    ? 0 
    : Date.now() - periodMs[period];
  
  const match: any = {
    decisionTimestamp: { $gte: minTimestamp },
  };
  
  if (symbol) {
    match.symbol = symbol;
  }
  
  const stats = await DecisionOutcomeModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        calculated: { $sum: { $cond: [{ $eq: ['$status', 'CALCULATED'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
        skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
        errors: { $sum: { $cond: [{ $eq: ['$status', 'ERROR'] }, 1, 0] } },
        correct: { $sum: { $cond: ['$directionCorrect', 1, 0] } },
        avgPnl: { $avg: '$bestPnlPct' },
      },
    },
  ]);
  
  if (stats.length === 0) {
    return {
      symbol: symbol || 'ALL',
      period,
      total: 0,
      calculated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      accuracy: null,
      avgPnl: null,
      generatedAt: Date.now(),
    };
  }
  
  const s = stats[0];
  
  return {
    symbol: symbol || 'ALL',
    period,
    total: s.total,
    calculated: s.calculated,
    pending: s.pending,
    skipped: s.skipped,
    errors: s.errors,
    accuracy: s.calculated > 0 ? s.correct / s.calculated : null,
    avgPnl: s.avgPnl,
    generatedAt: Date.now(),
  };
}

console.log('[Phase 5.1] Outcome Job loaded');
