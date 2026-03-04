/**
 * EXPECTATION STORE SERVICE — MongoDB
 * ====================================
 * 
 * P1.1: Persists expectations and outcomes to MongoDB.
 * Collections: market_expectations, expectation_outcomes
 */

import type {
  MarketExpectation,
  ExpectationFilters,
} from '../contracts/expectation.types.js';
import type { ExpectationOutcome } from '../contracts/expectation.outcome.types.js';

// MongoDB collection interface
interface MongoCollection<T> {
  insertOne(doc: T): Promise<{ insertedId: string }>;
  findOne(filter: any): Promise<T | null>;
  find(filter: any): { sort(s: any): { limit(n: number): { toArray(): Promise<T[]> } } };
  updateOne(filter: any, update: any): Promise<{ modifiedCount: number }>;
  countDocuments(filter?: any): Promise<number>;
}

// Get MongoDB client from db module
let expectationsCollection: MongoCollection<MarketExpectation> | null = null;
let outcomesCollection: MongoCollection<ExpectationOutcome> | null = null;

// Fallback in-memory store (used if MongoDB unavailable)
const inMemoryExpectations: MarketExpectation[] = [];
const inMemoryOutcomes: ExpectationOutcome[] = [];
let useInMemory = true;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

export async function initExpectationStore(): Promise<void> {
  try {
    const { getDb } = await import('../../../db/mongodb.js');
    const db = getDb();
    
    if (db) {
      expectationsCollection = db.collection('market_expectations') as any;
      outcomesCollection = db.collection('expectation_outcomes') as any;
      useInMemory = false;
      console.log('[ExpectationStore] MongoDB initialized');
      
      // Create indexes
      await createIndexes();
    } else {
      console.warn('[ExpectationStore] MongoDB not available, using in-memory');
    }
  } catch (err) {
    console.warn('[ExpectationStore] MongoDB init failed, using in-memory:', err);
    useInMemory = true;
  }
}

