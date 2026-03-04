/**
 * Feedback Service (L11.4 - Feedback Loop)
 * 
 * Collects and processes user feedback on decisions.
 * Provides analytics on decision quality.
 */
import { IFeedback, FeedbackOutcome, FeedbackRating, FEEDBACK_TAGS } from './feedback.model.js';
import * as repo from './feedback.repository.js';
import { DecisionModel } from '../decisions/decisions.model.js';
import { ActionModel } from '../actions/actions.model.js';
import { SimulationModel } from '../simulations/simulations.model.js';

/**
 * Submit feedback for a decision
 */
export async function submitDecisionFeedback(
  decisionId: string,
  userId: string,
  feedback: {
    rating?: FeedbackRating;
    outcome?: FeedbackOutcome;
    helpful?: boolean;
    accurate?: boolean;
    timely?: boolean;
    comments?: string;
    tags?: string[];
  }
): Promise<IFeedback | null> {
  // Get decision
  const decision = await DecisionModel.findById(decisionId).lean();
  if (!decision) return null;
  
  return repo.upsertFeedback({
    feedbackType: 'decision',
    sourceId: decisionId,
    targetType: decision.scope,
    targetId: decision.refId,
    userId,
    ...feedback,
    context: {
      decisionType: decision.decisionType,
      originalConfidence: decision.confidence,
    },
  });
}

/**
 * Submit feedback for an action
 */
export async function submitActionFeedback(
  actionId: string,
  userId: string,
  feedback: {
    rating?: FeedbackRating;
    outcome?: FeedbackOutcome;
    helpful?: boolean;
    accurate?: boolean;
    timely?: boolean;
    comments?: string;
    tags?: string[];
  }
): Promise<IFeedback | null> {
  // Get action
  const action = await ActionModel.findById(actionId).lean();
  if (!action) return null;
  
  return repo.upsertFeedback({
    feedbackType: 'action',
    sourceId: actionId,
    targetType: action.targetType,
    targetId: action.targetId,
    userId,
    ...feedback,
    context: {
      actionType: action.actionType,
      originalConfidence: action.confidence,
    },
  });
}

/**
 * Submit feedback for a simulation
 */
export async function submitSimulationFeedback(
  simulationId: string,
  userId: string,
  feedback: {
    rating?: FeedbackRating;
    outcome?: FeedbackOutcome;
    helpful?: boolean;
    accurate?: boolean;
    comments?: string;
    tags?: string[];
  }
): Promise<IFeedback | null> {
  // Get simulation
  const simulation = await SimulationModel.findById(simulationId).lean();
  if (!simulation) return null;
  
  return repo.upsertFeedback({
    feedbackType: 'simulation',
    sourceId: simulationId,
    targetType: simulation.targetType,
    targetId: simulation.targetId,
    userId,
    ...feedback,
    context: {
      originalConfidence: 0,
      actualScoreChange: simulation.performance.scoreReturn,
      actualPriceChange: simulation.performance.priceReturn,
    },
  });
}

/**
 * Get feedback for a source
 */
export async function getFeedback(
  sourceId: string,
  userId?: string
): Promise<IFeedback | null> {
  return repo.getFeedbackBySource(sourceId, userId);
}

/**
 * Get user's feedback history
 */
export async function getUserFeedbackHistory(
  userId: string,
  limit: number = 50
): Promise<IFeedback[]> {
  return repo.getUserFeedbackHistory(userId, limit);
}

/**
 * Get feedback metrics for target
 */
export async function getTargetFeedbackMetrics(targetId: string) {
  return repo.getTargetFeedbackMetrics(targetId);
}

/**
 * Get available tags
 */
export function getAvailableTags(): string[] {
  return FEEDBACK_TAGS;
}

/**
 * Analyze decision quality based on feedback
 * Returns insights for improving decision engine
 */
export async function analyzeDecisionQuality(): Promise<{
  avgRating: number;
  followedRate: number;
  topPerformingDecisionTypes: { type: string; avgRating: number }[];
  commonIssues: { tag: string; count: number }[];
  improvementAreas: string[];
}> {
  const stats = await repo.getFeedbackStats();
  
  // Get per-decision-type ratings
  const typeRatings = await repo.getFeedbackByOutcome('followed', 500);
  const typeMap = new Map<string, number[]>();
  
  for (const fb of typeRatings) {
    if (fb.rating && fb.context.decisionType) {
      const ratings = typeMap.get(fb.context.decisionType) || [];
      ratings.push(fb.rating);
      typeMap.set(fb.context.decisionType, ratings);
    }
  }
  
  const topPerformingDecisionTypes = Array.from(typeMap.entries())
    .map(([type, ratings]) => ({
      type,
      avgRating: ratings.reduce((a, b) => a + b, 0) / ratings.length,
    }))
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 5);
  
  // Get common negative tags
  const ignoredFeedback = await repo.getFeedbackByOutcome('ignored', 200);
  const tagCounts = new Map<string, number>();
  
  for (const fb of ignoredFeedback) {
    for (const tag of fb.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  
  const commonIssues = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Generate improvement areas
  const improvementAreas: string[] = [];
  
  if (stats.followedRate < 50) {
    improvementAreas.push('Low follow rate - decisions may be too conservative or unclear');
  }
  
  if (stats.avgRating < 3) {
    improvementAreas.push('Low average rating - review decision quality and rationale clarity');
  }
  
  const lateIssues = commonIssues.find(i => i.tag === 'too_late');
  if (lateIssues && lateIssues.count > 10) {
    improvementAreas.push('Timing issue - decisions often come too late');
  }
  
  const wrongDirection = commonIssues.find(i => i.tag === 'wrong_direction');
  if (wrongDirection && wrongDirection.count > 10) {
    improvementAreas.push('Direction accuracy - review prediction logic');
  }
  
  return {
    avgRating: stats.avgRating,
    followedRate: stats.followedRate,
    topPerformingDecisionTypes,
    commonIssues,
    improvementAreas,
  };
}

/**
 * Get stats
 */
export async function getStats() {
  return repo.getFeedbackStats();
}
