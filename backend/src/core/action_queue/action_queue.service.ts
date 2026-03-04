/**
 * Action Queue Service (Phase 13.2)
 * 
 * Handles action queuing with:
 * - Proper deduplication (userId + playbookId + source + action + target)
 * - Cooldown BEFORE enqueue (not after dispatch)
 * - Tier enforcement
 * - Skip/failure reason tracking
 */
import { ActionQueueModel, IActionQueue, ActionStatus, ActionType, ActionSourceType, generateDedupKey, calculateActionPriority } from './action_queue.model.js';
import { findMatchingPlaybooks, recordPlaybookTrigger, getPlaybookById } from '../playbooks/playbooks.service.js';

export type SkipReason = 'cooldown' | 'tier_block' | 'dedup' | 'invalid_target' | 'missing_data' | 'max_positions' | 'disabled';

export interface QueueActionResult {
  action: IActionQueue | null;
  queued: boolean;
  skipped: boolean;
  skipReason?: SkipReason;
  message: string;
}

/**
 * Queue a new action with proper dedup and cooldown (п.1.1, п.1.2)
 * Cooldown is checked BEFORE enqueue, not after dispatch
 */
export async function queueAction(
  userId: string,
  data: {
    source: { type: ActionSourceType; id: string; playbookId?: string };
    actionType: ActionType;
    target: { type: 'actor' | 'token' | 'entity' | 'strategy'; id: string; label?: string };
    payload?: Record<string, any>;
    priority?: number;
    explanation: string;
    scheduledAt?: Date;
    expiresAt?: Date;
    cooldownMinutes?: number; // Cooldown from playbook
  }
): Promise<QueueActionResult> {
  // Generate proper dedupKey including playbookId (п.1.1)
  const dedupKey = generateDedupKey(
    userId,
    data.source.playbookId,
    data.source.type,
    data.source.id,
    data.actionType,
    data.target.id
  );
  
  // Check cooldown BEFORE enqueue (п.1.2)
  const cooldownMs = (data.cooldownMinutes || 60) * 60 * 1000;
  const cooldownCheck = await ActionQueueModel.findOne({
    dedupKey,
    status: { $in: ['queued', 'ready', 'executed'] },
    createdAt: { $gte: new Date(Date.now() - cooldownMs) },
  });
  
  if (cooldownCheck) {
    // Log skipped action for debugging (п.6.2)
    const skippedAction = new ActionQueueModel({
      userId,
      source: data.source,
      actionType: data.actionType,
      target: data.target,
      payload: data.payload || {},
      priority: data.priority || 3,
      status: 'skipped',
      scheduledAt: new Date(),
      dedupKey,
      explanation: data.explanation,
      skipReason: 'cooldown',
    });
    await skippedAction.save();
    
    return {
      action: skippedAction,
      queued: false,
      skipped: true,
      skipReason: 'cooldown',
      message: `Action skipped: cooldown active (${data.cooldownMinutes || 60} min)`,
    };
  }
  
  // Check for exact duplicate (dedup)
  const existingDup = await ActionQueueModel.findOne({
    dedupKey,
    status: { $in: ['queued', 'ready'] },
  });
  
  if (existingDup) {
    // Update priority if new one is higher
    if ((data.priority || 3) < existingDup.priority) {
      existingDup.priority = data.priority || 3;
      await existingDup.save();
    }
    
    return {
      action: existingDup,
      queued: false,
      skipped: true,
      skipReason: 'dedup',
      message: 'Action already in queue (dedup)',
    };
  }
  
  // Create new action
  const action = new ActionQueueModel({
    userId,
    source: data.source,
    actionType: data.actionType,
    target: data.target,
    payload: data.payload || {},
    priority: data.priority || 3,
    status: 'queued',
    scheduledAt: data.scheduledAt || new Date(),
    expiresAt: data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
    dedupKey,
    explanation: data.explanation,
  });
  
  await action.save();
  
  return {
    action,
    queued: true,
    skipped: false,
    message: 'Action queued successfully',
  };
}

/**
 * Get action queue for user
 */
export async function getActionQueue(
  userId: string,
  options?: { status?: ActionStatus | ActionStatus[]; limit?: number }
): Promise<IActionQueue[]> {
  const query: any = { userId };
  
  if (options?.status) {
    query.status = Array.isArray(options.status) ? { $in: options.status } : options.status;
  }
  
  return ActionQueueModel.find(query)
    .sort({ priority: 1, scheduledAt: 1 })
    .limit(options?.limit || 50);
}

/**
 * Get pending actions ready for execution
 */
export async function getPendingActions(limit: number = 20): Promise<IActionQueue[]> {
  return ActionQueueModel.find({
    status: 'queued',
    scheduledAt: { $lte: new Date() },
  })
    .sort({ priority: 1, scheduledAt: 1 })
    .limit(limit);
}

/**
 * Execute an action (soft actions only)
 */
export async function executeAction(actionId: string): Promise<IActionQueue | null> {
  const action = await ActionQueueModel.findById(actionId);
  if (!action) return null;
  
  if (action.status !== 'queued' && action.status !== 'ready') {
    return action;
  }
  
  try {
    action.status = 'ready';
    await action.save();
    
    // Execute based on action type
    let result: any = {};
    
    switch (action.actionType) {
      case 'notify':
        // In a real system, this would send a notification
        result = { notified: true, timestamp: new Date() };
        break;
        
      case 'add_to_watchlist':
        // Would add to user's watchlist
        result = { added: true, targetId: action.target.id };
        break;
        
      case 'follow':
        // Would create a follow relationship
        result = { followed: true, targetId: action.target.id };
        break;
        
      case 'create_alert_rule':
        // Would create an alert rule
        result = { ruleCreated: true, params: action.payload };
        break;
        
      case 'simulate_copy':
        // Would trigger paper copy simulation
        result = { simulationStarted: true, targetId: action.target.id };
        break;
        
      default:
        result = { actionType: action.actionType, processed: true };
    }
    
    action.status = 'executed';
    action.executedAt = new Date();
    action.result = result;
    await action.save();
    
    return action;
  } catch (err: any) {
    action.status = 'failed';
    action.error = err.message;
    await action.save();
    return action;
  }
}

