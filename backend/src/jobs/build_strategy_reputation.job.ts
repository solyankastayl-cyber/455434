/**
 * Build Strategy Reputation Job (Phase 15.2)
 * 
 * Calculates reputation scores for strategies.
 * Runs every 15 minutes.
 */
import {
  calculateStrategyReputation,
  getStrategyReputationStats,
} from '../core/reputation/strategy_reputation.service.js';
import { STRATEGY_TYPES, StrategyType } from '../core/strategies/strategy_profiles.model.js';

interface BuildStrategyReputationResult {
  processed: number;
  errors: number;
  duration: number;
}

export async function buildStrategyReputation(): Promise<BuildStrategyReputationResult> {
  const start = Date.now();
  let processed = 0;
  let errors = 0;
  
  try {
    console.log(`[Build Strategy Reputation] Processing ${STRATEGY_TYPES.length} strategy types`);
    
    // Process all strategy types
    for (const strategyType of STRATEGY_TYPES) {
      try {
        await calculateStrategyReputation(strategyType as StrategyType);
        processed++;
      } catch (err) {
        console.error(`[Build Strategy Reputation] Error processing ${strategyType}:`, err);
        errors++;
      }
    }
    
    return {
      processed,
      errors,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Build Strategy Reputation] Job failed:', err);
    return {
      processed,
      errors: errors + 1,
      duration: Date.now() - start,
    };
  }
}

export async function getBuildStrategyReputationStatus() {
  return await getStrategyReputationStats();
}