async function createIndexes(): Promise<void> {
  if (!expectationsCollection) return;
  
  try {
    const db = (expectationsCollection as any).db || (expectationsCollection as any).s?.db;
    if (db) {
      await db.collection('market_expectations').createIndex({ asset: 1, horizon: 1 });
      await db.collection('market_expectations').createIndex({ status: 1 });
      await db.collection('market_expectations').createIndex({ evaluateAt: 1 });
      await db.collection('market_expectations').createIndex({ issuedAt: -1 });
      
      await db.collection('expectation_outcomes').createIndex({ expectationId: 1 }, { unique: true });
      await db.collection('expectation_outcomes').createIndex({ evaluatedAt: -1 });
      await db.collection('expectation_outcomes').createIndex({ directionHit: 1 });
      
      console.log('[ExpectationStore] Indexes created');
    }
  } catch (err) {
    console.warn('[ExpectationStore] Index creation failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPECTATIONS CRUD
// ═══════════════════════════════════════════════════════════════

export async function saveExpectation(expectation: MarketExpectation): Promise<void> {
  if (useInMemory || !expectationsCollection) {
    inMemoryExpectations.push(expectation);
    console.log(`[ExpectationStore] Saved (memory): ${expectation.id}`);
    return;
  }
  
  try {
    await expectationsCollection.insertOne(expectation);
    console.log(`[ExpectationStore] Saved (MongoDB): ${expectation.id}`);
  } catch (err) {
    console.error('[ExpectationStore] Save failed:', err);
    // Fallback to memory
    inMemoryExpectations.push(expectation);
  }
}

export async function getExpectationById(id: string): Promise<MarketExpectation | null> {
  if (useInMemory || !expectationsCollection) {
    return inMemoryExpectations.find(e => e.id === id) || null;
  }
  
  try {
    return await expectationsCollection.findOne({ id });
  } catch (err) {
    console.error('[ExpectationStore] GetById failed:', err);
    return inMemoryExpectations.find(e => e.id === id) || null;
  }
}

export async function getExpectations(filters: ExpectationFilters): Promise<MarketExpectation[]> {
  if (useInMemory || !expectationsCollection) {
    return filterInMemory(inMemoryExpectations, filters);
  }
  
  try {
    const query: any = {};
    
    if (filters.asset) query.asset = filters.asset;
    if (filters.horizon) query.horizon = filters.horizon;
    if (filters.status) query.status = filters.status;
    if (filters.direction) query.direction = filters.direction;
    if (filters.macroRegime) query.macroRegime = filters.macroRegime;
    if (filters.fromDate) query.issuedAt = { $gte: filters.fromDate };
    if (filters.toDate) query.issuedAt = { ...query.issuedAt, $lte: filters.toDate };
    if (filters.minConfidence) query.confidence = { $gte: filters.minConfidence };
    
    const limit = filters.limit || 50;
    
    return await expectationsCollection
      .find(query)
      .sort({ issuedAt: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('[ExpectationStore] GetExpectations failed:', err);
    return filterInMemory(inMemoryExpectations, filters);
  }
}

export async function updateExpectationStatus(
  id: string,
  status: 'PENDING' | 'EVALUATED' | 'EXPIRED'
): Promise<void> {
  if (useInMemory || !expectationsCollection) {
    const exp = inMemoryExpectations.find(e => e.id === id);
    if (exp) exp.status = status;
    return;
  }
  
  try {
    await expectationsCollection.updateOne(
      { id },
      { $set: { status } }
    );
  } catch (err) {
    console.error('[ExpectationStore] UpdateStatus failed:', err);
    const exp = inMemoryExpectations.find(e => e.id === id);
    if (exp) exp.status = status;
  }
}

export async function getPendingExpectationsForEvaluation(): Promise<MarketExpectation[]> {
  const now = Date.now();
  
  if (useInMemory || !expectationsCollection) {
    return inMemoryExpectations.filter(e => 
      e.status === 'PENDING' && e.evaluateAt <= now
    );
  }
  
  try {
    return await expectationsCollection
      .find({
        status: 'PENDING',
        evaluateAt: { $lte: now }
      })
      .sort({ evaluateAt: 1 })
      .limit(100)
      .toArray();
  } catch (err) {
    console.error('[ExpectationStore] GetPending failed:', err);
    return inMemoryExpectations.filter(e => 
      e.status === 'PENDING' && e.evaluateAt <= now
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// OUTCOMES CRUD
// ═══════════════════════════════════════════════════════════════

export async function saveOutcome(outcome: ExpectationOutcome): Promise<void> {
  if (useInMemory || !outcomesCollection) {
    inMemoryOutcomes.push(outcome);
    console.log(`[ExpectationStore] Outcome saved (memory): ${outcome.expectationId}`);
    return;
  }
  
  try {
    await outcomesCollection.insertOne(outcome);
    console.log(`[ExpectationStore] Outcome saved (MongoDB): ${outcome.expectationId}`);
  } catch (err) {
    console.error('[ExpectationStore] SaveOutcome failed:', err);
    inMemoryOutcomes.push(outcome);
  }
}

export async function getOutcomeByExpectationId(expectationId: string): Promise<ExpectationOutcome | null> {
  if (useInMemory || !outcomesCollection) {
    return inMemoryOutcomes.find(o => o.expectationId === expectationId) || null;
  }
  
  try {
    return await outcomesCollection.findOne({ expectationId });
  } catch (err) {
    console.error('[ExpectationStore] GetOutcome failed:', err);
    return inMemoryOutcomes.find(o => o.expectationId === expectationId) || null;
  }
}

export async function getOutcomes(filters: {
  fromDate?: number;
  toDate?: number;
  directionHit?: boolean;
  limit?: number;
}): Promise<ExpectationOutcome[]> {
  if (useInMemory || !outcomesCollection) {
    let result = [...inMemoryOutcomes];
    if (filters.fromDate) result = result.filter(o => o.evaluatedAt >= filters.fromDate!);
    if (filters.toDate) result = result.filter(o => o.evaluatedAt <= filters.toDate!);
    if (filters.directionHit !== undefined) result = result.filter(o => o.directionHit === filters.directionHit);
    result.sort((a, b) => b.evaluatedAt - a.evaluatedAt);
    if (filters.limit) result = result.slice(0, filters.limit);
    return result;
  }
  
  try {
    const query: any = {};
    if (filters.fromDate) query.evaluatedAt = { $gte: filters.fromDate };
    if (filters.toDate) query.evaluatedAt = { ...query.evaluatedAt, $lte: filters.toDate };
    if (filters.directionHit !== undefined) query.directionHit = filters.directionHit;
    
    return await outcomesCollection
      .find(query)
      .sort({ evaluatedAt: -1 })
      .limit(filters.limit || 50)
      .toArray();
  } catch (err) {
    console.error('[ExpectationStore] GetOutcomes failed:', err);
    return inMemoryOutcomes.slice(0, filters.limit || 50);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export async function getExpectationStats(): Promise<{
  total: number;
  pending: number;
  evaluated: number;
  expired: number;
  byAsset: Record<string, number>;
  byHorizon: Record<string, number>;
}> {
  const expectations = useInMemory ? inMemoryExpectations : await getExpectations({ limit: 10000 });
  
  const pending = expectations.filter(e => e.status === 'PENDING').length;
  const evaluated = expectations.filter(e => e.status === 'EVALUATED').length;
  const expired = expectations.filter(e => e.status === 'EXPIRED').length;
  
  const byAsset: Record<string, number> = {};
  const byHorizon: Record<string, number> = {};
  
  for (const exp of expectations) {
    byAsset[exp.asset] = (byAsset[exp.asset] || 0) + 1;
    byHorizon[exp.horizon] = (byHorizon[exp.horizon] || 0) + 1;
  }
  
  return {
    total: expectations.length,
    pending,
    evaluated,
    expired,
    byAsset,
    byHorizon,
  };
}

export async function getOutcomeStats(): Promise<{
  total: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgError: number;
}> {
  const outcomes = useInMemory ? inMemoryOutcomes : await getOutcomes({ limit: 10000 });
  
  const hits = outcomes.filter(o => o.directionHit).length;
  const misses = outcomes.filter(o => !o.directionHit).length;
  const hitRate = outcomes.length > 0 ? hits / outcomes.length : 0;
  const avgError = outcomes.length > 0 
    ? outcomes.reduce((sum, o) => sum + o.absError, 0) / outcomes.length 
    : 0;
  
  return { total: outcomes.length, hits, misses, hitRate, avgError };
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

export async function expireOldExpectations(): Promise<number> {
  const now = Date.now();
  const expiryThreshold = 24 * 60 * 60 * 1000; // 24h past evaluation
  let expiredCount = 0;
  
  if (useInMemory || !expectationsCollection) {
    for (const exp of inMemoryExpectations) {
      if (exp.status === 'PENDING' && exp.evaluateAt + expiryThreshold < now) {
        exp.status = 'EXPIRED';
        expiredCount++;
      }
    }
  } else {
    try {
      const result = await expectationsCollection.updateOne(
        {
          status: 'PENDING',
          evaluateAt: { $lt: now - expiryThreshold }
        },
        { $set: { status: 'EXPIRED' } }
      );
      expiredCount = result.modifiedCount;
    } catch (err) {
      console.error('[ExpectationStore] Expire failed:', err);
    }
  }
  
  if (expiredCount > 0) {
    console.log(`[ExpectationStore] Expired ${expiredCount} old expectations`);
  }
  
  return expiredCount;
}

// ═══════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════

function filterInMemory(
  data: MarketExpectation[],
  filters: ExpectationFilters
): MarketExpectation[] {
  let result = [...data];
  
  if (filters.asset) result = result.filter(e => e.asset === filters.asset);
  if (filters.horizon) result = result.filter(e => e.horizon === filters.horizon);
  if (filters.status) result = result.filter(e => e.status === filters.status);
  if (filters.direction) result = result.filter(e => e.direction === filters.direction);
  if (filters.macroRegime) result = result.filter(e => e.macroRegime === filters.macroRegime);
  if (filters.fromDate) result = result.filter(e => e.issuedAt >= filters.fromDate!);
  if (filters.toDate) result = result.filter(e => e.issuedAt <= filters.toDate!);
  if (filters.minConfidence) result = result.filter(e => e.confidence >= filters.minConfidence!);
  
  result.sort((a, b) => b.issuedAt - a.issuedAt);
  
  if (filters.limit) result = result.slice(0, filters.limit);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// STORAGE INFO
// ═══════════════════════════════════════════════════════════════

export function getStorageMode(): 'mongodb' | 'in-memory' {
  return useInMemory ? 'in-memory' : 'mongodb';
}

console.log('[ExpectationStore] Store service loaded');
