/**
 * Actor MongoDB Model
 * 
 * EPIC A1: Actors Dataset Builder
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { 
  Actor, 
  ActorType, 
  SourceLevel, 
  CoverageBand,
  ActorCoverage,
  AddressStats,
  ActorBuildStats
} from './actor.types.js';

// ============================================
// Actor Document
// ============================================

export interface IActorDocument extends Document {
  id: string;
  type: ActorType;
  name?: string;
  sourceLevel: SourceLevel;
  
  addresses: string[];
  addressStats: AddressStats;
  
  coverage: ActorCoverage;
  
  entityIds?: string[];
  labels?: string[];
  
  createdAt: Date;
  updatedAt: Date;
}

const AddressStatsSchema = new Schema({
  verifiedCount: { type: Number, default: 0 },
  attributedCount: { type: Number, default: 0 },
  behavioralCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
}, { _id: false });

const CoverageSchema = new Schema({
  score: { type: Number, default: 0 },
  band: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Low' },
  lastUpdated: { type: Date, default: Date.now },
}, { _id: false });

const ActorSchema = new Schema<IActorDocument>({
  id: { type: String, required: true, unique: true },
  type: { 
    type: String, 
    enum: ['exchange', 'fund', 'market_maker', 'whale', 'trader', 'protocol', 'infra'],
    required: true,
    index: true 
  },
  name: { type: String },
  sourceLevel: { 
    type: String, 
    enum: ['verified', 'attributed', 'behavioral'],
    required: true,
    index: true 
  },
  
  addresses: [{ type: String }],
  addressStats: AddressStatsSchema,
  
  coverage: CoverageSchema,
  
  entityIds: [{ type: String }],
  labels: [{ type: String }],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes
ActorSchema.index({ type: 1, sourceLevel: 1 });
ActorSchema.index({ 'coverage.score': -1 });
ActorSchema.index({ 'coverage.band': 1 });
ActorSchema.index({ name: 'text' });
ActorSchema.index({ addresses: 1 });

export const ActorModel = mongoose.model<IActorDocument>('actors', ActorSchema);

// ============================================
// Actor Build Run Document
// ============================================

export interface IActorBuildRun extends Document {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: string;
  
  entitiesProcessed: number;
  walletsProcessed: number;
  actorsCreated: number;
  actorsUpdated: number;
  
  byType: Record<string, number>;
  bySource: Record<string, number>;
  
  errors: string[];
  config: Record<string, unknown>;
}

const ActorBuildRunSchema = new Schema<IActorBuildRun>({
  runId: { type: String, required: true, unique: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
  
  entitiesProcessed: { type: Number, default: 0 },
  walletsProcessed: { type: Number, default: 0 },
  actorsCreated: { type: Number, default: 0 },
  actorsUpdated: { type: Number, default: 0 },
  
  byType: { type: Schema.Types.Mixed, default: {} },
  bySource: { type: Schema.Types.Mixed, default: {} },
  
  errors: [String],
  config: { type: Schema.Types.Mixed, default: {} },
});

ActorBuildRunSchema.index({ startedAt: -1 });

export const ActorBuildRunModel = mongoose.model<IActorBuildRun>('actor_build_runs', ActorBuildRunSchema);

// ============================================
// Store Functions
// ============================================

export async function saveActor(actor: Actor): Promise<string> {
  const doc = await ActorModel.findOneAndUpdate(
    { id: actor.id },
    { ...actor, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  return doc.id;
}

export async function saveActorsBatch(actors: Actor[]): Promise<number> {
  if (actors.length === 0) return 0;
  
  const ops = actors.map(a => ({
    updateOne: {
      filter: { id: a.id },
      update: { $set: { ...a, updatedAt: new Date() } },
      upsert: true,
    }
  }));
  
  const result = await ActorModel.bulkWrite(ops);
  return result.upsertedCount + result.modifiedCount;
}

export async function getActorById(id: string): Promise<IActorDocument | null> {
  return ActorModel.findOne({ id }).lean();
}

export async function getActorByAddress(address: string): Promise<IActorDocument | null> {
  return ActorModel.findOne({ addresses: address.toLowerCase() }).lean();
}

export async function deleteActor(id: string): Promise<boolean> {
  const result = await ActorModel.deleteOne({ id });
  return result.deletedCount > 0;
}

export async function getActorCount(): Promise<number> {
  return ActorModel.countDocuments();
}

export async function getActorCountByType(): Promise<Record<string, number>> {
  const result = await ActorModel.aggregate([
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]);
  return result.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
}

export async function getActorCountBySource(): Promise<Record<string, number>> {
  const result = await ActorModel.aggregate([
    { $group: { _id: '$sourceLevel', count: { $sum: 1 } } }
  ]);
  return result.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
}

// Build run functions
export async function createBuildRun(runId: string, config: Record<string, unknown>): Promise<void> {
  await ActorBuildRunModel.create({
    runId,
    startedAt: new Date(),
    status: 'RUNNING',
    config,
    byType: {},
    bySource: {},
  });
}

export async function completeBuildRun(runId: string, stats: Partial<ActorBuildStats>): Promise<void> {
  await ActorBuildRunModel.updateOne(
    { runId },
    { $set: { ...stats, completedAt: new Date(), status: 'COMPLETED' } }
  );
}

export async function failBuildRun(runId: string, error: string): Promise<void> {
  await ActorBuildRunModel.updateOne(
    { runId },
    { $set: { completedAt: new Date(), status: 'FAILED' }, $push: { errors: error } }
  );
}

export async function getBuildRun(runId: string): Promise<IActorBuildRun | null> {
  return ActorBuildRunModel.findOne({ runId }).lean();
}

export async function getRecentBuildRuns(limit: number = 10): Promise<IActorBuildRun[]> {
  return ActorBuildRunModel.find().sort({ startedAt: -1 }).limit(limit).lean();
}
