/**
 * ML Signal Validation Job - ML v2.1 STEP 1
 * 
 * Cron job that validates pending ML signals.
 * Runs every 15 minutes.
 */

import mongoose from 'mongoose';
import { evaluateAndSaveSignal } from '../core/ml/validation/validation.service.js';
import { SignalOutcomeModel } from '../core/ml/validation/signal_outcome.model.js';

// ============================================
// CONFIG
// ============================================

const BATCH_SIZE = 100;
const HORIZONS = ['4h'] as const; // Default horizon for validation
const MIN_AGE_HOURS = 4; // Minimum signal age before validation

// ============================================
// JOB
// ============================================

/**
 * Get pending signals that need validation
 */
async function getPendingSignals(limit: number = BATCH_SIZE) {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database not connected');
  }
  
  // Get already evaluated signal IDs
  const evaluatedIds = await SignalOutcomeModel.distinct('signalId');
  
  // Find signals from ml_inference_log that haven't been evaluated
  const minAge = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000;
  
  const signals = await db.collection('ml_inference_log')
    .find({
      signalId: { $nin: evaluatedIds },
      timestamp: { $lt: new Date(minAge) },
      type: 'market',
    })
    .sort({ timestamp: 1 })
    .limit(limit)
    .toArray();
  
  return signals.map((s: any) => ({
    _id: s._id.toString(),
    signalId: s.signalId || s._id.toString(),
    network: s.network,
    asset: s.asset || 'ETH',
    predictedSide: s.prediction?.side || s.side || 'NEUTRAL',
    score: s.prediction?.score || s.score || 0,
    confidence: s.prediction?.confidence || s.confidence || 0,
    modelVersion: s.modelVersion || 'v2.0.0',
    timestamp: s.timestamp,
  }));
}

/**
 * Main validation job
 */
export async function runValidationJob(): Promise<{
  processed: number;
  correct: number;
  wrong: number;
  skipped: number;
}> {
  console.log('[ValidationJob] Starting signal validation...');
  
  const stats = {
    processed: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
  };
  
  try {
    const signals = await getPendingSignals(BATCH_SIZE);
    
    if (signals.length === 0) {
      console.log('[ValidationJob] No pending signals to validate');
      return stats;
    }
    
    console.log(`[ValidationJob] Processing ${signals.length} signals...`);
    
    for (const signal of signals) {
      try {
        const result = await evaluateAndSaveSignal(signal, '4h');
        
        if (result) {
          stats.processed++;
          
          if (result.outcome === 'CORRECT') stats.correct++;
          else if (result.outcome === 'WRONG') stats.wrong++;
          else stats.skipped++;
        }
      } catch (err: any) {
        console.error(`[ValidationJob] Error processing ${signal.signalId}:`, err.message);
      }
    }
    
    console.log(`[ValidationJob] Complete. Processed: ${stats.processed}, Correct: ${stats.correct}, Wrong: ${stats.wrong}, Skipped: ${stats.skipped}`);
    
  } catch (err: any) {
    console.error('[ValidationJob] Job failed:', err.message);
  }
  
  return stats;
}

/**
 * Manual trigger for admin
 */
export async function triggerValidation(
  network?: string,
  limit: number = 50
): Promise<{ processed: number; results: any[] }> {
  const results: any[] = [];
  
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database not connected');
  }
  
  const query: any = {
    type: 'market',
    timestamp: { $lt: new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000) },
  };
  if (network) query.network = network;
  
  // Get already evaluated
  const evaluatedIds = await SignalOutcomeModel.distinct('signalId');
  query.signalId = { $nin: evaluatedIds };
  
  const signals = await db.collection('ml_inference_log')
    .find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  
  for (const signal of signals) {
    const mapped = {
      _id: signal._id.toString(),
      signalId: signal.signalId || signal._id.toString(),
      network: signal.network,
      asset: signal.asset || 'ETH',
      predictedSide: signal.prediction?.side || signal.side || 'NEUTRAL',
      score: signal.prediction?.score || signal.score || 0,
      confidence: signal.prediction?.confidence || signal.confidence || 0,
      modelVersion: signal.modelVersion || 'v2.0.0',
      timestamp: signal.timestamp,
    };
    
    const result = await evaluateAndSaveSignal(mapped, '4h');
    if (result) {
      results.push({
        signalId: result.signalId,
        outcome: result.outcome,
        reason: result.reason,
        actualReturnPct: result.actualReturnPct,
      });
    }
  }
  
  return { processed: results.length, results };
}

export default {
  runValidationJob,
  triggerValidation,
};
