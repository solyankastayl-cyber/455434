/**
 * Simulations Repository
 */
import {
  SimulationModel,
  ISimulation,
  SIMULATION_MAX_DAYS,
  OUTCOME_THRESHOLDS,
} from './simulations.model.js';

export interface CreateSimulationInput {
  decisionId: string;
  actionId?: string;
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  entryCompositeScore: number;
  entryPrice?: number;
  simulationType: 'follow' | 'copy' | 'watch';
  hypotheticalAllocation?: number;
}

export interface AddCheckpointInput {
  priceChange?: number;
  scoreChange: number;
  notes?: string[];
}

/**
 * Create simulation
 */
export async function createSimulation(input: CreateSimulationInput): Promise<ISimulation> {
  const simulation = new SimulationModel({
    ...input,
    targetId: input.targetId.toLowerCase(),
    entryTimestamp: new Date(),
    performance: {
      scoreReturn: 0,
      holdingPeriodDays: 0,
      outcome: 'pending',
    },
  });
  
  return simulation.save();
}

/**
 * Get simulation by ID
 */
export async function getSimulationById(id: string): Promise<ISimulation | null> {
  return SimulationModel.findById(id).lean();
}

/**
 * Get simulation by decision
 */
export async function getSimulationByDecision(decisionId: string): Promise<ISimulation | null> {
  return SimulationModel.findOne({ decisionId }).lean();
}

/**
 * Get active simulations
 */
export async function getActiveSimulations(limit: number = 100): Promise<ISimulation[]> {
  return SimulationModel
    .find({ status: 'active' })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get simulations for target
 */
export async function getSimulationsForTarget(
  targetId: string,
  limit: number = 20
): Promise<ISimulation[]> {
  return SimulationModel
    .find({ targetId: targetId.toLowerCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Add checkpoint to simulation
 */
export async function addCheckpoint(
  id: string,
  checkpoint: AddCheckpointInput
): Promise<ISimulation | null> {
  return SimulationModel.findByIdAndUpdate(
    id,
    {
      $push: {
        checkpoints: {
          timestamp: new Date(),
          ...checkpoint,
          notes: checkpoint.notes || [],
        },
      },
      $set: {
        'performance.scoreReturn': checkpoint.scoreChange,
        'performance.priceReturn': checkpoint.priceChange,
      },
    },
    { new: true }
  ).lean();
}

/**
 * Complete simulation
 */
export async function completeSimulation(
  id: string,
  exitCompositeScore: number,
  exitPrice?: number
): Promise<ISimulation | null> {
  const simulation = await SimulationModel.findById(id);
  if (!simulation) return null;
  
  const holdingPeriodDays = Math.ceil(
    (Date.now() - simulation.entryTimestamp.getTime()) / (24 * 60 * 60 * 1000)
  );
  
  const scoreReturn = exitCompositeScore - simulation.entryCompositeScore;
  const priceReturn = exitPrice && simulation.entryPrice
    ? ((exitPrice - simulation.entryPrice) / simulation.entryPrice) * 100
    : undefined;
  
  // Calculate max drawdown from checkpoints
  let maxDrawdown = 0;
  let peak = 0;
  for (const cp of simulation.checkpoints) {
    const value = cp.scoreChange;
    if (value > peak) peak = value;
    const drawdown = peak - value;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  // Determine outcome
  let outcome: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (scoreReturn > OUTCOME_THRESHOLDS.positive) {
    outcome = 'positive';
  } else if (scoreReturn < OUTCOME_THRESHOLDS.negative) {
    outcome = 'negative';
  }
  
  return SimulationModel.findByIdAndUpdate(
    id,
    {
      $set: {
        status: 'completed',
        exitTimestamp: new Date(),
        exitCompositeScore,
        exitPrice,
        performance: {
          priceReturn,
          scoreReturn,
          maxDrawdown,
          holdingPeriodDays,
          outcome,
        },
      },
    },
    { new: true }
  ).lean();
}

/**
 * Invalidate simulation
 */
export async function invalidateSimulation(
  id: string,
  reason: string
): Promise<ISimulation | null> {
  return SimulationModel.findByIdAndUpdate(
    id,
    {
      $set: { status: 'invalidated' },
      $push: { 'checkpoints': { timestamp: new Date(), scoreChange: 0, notes: [reason] } },
    },
    { new: true }
  ).lean();
}

/**
 * Get expired simulations (past max days)
 */
export async function getExpiredSimulations(): Promise<ISimulation[]> {
  const now = Date.now();
  
  // Find all active simulations
  const active = await SimulationModel.find({ status: 'active' }).lean();
  
  // Filter expired
  return active.filter(sim => {
    const maxDays = SIMULATION_MAX_DAYS[sim.simulationType] || 14;
    const age = (now - sim.entryTimestamp.getTime()) / (24 * 60 * 60 * 1000);
    return age > maxDays;
  });
}

/**
 * Get simulations stats
 */
export async function getSimulationsStats(): Promise<{
  total: number;
  active: number;
  completed: number;
  byOutcome: Record<string, number>;
  avgScoreReturn: number;
  avgHoldingDays: number;
}> {
  const [total, active, completed, byOutcomeAgg, avgMetrics] = await Promise.all([
    SimulationModel.countDocuments(),
    SimulationModel.countDocuments({ status: 'active' }),
    SimulationModel.countDocuments({ status: 'completed' }),
    SimulationModel.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$performance.outcome', count: { $sum: 1 } } },
    ]),
    SimulationModel.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          avgScoreReturn: { $avg: '$performance.scoreReturn' },
          avgHoldingDays: { $avg: '$performance.holdingPeriodDays' },
        },
      },
    ]),
  ]);
  
  const byOutcome: Record<string, number> = {};
  for (const item of byOutcomeAgg) byOutcome[item._id] = item.count;
  
  return {
    total,
    active,
    completed,
    byOutcome,
    avgScoreReturn: avgMetrics[0]?.avgScoreReturn || 0,
    avgHoldingDays: avgMetrics[0]?.avgHoldingDays || 0,
  };
}
