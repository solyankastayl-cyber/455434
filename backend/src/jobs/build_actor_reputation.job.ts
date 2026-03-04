/**
 * Build Actor Reputation Job (Phase 15.3)
 * 
 * Calculates reputation scores for actors.
 * Runs every 20 minutes.
 */
import {
  calculateActorReputation,
  getActorReputationStats,
} from '../core/reputation/actor_reputation.service.js';
import { SignalModel } from '../core/signals/signals.model.js';

interface BuildActorReputationResult {
  processed: number;
  errors: number;
  duration: number;
}

export async function buildActorReputation(): Promise<BuildActorReputationResult> {
  const start = Date.now();
  let processed = 0;
  let errors = 0;
  
  try {
    // Get actors with recent signals (last 48 hours)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recentActors = await SignalModel.find({
      createdAt: { $gt: twoDaysAgo },
    })
      .distinct('fromAddress')
      .exec();
    
    console.log(`[Build Actor Reputation] Processing ${recentActors.length} actors`);
    
    // Process actors in batches
    for (const address of recentActors.slice(0, 50)) {  // Limit to 50 per run
      try {
        await calculateActorReputation(address);
        processed++;
      } catch (err) {
        console.error(`[Build Actor Reputation] Error processing ${address}:`, err);
        errors++;
      }
    }
    
    return {
      processed,
      errors,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Build Actor Reputation] Job failed:', err);
    return {
      processed,
      errors: errors + 1,
      duration: Date.now() - start,
    };
  }
}

export async function getBuildActorReputationStatus() {
  return await getActorReputationStats();
}
