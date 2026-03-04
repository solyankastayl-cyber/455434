/**
 * Actions Service
 * 
 * Generates action suggestions from decisions.
 * User remains in control.
 */
import { IAction } from './actions.model.js';
import * as repo from './actions.repository.js';
import { IDecision } from '../decisions/decisions.model.js';

/**
 * Generate actions from a decision
 */
export async function generateActionsFromDecision(
  decision: IDecision
): Promise<IAction[]> {
  const actions: repo.CreateActionInput[] = [];
  
  const baseRationale = decision.rationale.slice(0, 2);
  
  switch (decision.decisionType) {
    case 'follow':
      // Suggest adding to watchlist
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'add_watchlist',
        targetType: decision.scope,
        targetId: decision.refId,
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        title: `Add to Watchlist`,
        description: `Track ${decision.scope} ${shortenAddress(decision.refId)} for updates`,
        rationale: [...baseRationale, 'Monitor for strategy changes and signals'],
      });
      
      // Suggest setting alert
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'set_alert',
        targetType: decision.scope,
        targetId: decision.refId,
        confidence: decision.confidence * 0.9,
        riskLevel: decision.riskLevel,
        title: `Set Alert`,
        description: `Get notified on important signals from this ${decision.scope}`,
        rationale: [...baseRationale, 'Receive alerts on strategy shifts and intensity spikes'],
      });
      break;
      
    case 'copy':
      // Suggest copying strategy
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'copy_strategy',
        targetType: decision.scope,
        targetId: decision.refId,
        suggestedAmountRange: decision.suggestedAllocation 
          ? [decision.suggestedAllocation * 0.5, decision.suggestedAllocation * 1.5]
          : [2, 10],
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        title: `Copy Strategy`,
        description: `Mirror the ${decision.context.strategyType?.replace(/_/g, ' ') || 'detected'} strategy`,
        rationale: [...baseRationale, `Suggested allocation: ${decision.suggestedAllocation || 5}%`],
      });
      
      // Also suggest follow as lower-commitment option
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'add_watchlist',
        targetType: decision.scope,
        targetId: decision.refId,
        confidence: decision.confidence * 0.95,
        riskLevel: 'low',
        title: `Watch First`,
        description: `Track before committing - lower risk option`,
        rationale: ['Alternative: monitor before copying', 'Build confidence in the pattern'],
      });
      break;
      
    case 'watch':
      // Suggest watchlist
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'add_watchlist',
        targetType: decision.scope,
        targetId: decision.refId,
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        title: `Add to Watchlist`,
        description: `Monitor this ${decision.scope} closely`,
        rationale: [...baseRationale, 'Waiting for clearer signal'],
      });
      break;
      
    case 'reduce_exposure':
      // Alert about risk
      actions.push({
        decisionId: decision._id.toString(),
        actionType: 'set_alert',
        targetType: decision.scope,
        targetId: decision.refId,
        confidence: decision.confidence,
        riskLevel: 'high',
        title: `Risk Alert`,
        description: `Set up risk monitoring for this ${decision.scope}`,
        rationale: [...baseRationale, 'Get early warning on further risk increases'],
      });
      break;
  }
  
  // Create all actions
  const created: IAction[] = [];
  for (const input of actions) {
    const action = await repo.createAction(input);
    created.push(action);
  }
  
  return created;
}

/**
 * Get suggested actions
 */
export async function getSuggestedActions(
  userId?: string,
  limit: number = 20
): Promise<IAction[]> {
  return repo.getSuggestedActions(userId, limit);
}

/**
 * Accept action
 */
export async function acceptAction(actionId: string): Promise<IAction | null> {
  return repo.acceptAction(actionId);
}

/**
 * Dismiss action
 */
export async function dismissAction(actionId: string): Promise<IAction | null> {
  return repo.dismissAction(actionId);
}

/**
 * Get action history
 */
export async function getActionHistory(
  userId: string,
  limit: number = 50
): Promise<IAction[]> {
  return repo.getUserActionHistory(userId, limit);
}

/**
 * Expire old actions
 */
export async function expireOldActions(): Promise<number> {
  return repo.expireOldActions();
}

/**
 * Get stats
 */
export async function getStats() {
  return repo.getActionsStats();
}

/**
 * Helper: shorten address
 */
function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
