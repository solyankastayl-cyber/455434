/**
 * Actor Score MongoDB Model
 * 
 * EPIC A2: Actor Scores
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { 
  ActorScore, 
  ScoreWindow, 
  FlowRole,
  ActorMetrics,
  ScoreCalculateStats
} from './actor_score.types.js';

// ============================================
// Actor Score Document
// ============================================

export interface IActorScoreDocument extends Document {
  actorId: string;
  window: ScoreWindow;
  
  edgeScore: number;
  participation: number;
  flowRole: FlowRole;
  
  metrics: ActorMetrics;
  
  breakdown: {
    volumeComponent: number;
    diversityComponent: number;
    counterpartyComponent: number;
    sourceAdjustment: number;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const MetricsSchema = new Schema({
  totalVolumeUsd: { type: Number, default: 0 },
  netFlowUsd: { type: Number, default: 0 },
  inflowUsd: { type: Number, default: 0 },
  outflowUsd: { type: Number, default: 0 },
  txCount: { type: Number, default: 0 },
  tokenDiversity: { type: Number, default: 0 },
  counterparties: { type: Number, default: 0 },
  bidirectionalRatio: { type: Number, default: 0 },
}, { _id: false });

const BreakdownSchema = new Schema({
  volumeComponent: { type: Number, default: 0 },
  diversityComponent: { type: Number, default: 0 },
  counterpartyComponent: { type: Number, default: 0 },
  sourceAdjustment: { type: Number, default: 1 },
}, { _id: false });

const ActorScoreSchema = new Schema<IActorScoreDocument>({
  actorId: { type: String, required: true, index: true },
  window: { type: String, enum: ['24h', '7d', '30d'], required: true },
  
  edgeScore: { type: Number, default: 0, index: true },
  participation: { type: Number, default: 0 },
  flowRole: { 
    type: String, 
    enum: ['accumulator', 'distributor', 'neutral', 'market_maker_like'],
    default: 'neutral'
  },
  
  metrics: MetricsSchema,
  breakdown: BreakdownSchema,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Compound index for actor+window
ActorScoreSchema.index({ actorId: 1, window: 1 }, { unique: true });
ActorScoreSchema.index({ window: 1, edgeScore: -1 });
ActorScoreSchema.index({ window: 1, flowRole: 1 });

export const ActorScoreModel = mongoose.model<IActorScoreDocument>('actor_scores', ActorScoreSchema);

// ============================================
// Score Calculate Run Document
// ============================================

export interface IScoreCalculateRun extends Document {
  runId: string;
  window: ScoreWindow;
  startedAt: Date;
  completedAt?: Date;
  status: string;
  
  actorsProcessed: number;
  scoresCalculated: number;
  
  byFlowRole: Record<string, number>;
  avgEdgeScore: number;
  
  errors: string[];
}

const ScoreCalculateRunSchema = new Schema<IScoreCalculateRun>({
  runId: { type: String, required: true, unique: true },
  window: { type: String, required: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
  
  actorsProcessed: { type: Number, default: 0 },
  scoresCalculated: { type: Number, default: 0 },
  
  byFlowRole: { type: Schema.Types.Mixed, default: {} },
  avgEdgeScore: { type: Number, default: 0 },
  
  errors: [String],
});

ScoreCalculateRunSchema.index({ startedAt: -1 });

export const ScoreCalculateRunModel = mongoose.model<IScoreCalculateRun>('actor_score_runs', ScoreCalculateRunSchema);

// ============================================
// Store Functions
// ============================================

export async function saveActorScore(score: ActorScore): Promise<void> {
  await ActorScoreModel.findOneAndUpdate(
    { actorId: score.actorId, window: score.window },
    { ...score, updatedAt: new Date() },
    { upsert: true }
  );
}

export async function saveActorScoresBatch(scores: ActorScore[]): Promise<number> {
  if (scores.length === 0) return 0;
  
  const ops = scores.map(s => ({
    updateOne: {
      filter: { actorId: s.actorId, window: s.window },
      update: { $set: { ...s, updatedAt: new Date() } },
      upsert: true,
    }
  }));
  
  const result = await ActorScoreModel.bulkWrite(ops);
  return result.upsertedCount + result.modifiedCount;
}

export async function getActorScore(actorId: string, window: ScoreWindow) {
  return ActorScoreModel.findOne({ actorId, window }).lean();
}

export async function getActorScores(actorId: string) {
  return ActorScoreModel.find({ actorId }).lean();
}

export async function getTopActorsByEdgeScore(
  window: ScoreWindow, 
  limit: number = 50
) {
  return ActorScoreModel.find({ window })
    .sort({ edgeScore: -1 })
    .limit(limit)
    .lean();
}

export async function getActorsByFlowRole(
  window: ScoreWindow,
  flowRole: FlowRole,
  limit: number = 50
) {
  return ActorScoreModel.find({ window, flowRole })
    .sort({ edgeScore: -1 })
    .limit(limit)
    .lean();
}

export async function getScoreStats(window: ScoreWindow): Promise<{
  total: number;
  avgEdgeScore: number;
  byFlowRole: Record<string, number>;
}> {
  const [total, avgResult, byRoleResult] = await Promise.all([
    ActorScoreModel.countDocuments({ window }),
    ActorScoreModel.aggregate([
      { $match: { window } },
      { $group: { _id: null, avg: { $avg: '$edgeScore' } } }
    ]),
    ActorScoreModel.aggregate([
      { $match: { window } },
      { $group: { _id: '$flowRole', count: { $sum: 1 } } }
    ]),
  ]);
  
  return {
    total,
    avgEdgeScore: avgResult[0]?.avg || 0,
    byFlowRole: byRoleResult.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {}),
  };
}

// Calculate run functions
export async function createScoreRun(runId: string, window: ScoreWindow): Promise<void> {
  await ScoreCalculateRunModel.create({
    runId,
    window,
    startedAt: new Date(),
    status: 'RUNNING',
    byFlowRole: {},
  });
}

export async function completeScoreRun(runId: string, stats: Partial<ScoreCalculateStats>): Promise<void> {
  await ScoreCalculateRunModel.updateOne(
    { runId },
    { $set: { ...stats, completedAt: new Date(), status: 'COMPLETED' } }
  );
}

export async function failScoreRun(runId: string, error: string): Promise<void> {
  await ScoreCalculateRunModel.updateOne(
    { runId },
    { $set: { completedAt: new Date(), status: 'FAILED' }, $push: { errors: error } }
  );
}

export async function getRecentScoreRuns(limit: number = 10) {
  return ScoreCalculateRunModel.find().sort({ startedAt: -1 }).limit(limit).lean();
}

// ============================================
// Score History (Daily Snapshots)
// ============================================

export interface IScoreHistoryDocument extends Document {
  actorId: string;
  date: Date;
  window: string;
  edgeScore: number;
  participation: number;
  flowRole: string;
}

const ScoreHistorySchema = new Schema<IScoreHistoryDocument>({
  actorId: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  window: { type: String, required: true },
  edgeScore: { type: Number, default: 0 },
  participation: { type: Number, default: 0 },
  flowRole: { type: String, default: 'neutral' },
});

ScoreHistorySchema.index({ actorId: 1, window: 1, date: -1 });
ScoreHistorySchema.index({ actorId: 1, date: -1 });

export const ScoreHistoryModel = mongoose.model<IScoreHistoryDocument>('actor_score_history', ScoreHistorySchema);

/**
 * Save daily snapshot
 */
export async function saveScoreSnapshot(
  actorId: string,
  window: ScoreWindow,
  edgeScore: number,
  participation: number,
  flowRole: FlowRole
): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  await ScoreHistoryModel.findOneAndUpdate(
    { actorId, window, date: today },
    { edgeScore, participation, flowRole },
    { upsert: true }
  );
}

/**
 * Get score history for actor
 */
export async function getScoreHistory(
  actorId: string,
  window: ScoreWindow,
  days: number = 30
): Promise<IScoreHistoryDocument[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  
  return ScoreHistoryModel.find({
    actorId,
    window,
    date: { $gte: since },
  }).sort({ date: 1 }).lean();
}