/**
 * Cancel an action
 */
export async function cancelAction(
  actionId: string,
  userId: string,
  reason?: string
): Promise<IActionQueue | null> {
  const action = await ActionQueueModel.findOne({ _id: actionId, userId });
  if (!action) return null;
  
  if (action.status === 'executed') {
    return action; // Can't cancel executed
  }
  
  action.status = 'cancelled';
  action.statusReason = reason || 'User cancelled';
  await action.save();
  return action;
}

export interface ProcessSignalResult {
  playbooks: number;
  actionsQueued: number;
  actionsSkipped: number;
  skippedReasons: Record<string, number>;
  actions: {
    actionType: string;
    targetId: string;
    queued: boolean;
    skipReason?: string;
  }[];
}

/**
 * Process signal through playbooks and queue actions (п.2)
 * 
 * IMPORTANT: This function ONLY queues actions, does NOT auto-execute them.
 * Execution happens separately via dispatch-actions job or manual /run endpoint.
 * 
 * Flow:
 * 1. Find enabled playbooks matching trigger
 * 2. Filter by conditions (severity/confidence/risk/strategy)
 * 3. Generate actions list
 * 4. Apply dedup + cooldown BEFORE enqueue
 * 5. Write to queue (status: 'queued')
 * 
 * @param dryRun - If true, returns what would be created without writing to DB (п.6.1)
 */
export async function processSignalThroughPlaybooks(
  userId: string,
  signal: {
    id: string;
    type: string;
    severity: number;
    confidence: number;
    stability?: number;
    strategyType?: string;
    risk?: number;
    influence?: number;
    score?: number;
    actorAddress?: string;
    tokenAddress?: string;
    intensity?: number;
  },
  dryRun: boolean = false
): Promise<ProcessSignalResult> {
  // Find matching playbooks (already filtered by conditions in findMatchingPlaybooks)
  const playbooks = await findMatchingPlaybooks(userId, signal);
  
  const result: ProcessSignalResult = {
    playbooks: playbooks.length,
    actionsQueued: 0,
    actionsSkipped: 0,
    skippedReasons: {},
    actions: [],
  };
  
  for (const playbook of playbooks) {
    // Queue actions from playbook (NOT auto-execute!)
    for (const pbAction of playbook.actions) {
      const priority = calculateActionPriority(
        signal.severity,
        signal.influence || 50,
        signal.intensity || 50,
        signal.risk || 30
      );
      
      const targetId = signal.actorAddress || signal.tokenAddress || signal.id;
      
      if (dryRun) {
        // Dry run - just report what would happen
        result.actions.push({
          actionType: pbAction.type,
          targetId,
          queued: true,
          skipReason: undefined,
        });
        result.actionsQueued++;
        continue;
      }
      
      // Actually queue the action
      const queueResult = await queueAction(userId, {
        source: {
          type: 'signal',
          id: signal.id,
          playbookId: playbook._id.toString(),
        },
        actionType: pbAction.type,
        target: {
          type: signal.actorAddress ? 'actor' : signal.tokenAddress ? 'token' : 'entity',
          id: targetId,
          label: signal.strategyType,
        },
        payload: pbAction.params,
        priority: Math.min(priority, pbAction.priority),
        explanation: `Triggered by ${signal.type} (severity: ${signal.severity}) via playbook "${playbook.name}"`,
        scheduledAt: pbAction.delaySeconds 
          ? new Date(Date.now() + pbAction.delaySeconds * 1000)
          : new Date(),
        cooldownMinutes: playbook.cooldownMinutes,
      });
      
      result.actions.push({
        actionType: pbAction.type,
        targetId,
        queued: queueResult.queued,
        skipReason: queueResult.skipReason,
      });
      
      if (queueResult.queued) {
        result.actionsQueued++;
      } else {
        result.actionsSkipped++;
        const reason = queueResult.skipReason || 'unknown';
        result.skippedReasons[reason] = (result.skippedReasons[reason] || 0) + 1;
      }
    }
    
    // Record trigger on playbook (even if some actions skipped)
    if (!dryRun && result.actionsQueued > 0) {
      await recordPlaybookTrigger(playbook._id.toString());
    }
  }
  
  return result;
}

/**
 * Get action queue stats
 */
export async function getActionQueueStats(userId?: string) {
  const match = userId ? { userId } : {};
  
  const [byStatus, byType, recent] = await Promise.all([
    ActionQueueModel.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ActionQueueModel.aggregate([
      { $match: match },
      { $group: { _id: '$actionType', count: { $sum: 1 } } },
    ]),
    ActionQueueModel.countDocuments({
      ...match,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);
  
  return {
    byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
    byType: Object.fromEntries(byType.map(t => [t._id, t.count])),
    last24h: recent,
  };
}

/**
 * Expire old queued actions
 */
export async function expireOldActions(): Promise<number> {
  const result = await ActionQueueModel.updateMany(
    {
      status: 'queued',
      expiresAt: { $lte: new Date() },
    },
    {
      $set: {
        status: 'expired',
        statusReason: 'Action expired',
      },
    }
  );
  
  return result.modifiedCount;
}
