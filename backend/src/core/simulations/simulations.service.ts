/**
 * Simulations Service (L11.3 - Virtual Performance Engine)
 * 
 * Tracks hypothetical performance of decisions.
 * Provides "what if" analysis for user decisions.
 */
import { ISimulation } from './simulations.model.js';
import * as repo from './simulations.repository.js';
import { DecisionModel, IDecision } from '../decisions/decisions.model.js';
import { IAction } from '../actions/actions.model.js';
import { ScoreModel } from '../scores/scores.model.js';

/**
 * Start simulation from decision
 */
export async function startSimulationFromDecision(
  decision: IDecision
): Promise<ISimulation> {
  // Get current score for entry point
  const score = await ScoreModel.findOne({
    subjectId: decision.refId,
    window: '7d',
  }).lean();
  
  const entryScore = score?.compositeScore || 50;
  
  // Map decision type to simulation type
  let simulationType: 'follow' | 'copy' | 'watch' = 'watch';
  if (decision.decisionType === 'follow') simulationType = 'follow';
  if (decision.decisionType === 'copy') simulationType = 'copy';
  
  return repo.createSimulation({
    decisionId: decision._id.toString(),
    targetType: decision.scope,
    targetId: decision.refId,
    entryCompositeScore: entryScore,
    simulationType,
    hypotheticalAllocation: decision.suggestedAllocation || 5,
  });
}

/**
 * Start simulation from action
 */
export async function startSimulationFromAction(
  action: IAction
): Promise<ISimulation | null> {
  // Get the parent decision
  const decision = await DecisionModel.findById(action.decisionId).lean();
  if (!decision) return null;
  
  // Get current score
  const score = await ScoreModel.findOne({
    subjectId: action.targetId,
    window: '7d',
  }).lean();
  
  const entryScore = score?.compositeScore || 50;
  
  // Map action type to simulation type
  let simulationType: 'follow' | 'copy' | 'watch' = 'watch';
  if (action.actionType === 'copy_strategy' || action.actionType === 'copy_actor') {
    simulationType = 'copy';
  } else if (action.actionType === 'add_watchlist' || action.actionType === 'set_alert') {
    simulationType = 'follow';
  }
  
  return repo.createSimulation({
    decisionId: action.decisionId,
    actionId: action._id.toString(),
    targetType: action.targetType,
    targetId: action.targetId,
    entryCompositeScore: entryScore,
    simulationType,
    hypotheticalAllocation: action.suggestedAmountRange
      ? (action.suggestedAmountRange[0] + action.suggestedAmountRange[1]) / 2
      : 5,
  });
}

/**
 * Update active simulations with new scores
 * Called periodically by job
 */
export async function updateActiveSimulations(): Promise<{
  updated: number;
  completed: number;
  errors: number;
}> {
  const active = await repo.getActiveSimulations(500);
  
  let updated = 0;
  let completed = 0;
  let errors = 0;
  
  for (const sim of active) {
    try {
      // Get current score
      const currentScore = await ScoreModel.findOne({
        subjectId: sim.targetId,
        window: '7d',
      }).lean();
      
      if (!currentScore) {
        errors++;
        continue;
      }
      
      const scoreChange = currentScore.compositeScore - sim.entryCompositeScore;
      
      // Add checkpoint
      await repo.addCheckpoint(sim._id.toString(), {
        scoreChange,
        notes: [`Score: ${currentScore.compositeScore.toFixed(1)}`],
      });
      
      updated++;
    } catch (err) {
      console.error(`[Simulations] Error updating simulation ${sim._id}:`, err);
      errors++;
    }
  }
  
  // Auto-complete expired simulations
  const expired = await repo.getExpiredSimulations();
  for (const sim of expired) {
    try {
      const currentScore = await ScoreModel.findOne({
        subjectId: sim.targetId,
        window: '7d',
      }).lean();
      
      await repo.completeSimulation(
        sim._id.toString(),
        currentScore?.compositeScore || sim.entryCompositeScore
      );
      completed++;
    } catch (err) {
      console.error(`[Simulations] Error completing simulation ${sim._id}:`, err);
      errors++;
    }
  }
  
  return { updated, completed, errors };
}

/**
 * Get simulation for decision
 */
export async function getSimulationForDecision(
  decisionId: string
): Promise<ISimulation | null> {
  return repo.getSimulationByDecision(decisionId);
}

/**
 * Get simulations for target
 */
export async function getSimulationsForTarget(
  targetId: string,
  limit: number = 20
): Promise<ISimulation[]> {
  return repo.getSimulationsForTarget(targetId, limit);
}

/**
 * Get active simulations
 */
export async function getActiveSimulations(limit: number = 50): Promise<ISimulation[]> {
  return repo.getActiveSimulations(limit);
}

/**
 * Complete simulation manually
 */
export async function completeSimulation(id: string): Promise<ISimulation | null> {
  const sim = await repo.getSimulationById(id);
  if (!sim || sim.status !== 'active') return null;
  
  const currentScore = await ScoreModel.findOne({
    subjectId: sim.targetId,
    window: '7d',
  }).lean();
  
  return repo.completeSimulation(
    id,
    currentScore?.compositeScore || sim.entryCompositeScore
  );
}

/**
 * Invalidate simulation
 */
export async function invalidateSimulation(
  id: string,
  reason: string
): Promise<ISimulation | null> {
  return repo.invalidateSimulation(id, reason);
}

/**
 * Get performance summary for target
 */
export async function getPerformanceSummary(targetId: string): Promise<{
  totalSimulations: number;
  completedSimulations: number;
  avgScoreReturn: number;
  successRate: number;
  simulations: ISimulation[];
}> {
  const simulations = await repo.getSimulationsForTarget(targetId, 50);
  
  const completed = simulations.filter(s => s.status === 'completed');
  const positive = completed.filter(s => s.performance.outcome === 'positive');
  
  const avgScoreReturn = completed.length > 0
    ? completed.reduce((sum, s) => sum + s.performance.scoreReturn, 0) / completed.length
    : 0;
  
  const successRate = completed.length > 0
    ? (positive.length / completed.length) * 100
    : 0;
  
  return {
    totalSimulations: simulations.length,
    completedSimulations: completed.length,
    avgScoreReturn,
    successRate,
    simulations,
  };
}

/**
 * Get stats
 */
export async function getStats() {
  return repo.getSimulationsStats();
}
