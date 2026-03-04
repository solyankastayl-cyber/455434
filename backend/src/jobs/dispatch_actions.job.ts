/**
 * Dispatch Actions Job (Phase 13.2)
 * 
 * Runs every 30-60 seconds to execute queued actions.
 */
import { getPendingActions, executeAction, expireOldActions } from '../core/action_queue/action_queue.service.js';

let lastRunAt: Date | null = null;
let lastResult = {
  actionsProcessed: 0,
  actionsExecuted: 0,
  actionsFailed: 0,
  actionsExpired: 0,
  duration: 0,
};

export async function dispatchActions(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Get pending actions
  const pendingActions = await getPendingActions(20);
  
  let executed = 0;
  let failed = 0;
  
  for (const action of pendingActions) {
    try {
      const result = await executeAction(action._id.toString());
      if (result?.status === 'executed') {
        executed++;
      } else if (result?.status === 'failed') {
        failed++;
      }
    } catch (err) {
      console.error(`[Dispatch Actions] Failed to execute action ${action._id}:`, err);
      failed++;
    }
  }
  
  // Expire old actions
  const expired = await expireOldActions();
  
  lastRunAt = new Date();
  lastResult = {
    actionsProcessed: pendingActions.length,
    actionsExecuted: executed,
    actionsFailed: failed,
    actionsExpired: expired,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getDispatchActionsStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
