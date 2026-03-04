/**
 * Trust Service (L11.5 - Trust & Transparency Overlay)
 * 
 * Calculates and manages trust scores.
 * Provides transparency about system reliability.
 */
import { ITrust, TrustLevel, MIN_SAMPLE_SIZE } from './trust.model.js';
import * as repo from './trust.repository.js';
import { DecisionModel, DecisionType } from '../decisions/decisions.model.js';
import { SimulationModel } from '../simulations/simulations.model.js';
import { FeedbackModel } from '../feedback/feedback.model.js';

/**
 * Calculate trust for a decision type
 */
export async function calculateDecisionTypeTrust(
  decisionType: DecisionType
): Promise<ITrust> {
  // Get simulations for this decision type
  const simulations = await SimulationModel.find({
    status: 'completed',
  }).lean();
  
  // Get related decisions
  const decisionIds = simulations.map(s => s.decisionId);
  const decisions = await DecisionModel.find({
    _id: { $in: decisionIds },
    decisionType,
  }).lean();
  
  const relevantSimulations = simulations.filter(s =>
    decisions.some(d => d._id.toString() === s.decisionId)
  );
  
  // Get feedback for these decisions
  const feedback = await FeedbackModel.find({
    feedbackType: 'decision',
    sourceId: { $in: decisions.map(d => d._id.toString()) },
  }).lean();
  
  // Calculate components
  const positiveOutcomes = relevantSimulations.filter(
    s => s.performance.outcome === 'positive'
  ).length;
  const negativeOutcomes = relevantSimulations.filter(
    s => s.performance.outcome === 'negative'
  ).length;
  const totalOutcomes = positiveOutcomes + negativeOutcomes;
  
  const accuracyScore = totalOutcomes > 0
    ? (positiveOutcomes / totalOutcomes) * 100
    : 50;
  
  // Consistency: variance in score returns
  const scoreReturns = relevantSimulations.map(s => s.performance.scoreReturn);
  const avgReturn = scoreReturns.length > 0
    ? scoreReturns.reduce((a, b) => a + b, 0) / scoreReturns.length
    : 0;
  const variance = scoreReturns.length > 0
    ? scoreReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / scoreReturns.length
    : 0;
  const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) * 2);
  
  // Timeliness: placeholder (could track time-to-signal)
  const timelinessScore = 60;
  
  // Feedback score
  const ratings = feedback.filter(f => f.rating).map(f => f.rating!);
  const feedbackScore = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 20  // 1-5 → 20-100
    : 50;
  
  // User satisfaction
  const avgUserRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 0;
  
  const followedCount = feedback.filter(f => f.outcome === 'followed').length;
  
  return repo.upsertTrust({
    subjectType: 'decision_type',
    subjectId: decisionType,
    components: {
      accuracyScore,
      consistencyScore,
      timelinessScore,
      feedbackScore,
    },
    stats: {
      totalDecisions: decisions.length,
      followedDecisions: followedCount,
      positiveOutcomes,
      negativeOutcomes,
      avgUserRating,
      sampleSize: relevantSimulations.length,
    },
  });
}

/**
 * Calculate trust for an actor
 */
export async function calculateActorTrust(address: string): Promise<ITrust> {
  const addr = address.toLowerCase();
  
  // Get simulations for this actor
  const simulations = await SimulationModel.find({
    targetId: addr,
    status: 'completed',
  }).lean();
  
  // Get feedback
  const feedback = await FeedbackModel.find({
    targetId: addr,
  }).lean();
  
  // Calculate components
  const positiveOutcomes = simulations.filter(
    s => s.performance.outcome === 'positive'
  ).length;
  const negativeOutcomes = simulations.filter(
    s => s.performance.outcome === 'negative'
  ).length;
  const totalOutcomes = positiveOutcomes + negativeOutcomes;
  
  const accuracyScore = totalOutcomes > 0
    ? (positiveOutcomes / totalOutcomes) * 100
    : 50;
  
  // Consistency
  const scoreReturns = simulations.map(s => s.performance.scoreReturn);
  const avgReturn = scoreReturns.length > 0
    ? scoreReturns.reduce((a, b) => a + b, 0) / scoreReturns.length
    : 0;
  const variance = scoreReturns.length > 0
    ? scoreReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / scoreReturns.length
    : 0;
  const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) * 2);
  
  const timelinessScore = 60;
  
  const ratings = feedback.filter(f => f.rating).map(f => f.rating!);
  const feedbackScore = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 20
    : 50;
  
  const avgUserRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 0;
  
  const followedCount = feedback.filter(f => f.outcome === 'followed').length;
  
  return repo.upsertTrust({
    subjectType: 'actor',
    subjectId: addr,
    components: {
      accuracyScore,
      consistencyScore,
      timelinessScore,
      feedbackScore,
    },
    stats: {
      totalDecisions: simulations.length,
      followedDecisions: followedCount,
      positiveOutcomes,
      negativeOutcomes,
      avgUserRating,
      sampleSize: simulations.length,
    },
  });
}

