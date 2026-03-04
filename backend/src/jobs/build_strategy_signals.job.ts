/**
 * Build Strategy Signals Job
 * 
 * Processes strategy profiles and generates actionable signals.
 * Runs every 60-120 seconds.
 * 
 * Input: strategy_profiles, scores, bundles
 * Output: strategy_signals
 */
import { StrategyProfileModel, IStrategyProfile } from '../core/strategies/strategy_profiles.model.js';
import { ScoreModel, IScore } from '../core/scores/scores.model.js';
import { processStrategyForSignals } from '../core/strategy_signals/strategy_signals.service.js';
import { StrategySignalModel } from '../core/strategy_signals/strategy_signals.model.js';

// Track last processed profiles for delta detection
const profileSnapshots: Map<string, IStrategyProfile> = new Map();
const scoreSnapshots: Map<string, IScore> = new Map();

let lastRunTime: Date | null = null;

export interface BuildStrategySignalsResult {
  processedProfiles: number;
  signalsGenerated: number;
  duration: number;
}

/**
 * Build strategy signals from profiles
 */
export async function buildStrategySignals(): Promise<BuildStrategySignalsResult> {
  const startTime = Date.now();
  let processedProfiles = 0;
  let signalsGenerated = 0;
  
  try {
    // Get profiles updated since last run (or all if first run)
    const query: Record<string, unknown> = {};
    if (lastRunTime) {
      query.updatedAt = { $gt: lastRunTime };
    }
    
    const profiles = await StrategyProfileModel
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(500) // Process in batches
      .lean();
    
    if (profiles.length === 0) {
      lastRunTime = new Date();
      return { processedProfiles: 0, signalsGenerated: 0, duration: Date.now() - startTime };
    }
    
    // Get corresponding scores
    const addresses = profiles.map(p => p.address);
    const scores = await ScoreModel
      .find({ subjectId: { $in: addresses }, window: '7d' })
      .lean();
    
    const scoreMap = new Map<string, IScore>();
    for (const score of scores) {
      scoreMap.set(score.subjectId, score);
    }
    
    // Process each profile
    for (const profile of profiles) {
      const snapshotKey = `${profile.address}:${profile.chain}`;
      const previousProfile = profileSnapshots.get(snapshotKey) || null;
      const previousScore = scoreSnapshots.get(snapshotKey) || null;
      const currentScore = scoreMap.get(profile.address) || null;
      
      try {
        const signals = await processStrategyForSignals({
          profile: profile as IStrategyProfile,
          previousProfile,
          score: currentScore,
          previousScore,
        });
        
        signalsGenerated += signals.length;
        processedProfiles++;
        
        // Update snapshots
        profileSnapshots.set(snapshotKey, profile as IStrategyProfile);
        if (currentScore) {
          scoreSnapshots.set(snapshotKey, currentScore);
        }
      } catch (err) {
        console.error(`[Build Strategy Signals] Error processing ${profile.address}:`, err);
      }
    }
    
    lastRunTime = new Date();
    
  } catch (err) {
    console.error('[Build Strategy Signals] Job failed:', err);
  }
  
  return {
    processedProfiles,
    signalsGenerated,
    duration: Date.now() - startTime,
  };
}

/**
 * Get job status
 */
export async function getBuildStrategySignalsStatus(): Promise<{
  totalSignals: number;
  last24h: number;
  byType: Record<string, number>;
  byStrategy: Record<string, number>;
  lastRun: string | null;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [total, last24h, byTypeAgg, byStrategyAgg] = await Promise.all([
    StrategySignalModel.countDocuments(),
    StrategySignalModel.countDocuments({ createdAt: { $gte: yesterday } }),
    StrategySignalModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    StrategySignalModel.aggregate([
      { $group: { _id: '$strategyType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) {
    byType[item._id] = item.count;
  }
  
  const byStrategy: Record<string, number> = {};
  for (const item of byStrategyAgg) {
    byStrategy[item._id] = item.count;
  }
  
  return {
    totalSignals: total,
    last24h,
    byType,
    byStrategy,
    lastRun: lastRunTime?.toISOString() || null,
  };
}
