/**
 * Build Signal Reactions Job (Phase 14B.2)
 * 
 * Processes signals and computes market reactions.
 * Updates signal confidence based on actual market movement.
 */
import { SignalModel } from '../core/signals/signals.model.js';
import { SignalReactionModel, ReactionWindow } from '../core/signal_reactions/signal_reaction.model.js';
import { computeSignalReaction, updateSignalConfidence } from '../core/signal_reactions/signal_reaction.service.js';

let lastRunAt: Date | null = null;
let lastResult = {
  signalsProcessed: 0,
  reactionsComputed: 0,
  confidenceUpdates: 0,
  errors: 0,
  duration: 0,
};

const WINDOWS: ReactionWindow[] = ['5m', '15m', '1h', '4h'];

export async function buildSignalReactions(): Promise<typeof lastResult> {
  const start = Date.now();
  
  let signalsProcessed = 0;
  let reactionsComputed = 0;
  let confidenceUpdates = 0;
  let errors = 0;
  
  // Get signals from the last 24h that need reaction computation
  const signals = await SignalModel.find({
    triggeredAt: { 
      $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      $lte: new Date(Date.now() - 5 * 60 * 1000), // At least 5 min old
    },
  }).sort({ triggeredAt: -1 }).limit(100);
  
  for (const signal of signals) {
    signalsProcessed++;
    
    // Compute reactions for each window
    for (const window of WINDOWS) {
      // Check if we already have this reaction
      const existing = await SignalReactionModel.findOne({
        signalId: signal._id,
        reactionWindow: window,
      });
      
      if (existing) continue; // Already computed
      
      try {
        const reaction = await computeSignalReaction(signal, window);
        if (reaction) {
          reactionsComputed++;
        }
      } catch (err) {
        console.error(`[Build Reactions] Failed for signal ${signal._id} window ${window}:`, err);
        errors++;
      }
    }
    
    // Update signal confidence after computing reactions
    try {
      const result = await updateSignalConfidence(signal._id.toString());
      if (result && Math.abs(result.totalImpact) > 0.01) {
        confidenceUpdates++;
      }
    } catch (err) {
      console.error(`[Build Reactions] Failed to update confidence for ${signal._id}:`, err);
      errors++;
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    signalsProcessed,
    reactionsComputed,
    confidenceUpdates,
    errors,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getBuildSignalReactionsStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
