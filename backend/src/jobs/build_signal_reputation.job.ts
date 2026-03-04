/**
 * Build Signal Reputation Job (Phase 15.1)
 * 
 * Calculates reputation scores for signals based on market reactions.
 * Runs every 10 minutes.
 */
import { calculateSignalReputation, getSignalReputationStats } from '../core/reputation/signal_reputation.service.js';
import { SignalReactionModel } from '../core/signal_reactions/signal_reaction.model.js';

interface BuildSignalReputationResult {
  processed: number;
  errors: number;
  duration: number;
}

export async function buildSignalReputation(): Promise<BuildSignalReputationResult> {
  const start = Date.now();
  let processed = 0;
  let errors = 0;
  
  try {
    // Get signals that have reactions in the last 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentReactions = await SignalReactionModel.find({
      computedAt: { $gt: dayAgo },
    })
      .distinct('signalId')
      .exec();
    
    console.log(`[Build Signal Reputation] Processing ${recentReactions.length} signals`);
    
    // Process signals in batches
    for (const signalId of recentReactions.slice(0, 100)) {  // Limit to 100 per run
      try {
        await calculateSignalReputation(signalId);
        processed++;
      } catch (err) {
        console.error(`[Build Signal Reputation] Error processing signal ${signalId}:`, err);
        errors++;
      }
    }
    
    return {
      processed,
      errors,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Build Signal Reputation] Job failed:', err);
    return {
      processed,
      errors: errors + 1,
      duration: Date.now() - start,
    };
  }
}

export async function getBuildSignalReputationStatus() {
  return await getSignalReputationStats();
}
