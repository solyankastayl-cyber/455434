/**
 * Update Strategy Reliability Job (Phase 12A.4)
 * 
 * Processes completed simulations to update strategy reliability scores.
 * Identifies strategies that are becoming more or less reliable.
 * Runs every 60 minutes.
 */
import { SimulationModel } from '../core/simulations/simulations.model.js';
import {
  processSimulationForReliability,
  recalculateAllStrategyReliabilities,
} from '../core/adaptive/adaptive.service.js';
import {
  getReliabilityStats,
  getStrategiesWithWarnings,
  getCopyRecommended,
} from '../core/adaptive/strategy_reliability.repository.js';

interface UpdateReliabilityResult {
  simulationsProcessed: number;
  strategiesUpdated: number;
  strategiesWithWarnings: number;
  copyRecommended: number;
  warnings: string[];
  duration: number;
}

// Track last processed simulation
let lastProcessedSimulationAt = new Date(0);

/**
 * Update strategy reliability based on simulation outcomes
 */
export async function updateStrategyReliability(): Promise<UpdateReliabilityResult> {
  const start = Date.now();
  let simulationsProcessed = 0;
  const warnings: string[] = [];
  
  try {
    // Get completed simulations since last run
    const newSimulations = await SimulationModel
      .find({
        status: 'completed',
        updatedAt: { $gt: lastProcessedSimulationAt },
      })
      .sort({ updatedAt: 1 })
      .limit(200)
      .lean();
    
    for (const simulation of newSimulations) {
      try {
        const processed = await processSimulationForReliability(simulation._id.toString());
        if (processed) simulationsProcessed++;
      } catch (err) {
        console.error(`[Strategy Reliability] Error processing simulation ${simulation._id}:`, err);
      }
    }
    
    // Update last processed timestamp
    if (newSimulations.length > 0) {
      lastProcessedSimulationAt = new Date(newSimulations[newSimulations.length - 1].updatedAt);
    }
    
    // Recalculate all reliabilities
    const strategiesUpdated = await recalculateAllStrategyReliabilities();
    
    // Check for strategies with warnings
    const strategiesWithWarningsList = await getStrategiesWithWarnings();
    
    for (const strategy of strategiesWithWarningsList) {
      if (strategy.warningFlags.includes('declining_trend')) {
        warnings.push(
          `Strategy '${strategy.strategyType}' is declining (score: ${strategy.reliabilityScore.toFixed(2)})`
        );
      }
      if (strategy.warningFlags.includes('high_volatility')) {
        warnings.push(
          `Strategy '${strategy.strategyType}' has high volatility`
        );
      }
    }
    
    // Get copy recommended count
    const copyRecommendedList = await getCopyRecommended();
    
    return {
      simulationsProcessed,
      strategiesUpdated,
      strategiesWithWarnings: strategiesWithWarningsList.length,
      copyRecommended: copyRecommendedList.length,
      warnings,
      duration: Date.now() - start,
    };
    
  } catch (err) {
    console.error('[Strategy Reliability] Job failed:', err);
    return {
      simulationsProcessed: 0,
      strategiesUpdated: 0,
      strategiesWithWarnings: 0,
      copyRecommended: 0,
      warnings: ['Job failed: ' + String(err)],
      duration: Date.now() - start,
    };
  }
}

/**
 * Get job status
 */
export async function getUpdateStrategyReliabilityStatus() {
  const stats = await getReliabilityStats();
  const strategiesWithWarnings = await getStrategiesWithWarnings();
  const copyRecommended = await getCopyRecommended();
  
  return {
    ...stats,
    lastProcessedAt: lastProcessedSimulationAt,
    strategiesWithWarnings: strategiesWithWarnings.map(s => ({
      type: s.strategyType,
      score: s.reliabilityScore,
      warnings: s.warningFlags,
    })),
    copyRecommendedStrategies: copyRecommended.map(s => s.strategyType),
  };
}
