/**
 * Actions Repository
 */
import {
  ActionModel,
  IAction,
  ActionType,
  ActionStatus,
  ACTION_VALIDITY_HOURS,
} from './actions.model.js';

export interface CreateActionInput {
  decisionId: string;
  actionType: ActionType;
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  suggestedAssets?: string[];
  suggestedAmountRange?: [number, number];
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  rationale: string[];
  userId?: string;
}

/**
 * Create action
 */
export async function createAction(input: CreateActionInput): Promise<IAction> {
  const validityHours = ACTION_VALIDITY_HOURS[input.actionType];
  const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);
  
  const action = new ActionModel({
    ...input,
    targetId: input.targetId.toLowerCase(),
    expiresAt,
  });
  
  return action.save();
}

/**
 * Get suggested actions for user
 */
export async function getSuggestedActions(
  userId?: string,
  limit: number = 20
): Promise<IAction[]> {
  const query: Record<string, unknown> = {
    status: 'suggested',
    expiresAt: { $gt: new Date() },
  };
  
  if (userId) {
    query.$or = [{ userId }, { userId: { $exists: false } }];
  }
  
  return ActionModel
    .find(query)
    .sort({ confidence: -1, createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get action by ID
 */
export async function getActionById(id: string): Promise<IAction | null> {
  return ActionModel.findById(id).lean();
}

/**
 * Update action status
 */
export async function updateActionStatus(
  id: string,
  status: ActionStatus
): Promise<IAction | null> {
  return ActionModel.findByIdAndUpdate(
    id,
    { 
      $set: { 
        status, 
        statusUpdatedAt: new Date() 
      } 
    },
    { new: true }
  ).lean();
}

/**
 * Accept action
 */
export async function acceptAction(id: string): Promise<IAction | null> {
  return updateActionStatus(id, 'accepted');
}

/**
 * Dismiss action
 */
export async function dismissAction(id: string): Promise<IAction | null> {
  return updateActionStatus(id, 'dismissed');
}

/**
 * Get user's action history
 */
export async function getUserActionHistory(
  userId: string,
  limit: number = 50
): Promise<IAction[]> {
  return ActionModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get actions by decision
 */
export async function getActionsByDecision(decisionId: string): Promise<IAction[]> {
  return ActionModel.find({ decisionId }).lean();
}

/**
 * Expire old actions
 */
export async function expireOldActions(): Promise<number> {
  const result = await ActionModel.updateMany(
    {
      status: 'suggested',
      expiresAt: { $lt: new Date() },
    },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
}

/**
 * Get actions stats
 */
export async function getActionsStats(): Promise<{
  total: number;
  suggested: number;
  accepted: number;
  dismissed: number;
  byType: Record<string, number>;
}> {
  const [total, byStatusAgg, byTypeAgg] = await Promise.all([
    ActionModel.countDocuments(),
    ActionModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ActionModel.aggregate([
      { $group: { _id: '$actionType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byStatus: Record<string, number> = {};
  for (const item of byStatusAgg) byStatus[item._id] = item.count;
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) byType[item._id] = item.count;
  
  return {
    total,
    suggested: byStatus['suggested'] || 0,
    accepted: byStatus['accepted'] || 0,
    dismissed: byStatus['dismissed'] || 0,
    byType,
  };
}
