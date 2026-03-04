/**
 * Update User Bias Job (Phase 12B)
 * 
 * Runs every 15 minutes to update user bias based on outcomes.
 */
import { UserSignalOutcomeModel } from '../core/personalized/user_signal_outcomes.model.js';
import { updateBiasFromOutcome } from '../core/personalized/personalized.service.js';

let lastRunAt: Date | null = null;
let lastResult = {
  outcomesProcessed: 0,
  biasUpdates: 0,
  duration: 0,
};

export async function updateUserBias(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Find outcomes that haven't been used for bias learning
  const pendingOutcomes = await UserSignalOutcomeModel.find({
    outcome: { $ne: 'pending' },
    wasCorrectDecision: { $exists: true },
    learningWeight: { $gt: 0 },
  }).limit(100);
  
  let biasUpdates = 0;
  
  for (const outcome of pendingOutcomes) {
    try {
      await updateBiasFromOutcome(outcome.userId, outcome);
      biasUpdates++;
      
      // Mark as processed by setting learning weight to 0
      outcome.learningWeight = 0;
      await outcome.save();
    } catch (err) {
      console.error(`[Update User Bias] Failed for outcome ${outcome._id}:`, err);
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    outcomesProcessed: pendingOutcomes.length,
    biasUpdates,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getUpdateUserBiasStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
