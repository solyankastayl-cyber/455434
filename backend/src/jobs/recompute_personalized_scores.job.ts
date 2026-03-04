/**
 * Recompute Personalized Scores Job (Phase 12B)
 * 
 * Runs every 5 minutes to refresh personalized scores for active users.
 */
import { UserPreferencesModel } from '../core/personalized/user_preferences.model.js';

let lastRunAt: Date | null = null;
let lastResult = {
  usersProcessed: 0,
  scoresRecomputed: 0,
  duration: 0,
};

export async function recomputePersonalizedScores(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Get active users (updated in last 7 days)
  const recentUsers = await UserPreferencesModel.find({
    updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  }).select('userId').limit(50);
  
  // For now, just count - actual recomputation would involve caching layer
  // This is a placeholder for future optimization
  
  lastRunAt = new Date();
  lastResult = {
    usersProcessed: recentUsers.length,
    scoresRecomputed: 0, // Would be populated when caching is implemented
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getRecomputePersonalizedScoresStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
