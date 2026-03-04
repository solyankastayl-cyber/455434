/**
 * C5 — Novelty Detection Service
 * Detects unseen/rare configurations using cosine KNN
 */

import mongoose from 'mongoose';
import type { AeStateVector } from '../contracts/ae_state.contract.js';
import type { AeNovelty, NoveltyLevel } from '../contracts/ae_novelty.contract.js';
import { NOVELTY_THRESHOLDS, KNN_CONFIG } from '../contracts/ae_novelty.contract.js';
import { cosineDistance } from '../utils/ae_math.js';
import { stateVectorToArray } from './ae_state.service.js';
import { AeStateVectorModel } from '../storage/ae_state_vector.model.js';

/**
 * Snapshot current state vector to database
 * Idempotent: updates if exists
 */
export async function snapshotState(state: AeStateVector): Promise<{ ok: boolean; created: boolean }> {
  try {
    const existing = await AeStateVectorModel.findOne({ asOf: state.asOf });
    
    if (existing) {
      // Update existing
      existing.vector = state.vector;
      existing.health = state.health;
      existing.updatedAt = new Date();
      await existing.save();
      return { ok: true, created: false };
    }
    
    // Create new
    await AeStateVectorModel.create({
      asOf: state.asOf,
      vector: state.vector,
      health: state.health,
    });
    
    return { ok: true, created: true };
  } catch (e) {
    console.error('[AE Novelty] Snapshot failed:', (e as Error).message);
    return { ok: false, created: false };
  }
}

/**
 * Get state vector from database
 */
export async function getStateFromDB(asOf: string): Promise<AeStateVector | null> {
  try {
    const doc = await AeStateVectorModel.findOne({ asOf }).lean();
    if (!doc) return null;
    
    return {
      asOf: doc.asOf,
      vector: doc.vector,
      health: doc.health || { ok: true, missing: [] },
    };
  } catch (e) {
    console.error('[AE Novelty] Get state failed:', (e as Error).message);
    return null;
  }
}

/**
 * Get all historical state vectors except given date
 */
export async function getAllStatesExcept(excludeAsOf: string): Promise<AeStateVector[]> {
  try {
    const docs = await AeStateVectorModel.find({ asOf: { $ne: excludeAsOf } })
      .sort({ asOf: 1 })
      .lean();
    
    return docs.map(doc => ({
      asOf: doc.asOf,
      vector: doc.vector,
      health: doc.health || { ok: true, missing: [] },
    }));
  } catch (e) {
    console.error('[AE Novelty] Get all states failed:', (e as Error).message);
    return [];
  }
}

/**
 * Compute novelty score using KNN cosine distance
 */
export async function computeNovelty(asOf: string, currentState?: AeStateVector): Promise<AeNovelty> {
  const timestamp = new Date().toISOString();
  
  // Get current state
  let current: AeStateVector | null = currentState || null;
  if (!current) {
    current = await getStateFromDB(asOf);
  }
  
  if (!current) {
    return {
      novelty: 'KNOWN',
      score: 0,
      nearest: [],
      timestamp,
    };
  }
  
  const currentVec = stateVectorToArray(current.vector);
  
  // Get historical states
  const historical = await getAllStatesExcept(asOf);
  
  if (historical.length < KNN_CONFIG.MIN_HISTORY) {
    // Not enough history for meaningful novelty
    return {
      novelty: 'KNOWN',
      score: 0,
      nearest: historical.slice(0, KNN_CONFIG.MAX_NEAREST_DISPLAY).map(h => h.asOf),
      timestamp,
    };
  }
  
  // Calculate distances
  const distances = historical.map(h => ({
    asOf: h.asOf,
    dist: cosineDistance(currentVec, stateVectorToArray(h.vector)),
  }));
  
  // Sort by distance (ascending)
  distances.sort((a, b) => a.dist - b.dist);
  
  // Take K nearest
  const K = Math.min(KNN_CONFIG.K, distances.length);
  const topK = distances.slice(0, K);
  
  // Mean distance
  const meanDist = topK.reduce((s, x) => s + x.dist, 0) / K;
  
  // Classify novelty
  let novelty: NoveltyLevel;
  if (meanDist > NOVELTY_THRESHOLDS.UNSEEN) {
    novelty = 'UNSEEN';
  } else if (meanDist > NOVELTY_THRESHOLDS.RARE) {
    novelty = 'RARE';
  } else {
    novelty = 'KNOWN';
  }
  
  return {
    novelty,
    score: Math.round(meanDist * 1000) / 1000,
    nearest: topK.slice(0, KNN_CONFIG.MAX_NEAREST_DISPLAY).map(x => x.asOf),
    timestamp,
  };
}

/**
 * Get novelty statistics
 */
export async function getNoveltyStats(): Promise<{
  totalSnapshots: number;
  dateRange: { from: string; to: string } | null;
}> {
  try {
    const count = await AeStateVectorModel.countDocuments();
    
    if (count === 0) {
      return { totalSnapshots: 0, dateRange: null };
    }
    
    const oldest = await AeStateVectorModel.findOne().sort({ asOf: 1 }).lean();
    const newest = await AeStateVectorModel.findOne().sort({ asOf: -1 }).lean();
    
    return {
      totalSnapshots: count,
      dateRange: oldest && newest ? { from: oldest.asOf, to: newest.asOf } : null,
    };
  } catch (e) {
    return { totalSnapshots: 0, dateRange: null };
  }
}
