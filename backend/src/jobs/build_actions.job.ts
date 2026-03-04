/**
 * Build Actions Job
 * 
 * Generates actions from decisions and starts simulations.
 */
import { DecisionModel } from '../core/decisions/decisions.model.js';
import { ActionModel } from '../core/actions/actions.model.js';
import { generateActionsFromDecision } from '../core/actions/actions.service.js';
import { startSimulationFromDecision } from '../core/simulations/simulations.service.js';
import { SimulationModel } from '../core/simulations/simulations.model.js';

interface BuildActionsResult {
  processedDecisions: number;
  actionsCreated: number;
  simulationsStarted: number;
  errors: number;
  duration: number;
}

/**
 * Build actions from recent decisions
 */
export async function buildActions(): Promise<BuildActionsResult> {
  const start = Date.now();
  let processedDecisions = 0;
  let actionsCreated = 0;
  let simulationsStarted = 0;
  let errors = 0;
  
  try {
    // Get recent decisions without actions (last 1h)
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentDecisions = await DecisionModel.find({
      createdAt: { $gt: hourAgo },
      validUntil: { $gt: new Date() },
      decisionType: { $in: ['follow', 'copy', 'watch', 'reduce_exposure'] },
    }).sort({ createdAt: -1 }).limit(50);
    
    for (const decision of recentDecisions) {
      try {
        // Check if we already have actions for this decision
        const existingActions = await ActionModel.findOne({
          decisionId: decision._id.toString(),
        });
        
        if (existingActions) {
          processedDecisions++;
          continue;
        }
        
        // Generate actions
        const actions = await generateActionsFromDecision(decision);
        actionsCreated += actions.length;
        
        // Start simulation for copy/follow decisions
        if (['copy', 'follow'].includes(decision.decisionType)) {
          const existingSim = await SimulationModel.findOne({
            decisionId: decision._id.toString(),
          });
          
          if (!existingSim) {
            await startSimulationFromDecision(decision);
            simulationsStarted++;
          }
        }
        
        processedDecisions++;
        
      } catch (err) {
        console.error(`[Build Actions] Error for decision ${decision._id}:`, err);
        errors++;
      }
    }
    
  } catch (err) {
    console.error('[Build Actions] Job failed:', err);
    errors++;
  }
  
  return {
    processedDecisions,
    actionsCreated,
    simulationsStarted,
    errors,
    duration: Date.now() - start,
  };
}

/**
 * Get job status
 */
export async function getBuildActionsStatus(): Promise<{
  totalActions: number;
  suggestedActions: number;
  acceptedActions: number;
  activeSimulations: number;
}> {
  const [total, suggested, accepted, activeSims] = await Promise.all([
    ActionModel.countDocuments(),
    ActionModel.countDocuments({ status: 'suggested' }),
    ActionModel.countDocuments({ status: 'accepted' }),
    SimulationModel.countDocuments({ status: 'active' }),
  ]);
  
  return {
    totalActions: total,
    suggestedActions: suggested,
    acceptedActions: accepted,
    activeSimulations: activeSims,
  };
}
