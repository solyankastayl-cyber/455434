/**
 * Actor Import Service (P1.1)
 * 
 * Service for importing actors with addresses.
 * Used for Data Enrichment.
 */
import mongoose from 'mongoose';
import { ActorModel, IActorDocument } from './actor.model.js';
import { ActorSourceModel } from './actor_source.model.js';
import { calculateSimpleCoverageV2, getCoverageBandV2 } from './actor.coverage.service.js';
import type { ActorType, SourceLevel } from './actor.types.js';

export interface ActorImportInput {
  name: string;
  type: ActorType;
  addresses: string[];
  source?: SourceLevel;
  tags?: string[];
  labels?: string[];
}

export interface ActorImportResult {
  actorId: string;
  created: boolean;
  updated: boolean;
  addressesAdded: number;
}

/**
 * Import a single actor
 */
export async function importActor(input: ActorImportInput): Promise<ActorImportResult> {
  const actorId = `actor_${input.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const addresses = input.addresses.map(a => a.toLowerCase());
  
  // Check if actor exists
  const existing = await ActorModel.findOne({ id: actorId });
  
  if (existing) {
    // Update existing actor - add new addresses
    const existingAddresses = new Set(existing.addresses);
    const newAddresses = addresses.filter(a => !existingAddresses.has(a));
    
    if (newAddresses.length > 0) {
      existing.addresses.push(...newAddresses);
      existing.addressStats.totalCount = existing.addresses.length;
      if (input.source === 'verified') {
        existing.addressStats.verifiedCount += newAddresses.length;
      } else {
        existing.addressStats.attributedCount += newAddresses.length;
      }
      existing.updatedAt = new Date();
      await existing.save();
    }
    
    // Add import source record
    await ActorSourceModel.create({
      actorId,
      sourceType: 'import',
      confidence: input.source === 'verified' ? 1.0 : 0.85,
      notes: `Updated with ${newAddresses.length} new addresses`,
    });
    
    return {
      actorId,
      created: false,
      updated: newAddresses.length > 0,
      addressesAdded: newAddresses.length,
    };
  }
  
  // Create new actor
  const verifiedCount = input.source === 'verified' ? addresses.length : 0;
  const attributedCount = input.source !== 'verified' ? addresses.length : 0;
  
  // Calculate initial coverage
  const coverage = calculateSimpleCoverageV2(
    addresses.length,
    verifiedCount,
    50, // Initial activity score
    input.source || 'attributed'
  );
  
  await ActorModel.create({
    id: actorId,
    name: input.name,
    type: input.type,
    sourceLevel: input.source || 'attributed',
    addresses,
    addressStats: {
      verifiedCount,
      attributedCount,
      behavioralCount: 0,
      totalCount: addresses.length,
    },
    coverage: {
      score: coverage.score,
      band: coverage.band === 'HIGH' ? 'High' : coverage.band === 'MEDIUM' ? 'Medium' : 'Low',
      lastUpdated: new Date(),
    },
    tags: input.tags || [],
    labels: input.labels || [],
    entityIds: [],
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  });
  
  // Add import source record
  await ActorSourceModel.create({
    actorId,
    sourceType: 'import',
    confidence: input.source === 'verified' ? 1.0 : 0.85,
    notes: `Imported with ${addresses.length} addresses`,
  });
  
  return {
    actorId,
    created: true,
    updated: false,
    addressesAdded: addresses.length,
  };
}

/**
 * Import multiple actors from seed data
 */
export async function importActorsBatch(actors: ActorImportInput[]): Promise<{
  total: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const results = {
    total: actors.length,
    created: 0,
    updated: 0,
    errors: [] as string[],
  };
  
  for (const actor of actors) {
    try {
      const result = await importActor(actor);
      if (result.created) results.created++;
      if (result.updated) results.updated++;
    } catch (err) {
      results.errors.push(`${actor.name}: ${err}`);
    }
  }
  
  return results;
}

/**
 * Get actor stats summary
 */
export async function getActorStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  byCoverageBand: Record<string, number>;
  avgCoverage: number;
  withHighCoverage: number;
}> {
  const [total, byType, bySource, byCoverage, avgCovResult] = await Promise.all([
    ActorModel.countDocuments(),
    ActorModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]),
    ActorModel.aggregate([
      { $group: { _id: '$sourceLevel', count: { $sum: 1 } } }
    ]),
    ActorModel.aggregate([
      { $group: { _id: '$coverage.band', count: { $sum: 1 } } }
    ]),
    ActorModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$coverage.score' } } }
    ]),
  ]);
  
  const highCoverage = await ActorModel.countDocuments({ 'coverage.score': { $gte: 60 } });
  
  return {
    total,
    byType: byType.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {} as Record<string, number>),
    bySource: bySource.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {} as Record<string, number>),
    byCoverageBand: byCoverage.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {} as Record<string, number>),
    avgCoverage: Math.round(avgCovResult[0]?.avg || 0),
    withHighCoverage: highCoverage,
  };
}

/**
 * Recalculate coverage for all actors using real aggregation data
 * P1: Optimized for better confidence scores
 */
export async function recalculateAllCoverage(): Promise<{
  processed: number;
  updated: number;
}> {
  const actors = await ActorModel.find();
  let updated = 0;
  
  // Get flow aggregations to calculate activity scores
  const flowAggs = await mongoose.connection.db
    .collection('actor_flow_agg')
    .find({ window: '7d' })
    .toArray();
  
  const flowMap = new Map(flowAggs.map(f => [f.actorId, f]));
  
  // Get p75 tx_count for normalization (exclude extreme outliers)
  const txCounts = flowAggs.map(f => f.tx_count || 0).sort((a, b) => a - b);
  const p75Index = Math.floor(txCounts.length * 0.75);
  const p75TxCount = txCounts[p75Index] || 1000;
  
  for (const actor of actors) {
    const flow = flowMap.get(actor.id);
    
    // Calculate activity score (0-100) normalized to p75
    let activityScore = 40; // Default for actors without flow data
    if (flow && flow.tx_count) {
      // Score based on p75 - anything above p75 gets 100
      activityScore = Math.min(100, Math.round((flow.tx_count / p75TxCount) * 100));
    }
    
    const coverage = calculateSimpleCoverageV2(
      actor.addresses.length,
      actor.addressStats?.verifiedCount || (actor.sourceLevel === 'verified' ? actor.addresses.length : 0),
      activityScore,
      actor.sourceLevel
    );
    
    const newBand = coverage.band === 'HIGH' ? 'High' : coverage.band === 'MEDIUM' ? 'Medium' : 'Low';
    
    if (actor.coverage.score !== coverage.score || actor.coverage.band !== newBand) {
      actor.coverage.score = coverage.score;
      actor.coverage.band = newBand;
      actor.coverage.breakdown = coverage.breakdown;
      actor.coverage.lastUpdated = new Date();
      await actor.save();
      updated++;
    }
  }
  
  return {
    processed: actors.length,
    updated,
  };
}