/**
 * Calculate system-wide trust
 */
export async function calculateSystemTrust(): Promise<ITrust> {
  // Aggregate all simulations
  const simulations = await SimulationModel.find({
    status: 'completed',
  }).lean();
  
  // All feedback
  const feedback = await FeedbackModel.find({}).lean();
  
  const positiveOutcomes = simulations.filter(
    s => s.performance.outcome === 'positive'
  ).length;
  const negativeOutcomes = simulations.filter(
    s => s.performance.outcome === 'negative'
  ).length;
  const totalOutcomes = positiveOutcomes + negativeOutcomes;
  
  const accuracyScore = totalOutcomes > 0
    ? (positiveOutcomes / totalOutcomes) * 100
    : 50;
  
  const scoreReturns = simulations.map(s => s.performance.scoreReturn);
  const avgReturn = scoreReturns.length > 0
    ? scoreReturns.reduce((a, b) => a + b, 0) / scoreReturns.length
    : 0;
  const variance = scoreReturns.length > 0
    ? scoreReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / scoreReturns.length
    : 0;
  const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) * 2);
  
  const timelinessScore = 60;
  
  const ratings = feedback.filter(f => f.rating).map(f => f.rating!);
  const feedbackScore = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 20
    : 50;
  
  const avgUserRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 0;
  
  const followedCount = feedback.filter(f => f.outcome === 'followed').length;
  
  return repo.upsertTrust({
    subjectType: 'system',
    subjectId: 'global',
    components: {
      accuracyScore,
      consistencyScore,
      timelinessScore,
      feedbackScore,
    },
    stats: {
      totalDecisions: simulations.length,
      followedDecisions: followedCount,
      positiveOutcomes,
      negativeOutcomes,
      avgUserRating,
      sampleSize: simulations.length,
    },
  });
}

/**
 * Get trust for subject
 */
export async function getTrust(
  subjectType: string,
  subjectId: string
): Promise<ITrust | null> {
  return repo.getTrust(subjectType, subjectId);
}

/**
 * Get system trust
 */
export async function getSystemTrust(): Promise<ITrust | null> {
  return repo.getSystemTrust();
}

/**
 * Get trust by decision type
 */
export async function getTrustByDecisionType(
  decisionType: string
): Promise<ITrust | null> {
  return repo.getTrustByDecisionType(decisionType);
}

/**
 * Get high trust actors
 */
export async function getHighTrustActors(limit: number = 50): Promise<ITrust[]> {
  return repo.getHighTrustActors(limit);
}

/**
 * Get transparency report
 */
export async function getTransparencyReport(): Promise<{
  systemTrust: ITrust | null;
  decisionTypeTrust: ITrust[];
  highTrustActors: ITrust[];
  stats: Awaited<ReturnType<typeof repo.getTrustStats>>;
  dataQuality: {
    hasMinSampleSize: boolean;
    sampleSize: number;
    recommendation: string;
  };
}> {
  const [systemTrust, decisionTypeTrust, highTrustActors, stats] = await Promise.all([
    repo.getSystemTrust(),
    repo.getTrustByType('decision_type'),
    repo.getHighTrustActors(10),
    repo.getTrustStats(),
  ]);
  
  const sampleSize = systemTrust?.stats.sampleSize || 0;
  const hasMinSampleSize = sampleSize >= MIN_SAMPLE_SIZE;
  
  let recommendation = '';
  if (!hasMinSampleSize) {
    recommendation = `Need ${MIN_SAMPLE_SIZE - sampleSize} more completed simulations for reliable trust scores`;
  } else if (stats.avgScore < 50) {
    recommendation = 'System accuracy below threshold - review decision logic';
  } else if (stats.declining > stats.improving) {
    recommendation = 'Trust trending down - investigate recent changes';
  } else {
    recommendation = 'System performing within acceptable parameters';
  }
  
  return {
    systemTrust,
    decisionTypeTrust,
    highTrustActors,
    stats,
    dataQuality: {
      hasMinSampleSize,
      sampleSize,
      recommendation,
    },
  };
}

/**
 * Get stats
 */
export async function getStats() {
  return repo.getTrustStats();
}
